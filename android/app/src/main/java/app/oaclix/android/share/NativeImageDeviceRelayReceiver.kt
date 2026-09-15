package app.oaclix.android.share

import android.content.Context
import android.os.Handler
import android.os.Looper
import app.oaclix.android.identity.AndroidKeystoreDeviceIdentity
import app.oaclix.android.identity.NativeIdentityApi
import app.oaclix.android.identity.NativeIdentityLinkingApi
import app.oaclix.android.imageclipboard.ImageClipboardStore
import app.oaclix.android.imageclipboard.ImageTransferPolicy
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URL
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal class NativeImageDeviceRelayReceiver(
    private val context: Context,
    baseUrl: String,
    private val onStored: () -> Unit,
    private val identity: AndroidKeystoreDeviceIdentity = AndroidKeystoreDeviceIdentity(),
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val normalizedBaseUrl = NativeIdentityApi.normalizeBaseUrl(baseUrl)
    private val socketRef = AtomicReference<WebSocket?>(null)
    private val directManagerRef = AtomicReference<NativeDirectImagePeerManager?>(null)
    private val imageStore = ImageClipboardStore(context)
    private val receipts = context.getSharedPreferences(RECEIPT_PREFERENCES, Context.MODE_PRIVATE)

    fun start() {
        if (socketRef.get() != null) return
        val bootstrap = NativeIdentityApi(normalizedBaseUrl, identity).bootstrap()
        if (!bootstrap.authenticated || !bootstrap.persisted) return
        val roomId = bootstrap.generalRoomId ?: return
        val deviceId = bootstrap.deviceId

        val proof = identity.signAction("realtime.connect", JSONObject().put("roomId", roomId).toString())
        val envelope = NativeIdentityLinkingApi.signedEnvelopeBody(proof)
        val authProtocol = "oaclix-auth-${NativeDeviceShareTransport.base64Url(envelope)}"
        val endpoint = URL(normalizedBaseUrl)
        val origin = "${endpoint.protocol}://${endpoint.authority}"
        val request = Request.Builder()
            .url("wss://${endpoint.authority}/api/realtime/connect?roomId=$roomId")
            .header("Origin", origin)
            .header("Sec-WebSocket-Protocol", "oaclix-v1, $authProtocol")
            .build()

        val connectionClosed = AtomicBoolean(false)
        val socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                when (message.optString("type")) {
                    "presence" -> handlePresence(message, deviceId)
                    "signal" -> directManagerRef.get()?.handleSignal(message)
                    "device-image-transfer" -> {
                        val fromDeviceId = message.optString("fromDeviceId")
                        if (!DEVICE_ID_PATTERN.matches(fromDeviceId) || fromDeviceId == deviceId) return
                        val transfer = message.optJSONObject("transfer") ?: return
                        handleTransfer(webSocket, transfer, fromDeviceId, deviceId)
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                connectionClosed.set(true)
                socketRef.compareAndSet(webSocket, null)
                closeCurrentDirectManager()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                connectionClosed.set(true)
                socketRef.compareAndSet(webSocket, null)
                closeCurrentDirectManager()
            }
        })
        if (!socketRef.compareAndSet(null, socket)) {
            socket.close(1000, "Receptor duplicado")
            return
        }
        if (connectionClosed.get() && socketRef.compareAndSet(socket, null)) {
            closeCurrentDirectManager()
        }
    }

    fun stop() {
        closeCurrentDirectManager()
        socketRef.getAndSet(null)?.close(1000, "OACLIX en pausa")
    }

    private fun handlePresence(message: JSONObject, deviceId: String) {
        val current = directManagerRef.get()
        if (current != null) {
            current.handlePresence(message)
            return
        }

        val peers = NativeDirectSignalProtocol.parsePresence(message) ?: return
        if (peers.none { it.deviceId == deviceId } || peers.none { it.deviceId != deviceId }) return
        ensureDirectManagerOnMainThread(deviceId)?.handlePresence(message)
    }

    private fun ensureDirectManagerOnMainThread(deviceId: String): NativeDirectImagePeerManager? {
        directManagerRef.get()?.let { return it }
        synchronized(directManagerRef) {
            directManagerRef.get()?.let { return it }
            val created = createDirectManagerOnMainThread(deviceId) ?: return null
            directManagerRef.set(created)
            return created
        }
    }

    private fun createDirectManagerOnMainThread(deviceId: String): NativeDirectImagePeerManager? {
        fun create(): NativeDirectImagePeerManager? = runCatching {
            NativeDirectImagePeerManager(
                context = context,
                currentDeviceId = deviceId,
                sendRealtimeFrame = { frame -> socketRef.get()?.send(frame.toString()) == true },
                onStored = onStored,
            )
        }.getOrNull()

        if (Looper.myLooper() == Looper.getMainLooper()) return create()

        val result = AtomicReference<NativeDirectImagePeerManager?>(null)
        val completed = CountDownLatch(1)
        val abandoned = AtomicBoolean(false)
        val posted = Handler(Looper.getMainLooper()).post {
            val manager = create()
            if (abandoned.get()) manager?.close() else result.set(manager)
            completed.countDown()
        }
        if (!posted) return null

        val ready = runCatching {
            completed.await(DIRECT_MANAGER_INIT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        }.getOrDefault(false)
        if (!ready) {
            abandoned.set(true)
            return null
        }
        return result.get()
    }

    private fun closeCurrentDirectManager() {
        directManagerRef.getAndSet(null)?.close()
    }

    private fun handleTransfer(
        socket: WebSocket,
        transfer: JSONObject,
        fromDeviceId: String,
        currentDeviceId: String,
    ) {
        val transferId = transfer.optString("transferId")
        val senderDeviceId = transfer.optString("senderDeviceId")
        val receiverDeviceId = transfer.optString("receiverDeviceId")
        val item = transfer.optJSONObject("item")
        if (
            transfer.optInt("version") != 1 ||
            transfer.optString("type") != "local-image-transfer" ||
            !TRANSFER_ID_PATTERN.matches(transferId) ||
            senderDeviceId != fromDeviceId ||
            receiverDeviceId != currentDeviceId ||
            item == null
        ) return

        val itemId = item.optString("id")
        val mimeType = item.optString("mimeType").lowercase()
        val byteSize = item.optLong("byteSize", -1L)
        val createdAt = item.optLong("createdAt", -1L)
        val expiresAt = item.optLong("expiresAt", -1L)
        val now = System.currentTimeMillis()
        if (
            !ITEM_ID_PATTERN.matches(itemId) ||
            ImageClipboardStore.extensionForMime(mimeType) == null ||
            byteSize <= 0L ||
            byteSize > ImageTransferPolicy.CLOUD_MAX_IMAGE_BYTES ||
            createdAt <= 0L ||
            createdAt > now + CLOCK_SKEW_MS ||
            expiresAt <= createdAt ||
            expiresAt - createdAt > ImageClipboardStore.RETENTION_MS ||
            expiresAt > now + ImageClipboardStore.RETENTION_MS + CLOCK_SKEW_MS
        ) {
            sendAck(socket, fromDeviceId, transferId, senderDeviceId, receiverDeviceId, itemId, "rejected")
            return
        }

        val receiptKey = "$fromDeviceId:$itemId"
        cleanupReceipts(now)
        if (expiresAt <= now) {
            sendAck(socket, fromDeviceId, transferId, senderDeviceId, receiverDeviceId, itemId, "expired")
            return
        }
        if (receipts.getLong(receiptKey, 0L) > now) {
            sendAck(socket, fromDeviceId, transferId, senderDeviceId, receiverDeviceId, itemId, "stored")
            return
        }

        val bytes = runCatching { Base64.getDecoder().decode(item.optString("base64Data")) }.getOrNull()
        if (bytes == null || bytes.size.toLong() != byteSize) {
            sendAck(socket, fromDeviceId, transferId, senderDeviceId, receiverDeviceId, itemId, "rejected")
            return
        }

        val stored = runCatching { imageStore.createFromBytes(bytes, mimeType, createdAt) }.isSuccess
        if (stored) {
            receipts.edit().putLong(receiptKey, expiresAt).apply()
            onStored()
        }
        sendAck(
            socket,
            fromDeviceId,
            transferId,
            senderDeviceId,
            receiverDeviceId,
            itemId,
            if (stored) "stored" else "rejected",
        )
    }

    private fun sendAck(
        socket: WebSocket,
        targetDeviceId: String,
        transferId: String,
        senderDeviceId: String,
        receiverDeviceId: String,
        itemId: String,
        status: String,
    ) {
        if (!TRANSFER_ID_PATTERN.matches(transferId) || !ITEM_ID_PATTERN.matches(itemId)) return
        val ack = JSONObject()
            .put("version", 1)
            .put("type", "local-image-transfer-ack")
            .put("transferId", transferId)
            .put("senderDeviceId", senderDeviceId)
            .put("receiverDeviceId", receiverDeviceId)
            .put("itemId", itemId)
            .put("status", status)
        socket.send(
            JSONObject()
                .put("type", "device-image-transfer-ack")
                .put("targetDeviceId", targetDeviceId)
                .put("ack", ack)
                .toString(),
        )
    }

    private fun cleanupReceipts(now: Long) {
        val stale = receipts.all
            .filterValues { value -> (value as? Long)?.let { it <= now } ?: true }
            .keys
        if (stale.isEmpty()) return
        val editor = receipts.edit()
        stale.forEach(editor::remove)
        editor.apply()
    }

    companion object {
        private const val RECEIPT_PREFERENCES = "oaclix_received_image_relay"
        private const val CLOCK_SKEW_MS = 5L * 60L * 1000L
        private const val DIRECT_MANAGER_INIT_TIMEOUT_MS = 5_000L
        private val DEVICE_ID_PATTERN = Regex("^dev_[A-Za-z0-9_-]{16,64}$")
        private val TRANSFER_ID_PATTERN = Regex("^xfr_[a-f0-9]{24}$")
        private val ITEM_ID_PATTERN = Regex("^itm_[a-f0-9]{32}$")
    }
}
