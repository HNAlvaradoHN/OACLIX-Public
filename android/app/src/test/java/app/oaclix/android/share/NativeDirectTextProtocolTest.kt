package app.oaclix.android.share

import app.oaclix.android.localclipboard.LocalClipboardPolicy
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeDirectTextProtocolTest {
    private val sender = "dev_aaaaaaaaaaaaaaaa"
    private val receiver = "dev_bbbbbbbbbbbbbbbb"
    private val transferId = "xfr_0123456789abcdef01234567"
    private val itemId = "itm_0123456789abcdef0123456789abcdef"
    private val now = 1_800_000_000_000L

    @Test
    fun `transfer round trip keeps payload in data frame and validates endpoints`() {
        val frame = NativeDirectTextProtocol.createTransferFrame(
            senderDeviceId = sender,
            receiverDeviceId = receiver,
            text = "texto privado",
            now = now,
            transferId = transferId,
            itemId = itemId,
        )

        val parsed = NativeDirectTextProtocol.parseTransferFrame(
            message = frame,
            expectedRemoteDeviceId = sender,
            currentDeviceId = receiver,
            now = now,
        )

        requireNotNull(parsed)
        assertEquals("texto privado", parsed.text)
        assertEquals(transferId, parsed.transferId)
        assertEquals(itemId, parsed.itemId)
        assertEquals(now + LocalClipboardPolicy.TEXT_RETENTION_MS, parsed.expiresAt)
        assertNull(NativeDirectTextProtocol.parseTransferFrame(frame, receiver, sender, now))
    }

    @Test
    fun `ack is accepted only in reverse direction for the same direct transfer`() {
        val transfer = NativeDirectTextProtocol.parseTransferFrame(
            NativeDirectTextProtocol.createTransferFrame(
                senderDeviceId = sender,
                receiverDeviceId = receiver,
                text = "hola",
                now = now,
                transferId = transferId,
                itemId = itemId,
            ),
            expectedRemoteDeviceId = sender,
            currentDeviceId = receiver,
            now = now,
        )!!
        val ackFrame = NativeDirectTextProtocol.createAckFrame(
            transfer,
            NativeDirectTextProtocol.AckStatus.Stored,
        )

        val ack = NativeDirectTextProtocol.parseAckFrame(
            ackFrame,
            expectedRemoteDeviceId = receiver,
            currentDeviceId = sender,
        )
        requireNotNull(ack)
        assertEquals(NativeDirectTextProtocol.AckStatus.Stored, ack.status)
        assertEquals(transferId, ack.transferId)
        assertNull(NativeDirectTextProtocol.parseAckFrame(ackFrame, sender, receiver))
    }

    @Test
    fun `malformed oversized or over-retained payload is rejected`() {
        val oversized = NativeDirectTextProtocol.createTransferFrame(
            senderDeviceId = sender,
            receiverDeviceId = receiver,
            text = "a".repeat(LocalClipboardPolicy.MAX_TEXT_LENGTH),
            now = now,
            transferId = transferId,
            itemId = itemId,
        )
        oversized.getJSONObject("item").put("text", "a".repeat(LocalClipboardPolicy.MAX_TEXT_LENGTH + 1))
        assertNull(NativeDirectTextProtocol.parseTransferFrame(oversized, sender, receiver, now))

        val overRetained = NativeDirectTextProtocol.createTransferFrame(
            senderDeviceId = sender,
            receiverDeviceId = receiver,
            text = "hola",
            now = now,
            transferId = transferId,
            itemId = itemId,
        )
        overRetained.getJSONObject("item").put(
            "expiresAt",
            now + LocalClipboardPolicy.TEXT_RETENTION_MS + 1,
        )
        assertNull(NativeDirectTextProtocol.parseTransferFrame(overRetained, sender, receiver, now))
    }

    @Test
    fun `signal protocol cannot serialize direct text payload`() {
        val signal = NativeDirectSignalProtocol.descriptionFrame(
            targetDeviceId = receiver,
            negotiationId = "0123456789abcdef01234567",
            negotiationGeneration = 1,
            type = "offer",
            sdp = "v=0\r\n",
        ).toString()
        assertFalse(signal.contains("texto privado"))
        assertFalse(signal.contains(NativeDirectTextProtocol.TRANSFER_TYPE))

        val dataFrame = NativeDirectTextProtocol.createTransferFrame(
            senderDeviceId = sender,
            receiverDeviceId = receiver,
            text = "texto privado",
            now = now,
            transferId = transferId,
            itemId = itemId,
        )
        assertTrue(dataFrame.toString().contains("texto privado"))
    }
}
