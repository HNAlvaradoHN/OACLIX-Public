package app.oaclix.android.imageclipboard

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream

internal sealed interface CloudImageSourceSnapshot {
    data class InMemory(val bytes: ByteArray) : CloudImageSourceSnapshot
    data class OnDisk(val file: File) : CloudImageSourceSnapshot
}

/**
 * Reads an incoming content stream exactly once.
 *
 * Small images stay in memory so they can be relayed byte-for-byte. Once the
 * cloud limit is crossed, the bytes already read plus the rest of the stream
 * are spooled to a private cache file. Oversized images can then be decoded
 * repeatedly from that stable file without depending on the original
 * ContentProvider supporting multiple opens/decodes of the same URI.
 */
internal object ImageCloudSourceSpooler {
    private const val BUFFER_SIZE = 64 * 1024

    fun snapshot(input: InputStream, maxInMemoryBytes: Long, tempFile: File): CloudImageSourceSnapshot {
        require(maxInMemoryBytes >= 0L) { "Límite de imagen inválido" }

        val memory = ByteArrayOutputStream()
        val buffer = ByteArray(BUFFER_SIZE)
        var disk: FileOutputStream? = null
        var total = 0L

        try {
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (count == 0) continue

                val nextTotal = total + count
                if (disk == null && nextTotal <= maxInMemoryBytes) {
                    memory.write(buffer, 0, count)
                } else {
                    if (disk == null) {
                        disk = FileOutputStream(tempFile, false)
                        memory.writeTo(disk)
                    }
                    disk.write(buffer, 0, count)
                }
                total = nextTotal
            }

            require(total > 0L) { "No se pudo leer la imagen" }
            disk?.flush()
            return if (disk == null) {
                CloudImageSourceSnapshot.InMemory(memory.toByteArray())
            } else {
                CloudImageSourceSnapshot.OnDisk(tempFile)
            }
        } catch (error: Exception) {
            tempFile.delete()
            throw error
        } finally {
            disk?.close()
        }
    }
}
