package app.oaclix.android.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class NativeDeviceShareTransportTest {
    @Test
    fun `transfer payload keeps one explicit receiver and local retention`() {
        val json = NativeDeviceShareTransport.transferJson(
            transferId = "xfr_0123456789abcdef01234567",
            senderDeviceId = "dev_aaaaaaaaaaaaaaaa",
            receiverDeviceId = "dev_bbbbbbbbbbbbbbbb",
            itemId = "itm_0123456789abcdef0123456789abcdef",
            text = "Android dirigido",
            createdAt = 1_800_000_000_000,
            expiresAt = 1_800_021_600_000,
        )

        assertEquals(1, json.getInt("version"))
        assertEquals("local-clipboard-transfer", json.getString("type"))
        assertEquals("dev_aaaaaaaaaaaaaaaa", json.getString("senderDeviceId"))
        assertEquals("dev_bbbbbbbbbbbbbbbb", json.getString("receiverDeviceId"))
        assertEquals("Android dirigido", json.getJSONObject("item").getString("text"))
        assertEquals(21_600_000L, json.getJSONObject("item").getLong("expiresAt") - json.getJSONObject("item").getLong("createdAt"))
    }

    @Test
    fun `auth envelope encoding is URL safe and unpadded`() {
        val encoded = NativeDeviceShareTransport.base64Url("{\"roomId\":\"room_12345678\"}")
        assertFalse(encoded.contains('+'))
        assertFalse(encoded.contains('/'))
        assertFalse(encoded.contains('='))
    }
}
