package app.oaclix.android.localclipboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalClipboardPolicyTest {
    private val fixedId = "itm_00000000000000000000000000000000"

    @Test
    fun `create keeps the same six hour retention as Mi portapapeles`() {
        val item = LocalClipboardPolicy.createDraft("hola", now = 1_000L, itemId = fixedId)

        assertEquals(1_000L, item.createdAt)
        assertEquals(1_000L + 21_600_000L, item.expiresAt)
        assertEquals("hola", item.text)
    }

    @Test
    fun `received text preserves transfer identity and sender`() {
        val item = LocalClipboardPolicy.createReceived(
            text = "recibido",
            itemId = fixedId,
            senderDeviceId = "dev_aaaaaaaaaaaaaaaa",
            createdAt = 1_000L,
            expiresAt = 1_000L + LocalClipboardPolicy.TEXT_RETENTION_MS,
        )

        assertEquals(fixedId, item.id)
        assertEquals("dev_aaaaaaaaaaaaaaaa", item.receivedFromDeviceId)
        assertEquals("recibido", item.text)
    }

    @Test
    fun `received text rejects malformed sender or retention`() {
        assertThrows(IllegalArgumentException::class.java) {
            LocalClipboardPolicy.createReceived(
                text = "texto",
                itemId = fixedId,
                senderDeviceId = "invalid",
                createdAt = 1_000L,
                expiresAt = 2_000L,
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            LocalClipboardPolicy.createReceived(
                text = "texto",
                itemId = fixedId,
                senderDeviceId = "dev_aaaaaaaaaaaaaaaa",
                createdAt = 1_000L,
                expiresAt = 1_000L + LocalClipboardPolicy.TEXT_RETENTION_MS + 1L,
            )
        }
    }

    @Test
    fun `blank and oversized text fail closed`() {
        assertThrows(IllegalArgumentException::class.java) {
            LocalClipboardPolicy.createDraft("   ", now = 1L, itemId = fixedId)
        }
        assertThrows(IllegalArgumentException::class.java) {
            LocalClipboardPolicy.createDraft("x".repeat(8_001), now = 1L, itemId = fixedId)
        }
    }

    @Test
    fun `normalization removes expired or malformed records`() {
        val valid = LocalClipboardPolicy.createDraft("vigente", now = 100L, itemId = fixedId)
        val expired = valid.copy(id = "itm_11111111111111111111111111111111", expiresAt = 200L)
        val malformed = valid.copy(id = "bad-id")

        val result = LocalClipboardPolicy.normalize(listOf(malformed, expired, valid), now = 201L)

        assertEquals(listOf(valid), result)
    }

    @Test
    fun `generated ids preserve the transferable item format`() {
        val item = LocalClipboardPolicy.createDraft("texto")

        assertTrue(LocalClipboardPolicy.isValidItemId(item.id))
        assertTrue(item.id.startsWith("itm_"))
        assertEquals(36, item.id.length)
        assertFalse(item.text.isBlank())
    }
}
