package app.oaclix.android.imageclipboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ImageClipboardStoreTest {
    @Test
    fun `local image history keeps the short-lived retention`() {
        assertEquals(6L * 60L * 60L * 1000L, ImageClipboardStore.RETENTION_MS)
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
