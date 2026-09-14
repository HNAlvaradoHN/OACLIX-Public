package app.oaclix.android.imageclipboard

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.util.UUID

/**
 * Local-only image history for OACLIX.
 *
 * Images are copied byte-for-byte into the app's private files directory and
 * deleted after the same short-lived window used by Mi portapapeles. Local
 * storage deliberately has no cloud-plan size cap; practical limits are the
 * device/OS and available storage.
 */
data class ImageClipboardItem(
    val id: String,
    val fileName: String,
    val mimeType: String,
    val byteSize: Long,
    val createdAt: Long,
    val expiresAt: Long,
)

class ImageClipboardStore(private val context: Context) {
    private val directory = File(context.filesDir, DIRECTORY_NAME)

    fun list(now: Long = System.currentTimeMillis()): List<ImageClipboardItem> {
        cleanup(now)
        return directory
            .takeIf { it.exists() }
            ?.listFiles()
            .orEmpty()
            .filter { it.isFile && !it.name.endsWith(TEMP_SUFFIX) }
            .mapNotNull(::itemForFile)
            .filter { it.expiresAt > now }
            .sortedWith(compareByDescending<ImageClipboardItem> { it.createdAt }.thenByDescending { it.id })
    }

    fun createFromUri(
        uri: Uri,
        now: Long = System.currentTimeMillis(),
        mimeTypeHint: String? = null,
    ): ImageClipboardItem {
        val mimeType = listOfNotNull(
            context.contentResolver.getType(uri),
            mimeTypeHint,
        )
            .map { it.lowercase() }
            .firstOrNull { it.startsWith("image/") && extensionForMime(it) != null }
            ?: error("El contenido no contiene una imagen compatible")
        val extension = extensionForMime(mimeType)
            ?: error("Formato de imagen todavía no compatible: $mimeType")

        return writeNewImage(now, extension) { temp ->
            context.contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(temp).use { output ->
                    val buffer = ByteArray(BUFFER_SIZE)
                    var total = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        output.write(buffer, 0, read)
                    }
                    require(total > 0L) { "La imagen está vacía" }
                    output.flush()
                }
            } ?: error("No se pudo abrir la imagen")
        }
    }

    fun createFromBytes(
        bytes: ByteArray,
        mimeType: String,
        now: Long = System.currentTimeMillis(),
    ): ImageClipboardItem {
        require(bytes.isNotEmpty()) { "La imagen está vacía" }
        val extension = extensionForMime(mimeType)
            ?: error("Formato de imagen todavía no compatible: $mimeType")
        return writeNewImage(now, extension) { temp ->
            FileOutputStream(temp).use { output ->
                output.write(bytes)
                output.flush()
            }
        }
    }

    fun delete(item: ImageClipboardItem) {
        fileFor(item.fileName).delete()
    }

    fun openInputStream(item: ImageClipboardItem): InputStream {
        val file = fileFor(item.fileName)
        require(file.isFile) { "Imagen no disponible" }
        return FileInputStream(file)
    }

    fun contentUri(item: ImageClipboardItem): Uri = Uri.Builder()
        .scheme("content")
        .authority(providerAuthority(context.packageName))
        .appendPath(item.fileName)
        .build()

    private fun writeNewImage(now: Long, extension: String, writer: (File) -> Unit): ImageClipboardItem {
        directory.mkdirs()
        cleanup(now)
        val id = UUID.randomUUID().toString()
        val fileName = "${now}_${id}.$extension"
        val target = File(directory, fileName)
        val temp = File(directory, "$fileName$TEMP_SUFFIX")
        try {
            writer(temp)
            require(temp.isFile && temp.length() > 0L) { "La imagen está vacía" }
            require(temp.renameTo(target)) { "No se pudo guardar la imagen" }
            return itemForFile(target) ?: error("No se pudo registrar la imagen")
        } catch (error: Exception) {
            temp.delete()
            target.delete()
            throw error
        }
    }

    private fun cleanup(now: Long) {
        if (!directory.exists()) return
        directory.listFiles().orEmpty().forEach { file ->
            val item = itemForFile(file)
            if (file.name.endsWith(TEMP_SUFFIX) || item == null || item.expiresAt <= now) {
                file.delete()
            }
        }
    }

    private fun itemForFile(file: File): ImageClipboardItem? {
        if (!file.isFile) return null
        val match = FILE_PATTERN.matchEntire(file.name) ?: return null
        val createdAt = match.groupValues[1].toLongOrNull() ?: return null
        val extension = match.groupValues[3].lowercase()
        val mimeType = mimeForExtension(extension) ?: return null
        return ImageClipboardItem(
            id = match.groupValues[2],
            fileName = file.name,
            mimeType = mimeType,
            byteSize = file.length(),
            createdAt = createdAt,
            expiresAt = createdAt + RETENTION_MS,
        )
    }

    private fun fileFor(fileName: String): File {
        require(FILE_PATTERN.matches(fileName)) { "Imagen inválida" }
        val file = File(directory, fileName)
        require(file.canonicalFile.parentFile == directory.canonicalFile) { "Imagen inválida" }
        return file
    }

    companion object {
        const val DIRECTORY_NAME = "oaclix-images"
        const val RETENTION_MS = 6L * 60L * 60L * 1000L
        private const val BUFFER_SIZE = 64 * 1024
        private const val TEMP_SUFFIX = ".tmp"
        private val FILE_PATTERN = Regex("(\\d+)_([0-9a-fA-F-]{36})\\.([a-z0-9]+)")

        fun providerAuthority(packageName: String): String = "$packageName.images"

        fun extensionForMime(mimeType: String): String? = when (mimeType.lowercase()) {
            "image/png" -> "png"
            "image/jpeg", "image/jpg" -> "jpg"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            else -> null
        }

        fun mimeForExtension(extension: String): String? = when (extension.lowercase()) {
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            else -> null
        }
    }
}
