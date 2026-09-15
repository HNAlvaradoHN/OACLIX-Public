package app.oaclix.android.share

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class NativeDirectImageProtocolTest {
    private fun validStart(byteSize: Long = 131_073L) = JSONObject()
        .put("version", 1)
        .put("type", "local-image-direct-start")
        .put("transferId", "ixf_0123456789abcdef01234567")
        .put("senderDeviceId", "dev_aaaaaaaaaaaaaaaa")
        .put("receiverDeviceId", "dev_bbbbbbbbbbbbbbbb")
        .put("chunkSize", 65_536)
        .put("chunkCount", ((byteSize + 65_535L) / 65_536L).toInt())
        .put("item", JSONObject()
            .put("id", "itm_0123456789abcdef0123456789abcdef")
            .put("mimeType", "image/png")
            .put("byteSize", byteSize)
            .put("createdAt", 1_800_000_000_000L)
            .put("expiresAt", 1_800_021_600_000L))

    @Test
    fun `start contract matches PWA direct image framing`() {
        val start = NativeDirectImageProtocol.parseStart(validStart())
        assertNotNull(start)
        start!!
        assertEquals(65_536, start.chunkSize)
        assertEquals(3, start.chunkCount)
        assertEquals(65_536, NativeDirectImageProtocol.expectedChunkBytes(start, 0))
        assertEquals(65_536, NativeDirectImageProtocol.expectedChunkBytes(start, 1))
        assertEquals(1, NativeDirectImageProtocol.expectedChunkBytes(start, 2))
    }

    @Test
    fun `rejects altered chunk contract and invalid destination`() {
        assertNull(NativeDirectImageProtocol.parseStart(validStart().put("chunkSize", 262_144)))
        assertNull(NativeDirectImageProtocol.parseStart(validStart().put("receiverDeviceId", "dev_aaaaaaaaaaaaaaaa")))
        assertNull(NativeDirectImageProtocol.parseStart(validStart().put("chunkCount", 2)))
    }

    @Test
    fun `rejects image sizes whose direct chunk count cannot fit the wire integer`() {
        val tooLarge = Int.MAX_VALUE.toLong() * NativeDirectImageProtocol.CHUNK_BYTES + 1L
        val json = validStart(1L)
            .put("chunkCount", Int.MAX_VALUE)
        json.getJSONObject("item").put("byteSize", tooLarge)
        assertNull(NativeDirectImageProtocol.parseStart(json))
    }

    @Test
    fun `ack is tied to exact transfer sender receiver and item`() {
        val start = NativeDirectImageProtocol.parseStart(validStart())!!
        val ackJson = NativeDirectImageProtocol.ackJson(start, "stored")
        val ack = NativeDirectImageProtocol.parseAck(ackJson)
        assertNotNull(ack)
        assertEquals(start.transferId, ack!!.transferId)
        assertEquals(start.senderDeviceId, ack.senderDeviceId)
        assertEquals(start.receiverDeviceId, ack.receiverDeviceId)
        assertEquals(start.item.id, ack.itemId)
        assertEquals("stored", ack.status)
        assertNull(NativeDirectImageProtocol.parseAck(JSONObject(ackJson.toString()).put("status", "ok")))
    }
}
