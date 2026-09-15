package app.oaclix.android.share

import org.json.JSONObject

object NativeDirectImageProtocol {
    const val VERSION = 1
    const val START_TYPE = "local-image-direct-start"
    const val ACK_TYPE = "local-image-direct-ack"
    const val CHUNK_BYTES = 64 * 1024
    const val RETENTION_MS = 21_600_000L

    private val transferIdPattern = Regex("^ixf_[a-f0-9]{24}$")
    private val itemIdPattern = Regex("^itm_[a-f0-9]{32}$")
    private val deviceIdPattern = Regex("^dev_[A-Za-z0-9_-]{16,64}$")
    private val supportedMimeTypes = setOf("image/png", "image/jpeg", "image/webp", "image/gif")
    private val ackStatuses = setOf("stored", "expired", "rejected")

    data class Item(
        val id: String,
        val mimeType: String,
        val byteSize: Long,
        val createdAt: Long,
        val expiresAt: Long,
    )

    data class Start(
        val transferId: String,
        val senderDeviceId: String,
        val receiverDeviceId: String,
        val chunkSize: Int,
        val chunkCount: Int,
        val item: Item,
    )

    data class Ack(
        val transferId: String,
        val senderDeviceId: String,
        val receiverDeviceId: String,
        val itemId: String,
        val status: String,
    )

    fun parseStart(json: JSONObject): Start? {
        if (json.optInt("version", -1) != VERSION || json.optString("type") != START_TYPE) return null
        val transferId = json.optString("transferId")
        val senderDeviceId = json.optString("senderDeviceId")
        val receiverDeviceId = json.optString("receiverDeviceId")
        val chunkSize = json.optInt("chunkSize", -1)
        val chunkCount = json.optInt("chunkCount", -1)
        val itemJson = json.optJSONObject("item") ?: return null
        val item = Item(
            id = itemJson.optString("id"),
            mimeType = itemJson.optString("mimeType"),
            byteSize = itemJson.optLong("byteSize", -1L),
            createdAt = itemJson.optLong("createdAt", -1L),
            expiresAt = itemJson.optLong("expiresAt", -1L),
        )

        if (!validTransferId(transferId)
            || !validDevicePair(senderDeviceId, receiverDeviceId)
            || chunkSize != CHUNK_BYTES
            || chunkCount <= 0
            || !validItem(item)
        ) return null

        val expectedChunkCount = ((item.byteSize + CHUNK_BYTES - 1L) / CHUNK_BYTES).toInt()
        if (chunkCount != expectedChunkCount) return null

        return Start(transferId, senderDeviceId, receiverDeviceId, chunkSize, chunkCount, item)
    }

    fun parseAck(json: JSONObject): Ack? {
        if (json.optInt("version", -1) != VERSION || json.optString("type") != ACK_TYPE) return null
        val transferId = json.optString("transferId")
        val senderDeviceId = json.optString("senderDeviceId")
        val receiverDeviceId = json.optString("receiverDeviceId")
        val itemId = json.optString("itemId")
        val status = json.optString("status")

        if (!validTransferId(transferId)
            || !validDevicePair(senderDeviceId, receiverDeviceId)
            || !itemIdPattern.matches(itemId)
            || status !in ackStatuses
        ) return null

        return Ack(transferId, senderDeviceId, receiverDeviceId, itemId, status)
    }

    fun ackJson(start: Start, status: String): JSONObject {
        require(status in ackStatuses) { "Estado ACK inválido" }
        return JSONObject()
            .put("version", VERSION)
            .put("type", ACK_TYPE)
            .put("transferId", start.transferId)
            .put("senderDeviceId", start.senderDeviceId)
            .put("receiverDeviceId", start.receiverDeviceId)
            .put("itemId", start.item.id)
            .put("status", status)
    }

    fun expectedChunkBytes(start: Start, chunkIndex: Int): Int {
        if (chunkIndex < 0 || chunkIndex >= start.chunkCount) return 0
        if (chunkIndex < start.chunkCount - 1) return start.chunkSize
        return (start.item.byteSize - start.chunkSize.toLong() * (start.chunkCount - 1)).toInt()
    }

    private fun validTransferId(value: String) = transferIdPattern.matches(value)

    private fun validDevicePair(sender: String, receiver: String) =
        deviceIdPattern.matches(sender) && deviceIdPattern.matches(receiver) && sender != receiver

    private fun validItem(item: Item) =
        itemIdPattern.matches(item.id)
            && item.mimeType in supportedMimeTypes
            && item.byteSize > 0L
            && item.createdAt >= 0L
            && item.expiresAt > item.createdAt
            && item.expiresAt - item.createdAt <= RETENTION_MS
}
