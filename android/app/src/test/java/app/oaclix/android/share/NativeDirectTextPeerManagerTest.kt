package app.oaclix.android.share

import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeDirectTextPeerManagerTest {
    @Test
    fun `exactly one device initiates a peer connection`() {
        val first = "dev_aaaaaaaaaaaaaaaa"
        val second = "dev_bbbbbbbbbbbbbbbb"

        assertTrue(NativeDirectTextPeerManager.shouldInitiate(first, second))
        assertFalse(NativeDirectTextPeerManager.shouldInitiate(second, first))
    }

    @Test
    fun `same device or malformed device cannot negotiate`() {
        val device = "dev_aaaaaaaaaaaaaaaa"

        assertThrows(IllegalArgumentException::class.java) {
            NativeDirectTextPeerManager.shouldInitiate(device, device)
        }
        assertThrows(IllegalArgumentException::class.java) {
            NativeDirectTextPeerManager.shouldInitiate("invalid", device)
        }
    }
}
