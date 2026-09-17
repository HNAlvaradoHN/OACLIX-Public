package app.oaclix.android.fileclipboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class FileClipboardStoreTest {
    private val id = "123e4567-e89b-12d3-a456-426614174000"

    @Test
    fun `generic files use the same six-hour local retention`() {
        assertEquals(6L * 60L * 60L * 1000L, FileClipboardStore.RETENTION_MS)
    }

    @Test
    fun `stored filename round trips mime type and safe display name`() {
        val fileName = FileClipboardStore.storedFileName(
            createdAt = 1_700_000_000_000L,
            id = id,
            mimeType = "application/pdf",
            displayName = "Informe / final.pdf",
        )

        val parsed = FileClipboardStore.parseStoredFileName(fileName)
        assertNotNull(parsed)
        assertEquals(1_700_000_000_000L, parsed?.createdAt)
        assertEquals(id, parsed?.id)
        assertEquals("application/pdf", parsed?.mimeType)
        assertEquals("Informe _ final.pdf", parsed?.displayName)
        assertFalse(fileName.contains('/'))
    }

    @Test
    fun `provider rejects arbitrary paths and malformed filenames`() {
        assertNull(FileClipboardStore.parseStoredFileName("../../secret.pdf"))
        assertNull(FileClipboardStore.parseStoredFileName("not-an-oaclix-file"))
    }

    @Test
    fun `provider authority is isolated from image and text providers`() {
        assertEquals("app.oaclix.android.files", FileClipboardStore.providerAuthority("app.oaclix.android"))
    }
}
