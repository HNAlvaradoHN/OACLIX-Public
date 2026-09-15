package app.oaclix.android.share

import android.content.Context
import app.oaclix.android.imageclipboard.ImageClipboardStore
import org.json.JSONObject
import java.io.FileOutputStream

internal class NativeDirectImageInbox(
    context: Context,
    private val remoteDeviceId: String,
    private val currentDeviceId: String,
    private val onStored: () -> Unit,
    private val sendAck: (JSONObject) -> Unit,
) : AutoCloseable {
    private val appContext = context.applicationContext
    private val imageStore = ImageClipboardStore(appContext)
    private val receipts = appContext.getSharedPreferences(RECEIPT_PREFERENCES, Context.MODE_PRIVATE)
    private var incoming: Incoming? = null

    fun begin(start: NativeDirectImageProtocol.Start) {
        if (start.senderDeviceId != remoteDeviceId || start.receiverDeviceId != currentDeviceId) return
        failCurrent("rejected")

        val now = System.currentTimeMillis()
        cleanupReceipts(now)
        if (start.item.expiresAt <= now) {
            acknowledge(start, "expired")
            return
        }
        if (
            start.item.createdAt > now + CLOCK_SKEW_MS
            || start.item.expiresAt > now + NativeDirectImageProtocol.RETENTION_MS + CLOCK_SKEW_MS
        ) {
            acknowledge(start, "rejected")
            return
        }

        val receiptKey = receiptKey(start)
        val recorded = receipts.getString(receiptKey, null)
        if (recorded != null) {
            if (recorded == receiptValue(start) && start.item.expiresAt > now) acknowledge(start, "stored")
            else acknowledge(start, "rejected")
            return
        }

        val usableSpace = imageStore.availableIncomingBytes(now)
        val reserve = maxOf(MIN_FREE_SPACE_RESERVE_BYTES, usableSpace / 10L)
        if (
            usableSpace <= reserve
            || start.item.byteSize > usableSpace - reserve
        ) {
            acknowledge(start, "rejected")
            return
        }

        val target = runCatching {
            imageStore.createIncomingTarget(start.item.mimeType, start.item.createdAt)
        }.getOrElse {
            acknowledge(start, "rejected")
            return
        }
        try {
            val output = FileOutputStream(target.tempFile, false)
            incoming = Incoming(
                start = start,
                target = target,
                output = output,
                assembler = NativeDirectImageAssembler(
                    byteSize = start.item.byteSize,
                    chunkSize = start.chunkSize,
                    chunkCount = start.chunkCount,
                    output = output,
                ),
            )
        } catch (_: Exception) {
            imageStore.discardIncomingTarget(target)
            acknowledge(start, "rejected")
        }
    }

    fun append(bytes: ByteArray) {
        val current = incoming ?: return
        try {
            if (!hasCapacityFor(bytes.size.toLong())) {
                failCurrent("rejected")
                return
            }
            val chunkIndex = current.nextChunkIndex
            val completed = current.assembler.append(chunkIndex, bytes)
            current.nextChunkIndex += 1
            if (!completed) return

            current.output.close()
            incoming = null
            val stored = runCatching {
                imageStore.commitIncomingTarget(current.target, current.start.item.byteSize)
            }.isSuccess

            if (!stored) {
                imageStore.discardIncomingTarget(current.target)
                acknowledge(current.start, "rejected")
                return
            }

            receipts.edit()
                .putString(receiptKey(current.start), receiptValue(current.start))
                .apply()
            onStored()
            acknowledge(current.start, "stored")
        } catch (_: Exception) {
            failCurrent("rejected")
        }
    }

    override fun close() {
        val current = incoming
        incoming = null
        if (current != null) {
            runCatching { current.output.close() }
            imageStore.discardIncomingTarget(current.target)
        }
    }

    private fun failCurrent(status: String) {
        val current = incoming ?: return
        incoming = null
        runCatching { current.output.close() }
        imageStore.discardIncomingTarget(current.target)
        acknowledge(current.start, status)
    }


    private fun hasCapacityFor(nextBytes: Long): Boolean {
        if (nextBytes <= 0L) return false
        val usableSpace = imageStore.availableIncomingBytes()
        val reserve = maxOf(MIN_FREE_SPACE_RESERVE_BYTES, usableSpace / 10L)
        return usableSpace > reserve && nextBytes <= usableSpace - reserve
    }

    private fun acknowledge(start: NativeDirectImageProtocol.Start, status: String) {
        sendAck(
            JSONObject()
                .put("type", NativeDirectImageProtocol.ACK_TYPE)
                .put("ack", NativeDirectImageProtocol.ackJson(start, status)),
        )
    }

    private fun receiptKey(start: NativeDirectImageProtocol.Start) = "$remoteDeviceId:${start.item.id}"

    private fun receiptValue(start: NativeDirectImageProtocol.Start) = listOf(
        start.item.mimeType,
        start.item.byteSize,
        start.item.createdAt,
        start.item.expiresAt,
    ).joinToString("|")

    private fun cleanupReceipts(now: Long) {
        val stale = receipts.all.entries
            .filter { (_, value) ->
                val expiresAt = (value as? String)?.substringAfterLast('|')?.toLongOrNull()
                expiresAt == null || expiresAt <= now
            }
            .map { it.key }
        if (stale.isEmpty()) return
        val editor = receipts.edit()
        stale.forEach(editor::remove)
        editor.apply()
    }

    private data class Incoming(
        val start: NativeDirectImageProtocol.Start,
        val target: ImageClipboardStore.IncomingImageTarget,
        val output: FileOutputStream,
        val assembler: NativeDirectImageAssembler,
        var nextChunkIndex: Int = 0,
    )

    companion object {
        private const val RECEIPT_PREFERENCES = "oaclix_received_image_direct"
        private const val CLOCK_SKEW_MS = 5L * 60L * 1000L
        private const val MIN_FREE_SPACE_RESERVE_BYTES = 128L * 1024L * 1024L
    }
}
