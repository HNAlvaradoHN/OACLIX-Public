package app.oaclix.android.share

import android.content.Context
import app.oaclix.android.connection.NativeBackendConfig
import app.oaclix.android.identity.AndroidKeystoreDeviceIdentity
import app.oaclix.android.identity.NativeIdentityApi
import app.oaclix.android.identity.NativeIdentityLinkingApi
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.IOException
import java.net.URL
import java.util.Base64
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Owns the single foreground realtime session used by native direct text.
 *
 * The WebSocket carries only authenticated presence + SDP/ICE metadata. Text and
 * ACK frames stay inside NativeDirectTextPeerManager's WebRTC DataChannel.
 */
internal class NativeDirectTextSessionController(
    context: Context,
    private val onIncomingTransfer: (NativeDirectTextProtocol.Transfer) -> NativeDirectTextProtocol.AckStatus,
    private val identity: AndroidKeystoreDeviceIdentity = AndroidKeystoreDeviceIdentity(),
    private val client: OkHttpClient = OkHttpClient(),
    private val baseUrlProvider: () -> String = { NativeBackendConfig.resolve(context.applicationContext) },
) : AutoCloseable {
    private val appContext = context.applicationContext
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val stateLock = Object()

    @Volatile private var closed = false
    private var requested = false
    private var connecting = false
    private var generation = 0L
    private var active: ActiveSession? = null
    private var startupFailure: IOException? = null

    fun start() {
        val attempt = synchronized(stateLock) {
            if (closed || executor.isShutdown) return
            requested = true
            if (active != null || connecting) return
            connecting = true
            startupFailure = null
            generation += 1L
            generation
        }
        executor.execute { connect(attempt) }
    }

    fun stop() {
        val stale = synchronized(stateLock) {
            if (closed && active == null && !connecting) return
            requested = false
            generation += 1L
            connecting = false
            startupFailure = IOException("OACLIX está en pausa")
            val current = active
            active = null
            stateLock.notifyAll()
            current
        }
        stale?.close("OACLIX en pausa")
    }

    fun send(
        targetDeviceId: String,
        text: String,
        timeoutMs: Long = NativeDirectTextPeerManager.DEFAULT_SEND_TIMEOUT_MS,
    ): NativeDirectTextSendResult {
        require(NativeDirectSignalProtocol.validDeviceId(targetDeviceId)) { "Destino inválido" }
        require(timeoutMs in MIN_SEND_TIMEOUT_MS..MAX_SEND_TIMEOUT_MS) { "Timeout inválido" }
        if (closed) throw IOException("El canal directo está cerrado")

        start()
        val deadlineNanos = System.nanoTime() + timeoutMs * NANOS_PER_MILLISECOND
        val session = awaitReadyPresence(targetDeviceId, deadlineNanos)
        val remainingMs = remainingMillis(deadlineNanos)
        if (remainingMs < MIN_SEND_TIMEOUT_MS) {
            throw IOException("No hubo tiempo suficiente para abrir el canal directo")
        }
        return session.peer.send(targetDeviceId, text, remainingMs)
    }

    override fun close() {
        val stale = synchronized(stateLock) {
            if (closed) return
            closed = true
            requested = false
            generation += 1L
            connecting = false
            startupFailure = IOException("El canal directo se cerró")
            val current = active
            active = null
            stateLock.notifyAll()
            current
        }
        stale?.close("OACLIX cerrado")
        executor.shutdown()
    }

    private fun connect(attempt: Long) {
        var session: ActiveSession? = null
        try {
            val rawBaseUrl = baseUrlProvider().trim()
            if (rawBaseUrl.isBlank()) throw IOException("Configura la conexión OACLIX primero")
            val baseUrl = NativeIdentityApi.normalizeBaseUrl(rawBaseUrl)
            val bootstrap = NativeIdentityApi(baseUrl, identity).bootstrap()
            if (!bootstrap.authenticated || !bootstrap.persisted) {
                throw IOException("La identidad todavía no está vinculada")
            }
            val roomId = bootstrap.generalRoomId ?: throw IOException("La sesión de identidad no está disponible")
            val deviceId = bootstrap.deviceId

            val peer = NativeDirectTextPeerManager(
                context = appContext,
                currentDeviceId = deviceId,
                sendRealtimeFrame = { frame -> sendSignalFrame(attempt, frame) },
                onIncomingTransfer = onIncomingTransfer,
            )
            session = ActiveSession(
                generation = attempt,
                deviceId = deviceId,
                peer = peer,
            )

            synchronized(stateLock) {
                if (!isAttemptCurrent(attempt)) {
                    peer.close()
                    return
                }
                active = session
                connecting = false
                startupFailure = null
                stateLock.notifyAll()
            }

            val proof = identity.signAction(
                "realtime.connect",
                JSONObject().put("roomId", roomId).toString(),
            )
            val envelope = NativeIdentityLinkingApi.signedEnvelopeBody(proof)
            val authProtocol = "oaclix-auth-${base64Url(envelope)}"
            val endpoint = URL(baseUrl)
            val origin = "${endpoint.protocol}://${endpoint.authority}"
            val request = Request.Builder()
                .url("wss://${endpoint.authority}/api/realtime/connect?roomId=$roomId")
                .header("Origin", origin)
                .header("Sec-WebSocket-Protocol", "oaclix-v1, $authProtocol")
                .build()

            val createdSocket = client.newWebSocket(request, listenerFor(session))
            session.socket.set(createdSocket)
            if (!isSessionCurrent(session)) {
                createdSocket.close(1000, "Sesión reemplazada")
            }
        } catch (error: Exception) {
            session?.close("No se pudo abrir la sesión")
            failStartup(
                attempt,
                if (error is IOException) error else IOException(error.message ?: "Falló la sesión realtime", error),
            )
        }
    }

    private fun listenerFor(session: ActiveSession): WebSocketListener = object : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!isSessionCurrent(session)) return
            val message = runCatching { JSONObject(text) }.getOrNull() ?: return
            when (message.optString("type")) {
                "ready" -> {
                    val ready = NativeDirectSignalProtocol.parseReady(message) ?: return
                    if (ready.deviceId != session.deviceId) {
                        failSession(session, IOException("El canal autenticó otro dispositivo"))
                        return
                    }
                    synchronized(stateLock) {
                        if (active !== session) return
                        session.ready = true
                        stateLock.notifyAll()
                    }
                }

                "presence" -> {
                    val peers = NativeDirectSignalProtocol.parsePresence(message) ?: return
                    if (peers.none { it.deviceId == session.deviceId }) return
                    synchronized(stateLock) {
                        if (active !== session) return
                        session.presenceKnown = true
                        session.onlineDeviceIds = peers.asSequence().map { it.deviceId }.toSet()
                        stateLock.notifyAll()
                    }
                    session.peer.handlePresence(message)
                }

                "signal" -> session.peer.handleSignal(message)

                // Legacy payload relay messages are deliberately ignored. This
                // session is metadata-only and never receives user content from cloud.
                else -> Unit
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            failSession(session, if (t is IOException) t else IOException(t.message ?: "Falló realtime", t))
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            failSession(session, IOException("El canal realtime se cerró"))
        }
    }

    private fun sendSignalFrame(attempt: Long, frame: JSONObject): Boolean {
        if (!NativeDirectSignalProtocol.isOutboundSignalFrame(frame)) return false
        val socket = synchronized(stateLock) {
            val current = active
            if (
                closed ||
                !requested ||
                current == null ||
                current.generation != attempt ||
                !current.ready
            ) return false
            current.socket.get()
        } ?: return false
        return socket.send(frame.toString())
    }

    private fun awaitReadyPresence(targetDeviceId: String, deadlineNanos: Long): ActiveSession {
        synchronized(stateLock) {
            while (true) {
                if (closed) throw IOException("El canal directo está cerrado")
                startupFailure?.let { failure ->
                    if (active == null && !connecting) throw failure
                }
                val current = active
                if (current != null && current.ready && current.presenceKnown) {
                    if (targetDeviceId !in current.onlineDeviceIds) {
                        throw IOException("El dispositivo de destino no está conectado")
                    }
                    return current
                }

                val remainingMs = remainingMillis(deadlineNanos)
                if (remainingMs <= 0L) {
                    throw IOException("No se pudo abrir la sesión directa a tiempo")
                }
                stateLock.wait(remainingMs.coerceAtLeast(1L))
            }
        }
    }

    private fun failStartup(attempt: Long, error: IOException) {
        synchronized(stateLock) {
            if (attempt != generation) return
            connecting = false
            if (active?.generation == attempt) active = null
            startupFailure = error
            stateLock.notifyAll()
        }
    }

    private fun failSession(session: ActiveSession, error: IOException) {
        val shouldClose = synchronized(stateLock) {
            if (active !== session) return
            active = null
            connecting = false
            startupFailure = error
            stateLock.notifyAll()
            true
        }
        if (shouldClose) session.close("Sesión terminada")
    }

    private fun isAttemptCurrent(attempt: Long): Boolean =
        !closed && requested && generation == attempt

    private fun isSessionCurrent(session: ActiveSession): Boolean = synchronized(stateLock) {
        !closed && requested && active === session && generation == session.generation
    }

    private fun remainingMillis(deadlineNanos: Long): Long {
        val remaining = deadlineNanos - System.nanoTime()
        if (remaining <= 0L) return 0L
        return (remaining / NANOS_PER_MILLISECOND).coerceAtLeast(1L)
    }

    private class ActiveSession(
        val generation: Long,
        val deviceId: String,
        val peer: NativeDirectTextPeerManager,
    ) {
        val socket = AtomicReference<WebSocket?>(null)
        var ready: Boolean = false
        var presenceKnown: Boolean = false
        var onlineDeviceIds: Set<String> = emptySet()

        fun close(reason: String) {
            socket.getAndSet(null)?.close(1000, reason)
            peer.close()
        }
    }

    companion object {
        private const val MIN_SEND_TIMEOUT_MS = 1_000L
        private const val MAX_SEND_TIMEOUT_MS = 30_000L
        private const val NANOS_PER_MILLISECOND = 1_000_000L

        private fun base64Url(value: String): String = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(value.toByteArray(Charsets.UTF_8))
    }
}
