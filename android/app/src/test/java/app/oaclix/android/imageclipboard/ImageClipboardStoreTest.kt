package app.oaclix.android.imageclipboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageClipboardStoreTest {
    @Test
    fun `local image history keeps the short-lived retention`() {
        assertEquals(6L * 60L * 60L * 1000L, ImageClipboardStore.RETENTION_MS)
    }

    @Test
    fun `cloud image policy keeps the approved 10 MB boundary`() {
        assertEquals(10L * 1024L * 1024L, ImageTransferPolicy.CLOUD_MAX_IMAGE_BYTES)
        assertFalse(ImageTransferPolicy.requiresCloudOptimization(10L * 1024L * 1024L))
        assertTrue(ImageTransferPolicy.requiresCloudOptimization(10L * 1024L * 1024L + 1L))
    }

    @Test
    fun `cloud optimizer samples large decoded bitmaps before compression`() {
        assertEquals(1, ImageTransferPolicy.cloudDecodeSampleSize(2400, 2400))
        assertEquals(2, ImageTransferPolicy.cloudDecodeSampleSize(3000, 3000))
        assertEquals(2, ImageTransferPolicy.cloudDecodeSampleSize(6000, 4000))
        assertEquals(4, ImageTransferPolicy.cloudDecodeSampleSize(9000, 1000))
    }

    @Test
    fun `cloud optimizer can retry with progressively safer decode samples`() {
        assertEquals(listOf(2, 4, 8, 16, 32), ImageTransferPolicy.cloudDecodeSampleSizes(3000, 3000))
        assertEquals(listOf(1, 2, 4, 8, 16), ImageTransferPolicy.cloudDecodeSampleSizes(2400, 2400))
    }

    @Test
    fun `supported image mime types map to safe internal extensions`() {
        assertEquals("png", ImageClipboardStore.extensionForMime("image/png"))
        assertEquals("jpg", ImageClipboardStore.extensionForMime("image/jpeg"))
        assertEquals("webp", ImageClipboardStore.extensionForMime("image/webp"))
        assertEquals("gif", ImageClipboardStore.extensionForMime("image/gif"))
        assertNull(ImageClipboardStore.extensionForMime("image/svg+xml"))
    }

    @Test
    fun `stored extensions map back to the expected mime type`() {
        assertEquals("image/png", ImageClipboardStore.mimeForExtension("png"))
        assertEquals("image/jpeg", ImageClipboardStore.mimeForExtension("jpg"))
        assertEquals("image/webp", ImageClipboardStore.mimeForExtension("webp"))
        assertEquals("image/gif", ImageClipboardStore.mimeForExtension("gif"))
        assertNull(ImageClipboardStore.mimeForExtension("svg"))
    }
}
