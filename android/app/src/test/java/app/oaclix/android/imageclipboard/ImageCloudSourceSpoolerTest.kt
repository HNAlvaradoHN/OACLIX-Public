package app.oaclix.android.imageclipboard

import java.io.ByteArrayInputStream
import java.nio.file.Files
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageCloudSourceSpoolerTest {
    @Test
    fun `source at cloud limit stays byte exact in memory`() {
        val bytes = ByteArray(1024) { index -> (index % 251).toByte() }
        val tempFile = Files.createTempFile("oaclix-cloud-small-", ".bin").toFile()
        tempFile.delete()

        val result = ImageCloudSourceSpooler.snapshot(
            ByteArrayInputStream(bytes),
            maxInMemoryBytes = bytes.size.toLong(),
            tempFile = tempFile,
        )

        assertTrue(result is CloudImageSourceSnapshot.InMemory)
        assertArrayEquals(bytes, (result as CloudImageSourceSnapshot.InMemory).bytes)
        assertFalse(tempFile.exists())
    }

    @Test
    fun `oversized source is spooled byte exact to disk from one input stream`() {
        val bytes = ByteArray(4097) { index -> (index % 239).toByte() }
        val tempFile = Files.createTempFile("oaclix-cloud-large-", ".bin").toFile()

        val result = ImageCloudSourceSpooler.snapshot(
            ByteArrayInputStream(bytes),
            maxInMemoryBytes = 1024,
            tempFile = tempFile,
        )

        assertTrue(result is CloudImageSourceSnapshot.OnDisk)
        assertArrayEquals(bytes, tempFile.readBytes())
        tempFile.delete()
    }
}
