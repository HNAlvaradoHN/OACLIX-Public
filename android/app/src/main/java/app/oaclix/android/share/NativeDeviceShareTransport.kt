package app.oaclix.android.share

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
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal data class NativeDeviceShareResult(
    val targetDeviceId: String,
    val transferId: String,
    val itemId: String,
)

internal class NativeDeviceShareTransport(
    baseUrl: String,
    private val identity: AndroidKeystoreDeviceIdentity = AndroidKeystoreDeviceIdentity(),
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val normalizedBaseUrl = NativeIdentityApi.normalizeBaseUrl(baseUrl)

    fun send(
        targetDeviceId: String,
        text: String,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    ): NativeDeviceShareResult {
        require(DEVICE_ID_PATTERN.matches(targetDeviceId)) { "Destino inválido" }
        require(text.isNotBlank()) { "El texto no puede estar vacío" }
        require(text.length <= MAX_TEXT_LENGTH) { "El texto supera el límite permitido" }
        require(timeoutMs in 1_000L..30_000L) { "Timeout inválido" }

        val bootstrap = NativeIdentityApi(normalizedBaseUrl, identity).bootstrap()
        require(bootstrap.authenticated && bootstrap.persisted) { "La identidad todavía no está vinculada" }
        val roomId = bootstrap.generalRoomId ?: throw IllegalStateException("La sala de identidad no está disponible")
        require(bootstrap.deviceId != targetDeviceId) { "El destino debe ser otro dispositivo" }

        val roster = NativeIdentityLinkingApi(normalizedBaseUrl, identity).listLinkedDevices()
        require(roster.personId == bootstrap.personId) { "El roster vinculado no coincide con la identidad" }
        require(roster.devices.any { it.id == bootstrap.deviceId }) { "El dispositivo actual no pertenece al roster" }
        require(roster.devices.any { it.id == targetDeviceId }) { "El dispositivo de destino ya no está vinculado" }

        val now = System.currentTimeMillis()
        val transferId = randomId("xfr_", 12)
        val itemId = randomId("itm_", 16)
        val transfer = transferJson(
            transferId = transferId,
            senderDeviceId = bootstrap.deviceId,
            receiverDeviceId = targetDeviceId,
            itemId = itemId,
            text = text,
            createdAt = now,
            expiresAt = now + RETENTION_MS,
        )

        val proof = identity.signAction("realtime.connect", JSONObject().put("roomId", roomId).toString())
        val envelope = NativeIdentityLinkingApi.signedEnvelopeBody(proof)
        val authProtocol = "oaclix-auth-${base64Url(envelope)}"
        val endpoint = URL(normalizedBaseUrl)
        val origin = "${endpoint.protocol}://${endpoint.authority}"
        val socketUrl = "wss://${endpoint.authority}/api/realtime/connect?roomId=$roomId"
        val request = Request.Builder()
            .url(socketUrl)
            .header("Origin", origin)
            .header("Sec-WebSocket-Protocol", "oaclix-v1, $authProtocol")
            .build()

        val completed = CountDownLatch(1)
        val sent = AtomicBoolean(false)
        val result = AtomicReference<NativeDeviceShareResult?>(null)
        val failure = AtomicReference<Throwable?>(null)

        val socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, textMessage: String) {
                val message = runCatching { JSONObject(textMessage) }.getOrNull() ?: return
                when (message.optString("type")) {
                    "ready" -> {
                        if (message.optString("deviceId") != bootstrap.deviceId) {
                            failure.compareAndSet(null, IOException("El canal autenticó otro dispositivo"))
                            completed.countDown()
                        }
                    }
                    "presence" -> {
                        if (sent.get()) return
                        val ids = message.optJSONArray("deviceIds") ?: return
                        val targetOnline = (0 until ids.length()).any { ids.optString(it) == targetDeviceId }
                        if (!targetOnline) {
                            failure.compareAndSet(null, IOException("El dispositivo de destino no está conectado"))
                            completed.countDown()
                            return
                        }
                        val relay = JSONObject()
                            .put("type", "device-transfer")
                            .put("targetDeviceId", targetDeviceId)
                            .put("transfer", transfer)
                        if (!webSocket.send(relay.toString())) {
                            failure.compareAndSet(null, IOException("No se pudo enviar al dispositivo"))
                            completed.countDown()
                        } else {
                            sent.set(true)
                        }
                    }
                    "device-transfer-ack" -> {
                        if (message.optString("fromDeviceId") != targetDeviceId) return
                        val ack = message.optJSONObject("ack") ?: return
                        if (
                            ack.optString("transferId") != transferId ||
                            ack.optString("itemId") != itemId ||
                            ack.optString("senderDeviceId") != bootstrap.deviceId ||
                            ack.optString("receiverDeviceId") != targetDeviceId
                        ) return
                        when (ack.optString("status")) {
                            "stored" -> result.compareAndSet(null, NativeDeviceShareResult(targetDeviceId, transferId, itemId))
                            "expired" -> failure.compareAndSet(null, IOException("El texto venció antes de guardarse"))
                            "rejected" -> failure.compareAndSet(null, IOException("El otro dispositivo rechazó el texto"))
                            else -> return
                        }
                        completed.countDown()
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                failure.compareAndSet(null, t)
                completed.countDown()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (result.get() == null && failure.get() == null) {
                    failure.compareAndSet(null, IOException("El canal se cerró antes de confirmar el envío"))
                    completed.countDown()
                }
            }
        })

        try {
            if (!completed.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                throw IOException("No se recibió confirmación del dispositivo")
            }
            failure.get()?.let { throw if (it is IOException) it else IOException(it.message ?: "Falló el envío", it) }
            return result.get() ?: throw IOException("El dispositivo no confirmó el envío")
        } finally {
            socket.close(1000, "Envío completado")
        }
    }

    internal companion object {
        const val MAX_TEXT_LENGTH = 8_000
        const val RETENTION_MS = 21_600_000L
        const val DEFAULT_TIMEOUT_MS = 12_000L
        private val DEVICE_ID_PATTERN = Regex("^dev_[A-Za-z0-9_-]{16,64}$")
        private val secureRandom = SecureRandom()

        fun transferJson(
            transferId: String,
            senderDeviceId: String,
            receiverDeviceId: String,
            itemId: String,
            text: String,
            createdAt: Long,
            expiresAt: Long,
        ): JSONObject = JSONObject()
            .put("version", 1)
            .put("type", "local-clipboard-transfer")
            .put("transferId", transferId)
            .put("senderDeviceId", senderDeviceId)
            .put("receiverDeviceId", receiverDeviceId)
            .put("item", JSONObject()
                .put("id", itemId)
                .put("text", text)
                .put("createdAt", createdAt)
                .put("expiresAt", expiresAt))

        fun base64Url(value: String): String = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(value.toByteArray(Charsets.UTF_8))

        private fun randomId(prefix: String, byteCount: Int): String {
            val bytes = ByteArray(byteCount)
            secureRandom.nextBytes(bytes)
            return prefix + bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        }
    }
}
