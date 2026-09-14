package app.oaclix.android.share

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Base64

class NativeImageDeviceShareTransportTest {
    @Test
    fun `image transfer payload keeps one receiver bytes and local retention`() {
        val bytes = "imagen-oaclix".toByteArray()
        val json = NativeImageDeviceShareTransport.transferJson(
            transferId = "xfr_0123456789abcdef01234567",
            senderDeviceId = "dev_aaaaaaaaaaaaaaaa",
            receiverDeviceId = "dev_bbbbbbbbbbbbbbbb",
            itemId = "itm_0123456789abcdef0123456789abcdef",
            mimeType = "image/png",
            bytes = bytes,
            createdAt = 1_800_000_000_000,
            expiresAt = 1_800_021_600_000,
        )

        assertEquals(1, json.getInt("version"))
        assertEquals("local-image-transfer", json.getString("type"))
        assertEquals("dev_aaaaaaaaaaaaaaaa", json.getString("senderDeviceId"))
        assertEquals("dev_bbbbbbbbbbbbbbbb", json.getString("receiverDeviceId"))
        val item = json.getJSONObject("item")
        assertEquals("image/png", item.getString("mimeType"))
        assertEquals(bytes.size, item.getInt("byteSize"))
        assertEquals(bytes.toList(), Base64.getDecoder().decode(item.getString("base64Data")).toList())
        assertEquals(21_600_000L, item.getLong("expiresAt") - item.getLong("createdAt"))
    }
}
