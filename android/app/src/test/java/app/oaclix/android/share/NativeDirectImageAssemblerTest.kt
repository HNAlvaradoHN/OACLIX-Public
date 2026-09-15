package app.oaclix.android.share

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream

class NativeDirectImageAssemblerTest {
    @Test
    fun `assembles declared bytes sequentially and completes on final chunk`() {
        val output = ByteArrayOutputStream()
        val assembler = NativeDirectImageAssembler(
            byteSize = 131_073L,
            chunkSize = 65_536,
            chunkCount = 3,
            output = output,
        )
        val first = ByteArray(65_536) { 1 }
        val second = ByteArray(65_536) { 2 }
        val last = byteArrayOf(3)

        assertFalse(assembler.append(0, first))
        assertFalse(assembler.append(1, second))
        assertTrue(assembler.append(2, last))
        assertTrue(assembler.isComplete())
        assertEquals(131_073L, assembler.bytesWritten())
        assertEquals(1, assembler.expectedChunkBytes(2))

        val expected = first + second + last
        assertArrayEquals(expected, output.toByteArray())
    }

    @Test
    fun `rejects out of order and wrong sized chunks before writing them`() {
        val output = ByteArrayOutputStream()
        val assembler = NativeDirectImageAssembler(
            byteSize = 65_537L,
            chunkSize = 65_536,
            chunkCount = 2,
            output = output,
        )

        expectFailure("Chunk fuera de orden") {
            assembler.append(1, byteArrayOf(1))
        }
        assertEquals(0L, assembler.bytesWritten())

        expectFailure("Tamaño de chunk inesperado") {
            assembler.append(0, byteArrayOf(1))
        }
        assertEquals(0L, assembler.bytesWritten())
    }

    @Test
    fun `rejects an envelope whose chunk count cannot cover the declared size`() {
        expectFailure("Cantidad de chunks no coincide") {
            NativeDirectImageAssembler(
                byteSize = 131_073L,
                chunkSize = 65_536,
                chunkCount = 2,
                output = ByteArrayOutputStream(),
            )
        }
    }

    @Test
    fun `cannot accept bytes after completion`() {
        val assembler = NativeDirectImageAssembler(
            byteSize = 1L,
            chunkSize = 65_536,
            chunkCount = 1,
            output = ByteArrayOutputStream(),
        )
        assertTrue(assembler.append(0, byteArrayOf(7)))

        expectFailure("La transferencia ya terminó") {
            assembler.append(0, byteArrayOf(7))
        }
    }

    private fun expectFailure(messagePart: String, block: () -> Unit) {
        try {
            block()
            fail("Se esperaba una excepción")
        } catch (error: IllegalArgumentException) {
            assertTrue(error.message.orEmpty().contains(messagePart))
        } catch (error: IllegalStateException) {
            assertTrue(error.message.orEmpty().contains(messagePart))
        }
    }
}
