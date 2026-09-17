package app.oaclix.android.share

import app.oaclix.android.localclipboard.LocalClipboardPolicy
import org.json.JSONObject
import java.security.SecureRandom

/**
 * Data-channel-only contract for one direct text transfer.
 *
 * Unlike NativeDirectSignalProtocol, these frames contain user payload and must
 * never be sent through the OACLIX cloud signaling service.
 */
internal object NativeDirectTextProtocol {
    const val TRANSFER_TYPE = "direct-text-transfer"
    const val ACK_TYPE = "direct-text-transfer-ack"
    const val VERSION = 1
    private const val CLOCK_SKEW_MS = 5L * 60L * 1000L
    private val deviceIdPattern = Regex("^dev_[A-Za-z0-9_-]{16,64}$")
    private val transferIdPattern = Regex("^xfr_[a-f0-9]{24}$")
    private val itemIdPattern = Regex("^itm_[a-f0-9]{32}$")
    private val random = SecureRandom()

    enum class AckStatus(val wireValue: String) {
        Stored("stored"),
        Expired("expired"),
        Rejected("rejected");

        companion object {
            fun fromWire(value: String): AckStatus? = entries.firstOrNull { it.wireValue == value }
        }
    }

    data class Transfer(
        val transferId: String,
        val senderDeviceId: String,
        val receiverDeviceId: String,
        val itemId: String,
        val text: String,
        val createdAt: Long,
        val expiresAt: Long,
    )

    data class Ack(
        val transferId: String,
        val senderDeviceId: String,
        val receiverDeviceId: String,
        val itemId: String,
        val status: AckStatus,
    )

    fun createTransferFrame(
        senderDeviceId: String,
        receiverDeviceId: String,
        text: String,
        now: Long = System.currentTimeMillis(),
        transferId: String = newTransferId(),
        itemId: String = newItemId(),
    ): JSONObject {
        requireValidDevicePair(senderDeviceId, receiverDeviceId)
        require(transferIdPattern.matches(transferId)) { "Identificador de transferencia inválido" }
        require(itemIdPattern.matches(itemId)) { "Identificador de elemento inválido" }
        require(text.isNotBlank() && text.length <= LocalClipboardPolicy.MAX_TEXT_LENGTH) { "Texto directo inválido" }
        require(now > 0L) { "Hora de creación inválida" }

        return JSONObject()
            .put("type", TRANSFER_TYPE)
            .put("version", VERSION)
            .put("transferId", transferId)
            .put("senderDeviceId", senderDeviceId)
            .put("receiverDeviceId", receiverDeviceId)
            .put("item", JSONObject()
                .put("id", itemId)
                .put("text", text)
                .put("createdAt", now)
                .put("expiresAt", now + LocalClipboardPolicy.TEXT_RETENTION_MS))
    }

    fun parseTransferFrame(
        message: JSONObject,
        expectedRemoteDeviceId: String,
        currentDeviceId: String,
        now: Long = System.currentTimeMillis(),
    ): Transfer? {
        if (message.optString("type") != TRANSFER_TYPE || message.optInt("version", -1) != VERSION) return null
        if (!deviceIdPattern.matches(expectedRemoteDeviceId) || !deviceIdPattern.matches(currentDeviceId)) return null

        val transferId = message.optString("transferId")
        val senderDeviceId = message.optString("senderDeviceId")
        val receiverDeviceId = message.optString("receiverDeviceId")
        val item = message.optJSONObject("item") ?: return null
        val itemId = item.optString("id")
        val text = item.optString("text")
        val createdAt = item.optLong("createdAt", -1L)
        val expiresAt = item.optLong("expiresAt", -1L)

        if (!transferIdPattern.matches(transferId) || !itemIdPattern.matches(itemId)) return null
        if (senderDeviceId != expectedRemoteDeviceId || receiverDeviceId != currentDeviceId) return null
        if (senderDeviceId == receiverDeviceId) return null
        if (text.isBlank() || text.length > LocalClipboardPolicy.MAX_TEXT_LENGTH) return null
        if (createdAt <= 0L || createdAt > now + CLOCK_SKEW_MS) return null
        if (expiresAt <= createdAt || expiresAt - createdAt > LocalClipboardPolicy.TEXT_RETENTION_MS) return null
        if (expiresAt > now + LocalClipboardPolicy.TEXT_RETENTION_MS + CLOCK_SKEW_MS) return null

        return Transfer(
            transferId = transferId,
            senderDeviceId = senderDeviceId,
            receiverDeviceId = receiverDeviceId,
            itemId = itemId,
            text = text,
            createdAt = createdAt,
            expiresAt = expiresAt,
        )
    }

    fun createAckFrame(transfer: Transfer, status: AckStatus): JSONObject = JSONObject()
        .put("type", ACK_TYPE)
        .put("version", VERSION)
        .put("transferId", transfer.transferId)
        .put("senderDeviceId", transfer.senderDeviceId)
        .put("receiverDeviceId", transfer.receiverDeviceId)
        .put("itemId", transfer.itemId)
        .put("status", status.wireValue)

    fun parseAckFrame(
        message: JSONObject,
        expectedRemoteDeviceId: String,
        currentDeviceId: String,
    ): Ack? {
        if (message.optString("type") != ACK_TYPE || message.optInt("version", -1) != VERSION) return null
        if (!deviceIdPattern.matches(expectedRemoteDeviceId) || !deviceIdPattern.matches(currentDeviceId)) return null

        val transferId = message.optString("transferId")
        val senderDeviceId = message.optString("senderDeviceId")
        val receiverDeviceId = message.optString("receiverDeviceId")
        val itemId = message.optString("itemId")
        val status = AckStatus.fromWire(message.optString("status")) ?: return null

        if (!transferIdPattern.matches(transferId) || !itemIdPattern.matches(itemId)) return null
        if (senderDeviceId != currentDeviceId || receiverDeviceId != expectedRemoteDeviceId) return null

        return Ack(
            transferId = transferId,
            senderDeviceId = senderDeviceId,
            receiverDeviceId = receiverDeviceId,
            itemId = itemId,
            status = status,
        )
    }

    fun isExpired(transfer: Transfer, now: Long = System.currentTimeMillis()): Boolean = transfer.expiresAt <= now

    private fun requireValidDevicePair(senderDeviceId: String, receiverDeviceId: String) {
        require(deviceIdPattern.matches(senderDeviceId)) { "Dispositivo emisor inválido" }
        require(deviceIdPattern.matches(receiverDeviceId)) { "Dispositivo receptor inválido" }
        require(senderDeviceId != receiverDeviceId) { "El destino debe ser otro dispositivo" }
    }

    private fun newTransferId(): String = "xfr_${randomHex(12)}"
    private fun newItemId(): String = "itm_${randomHex(16)}"

    private fun randomHex(byteCount: Int): String {
        val bytes = ByteArray(byteCount)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }
}
