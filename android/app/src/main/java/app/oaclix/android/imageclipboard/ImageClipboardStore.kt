package app.oaclix.android.imageclipboard

import android.content.Context
import android.net.Uri
import java.io.ByteArrayInputStream
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
    private val incomingDirectory = File(context.filesDir, INCOMING_DIRECTORY_NAME)

    internal data class IncomingImageTarget(
        val tempFile: File,
        val targetFile: File,
    )

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

        return context.contentResolver.openInputStream(uri)?.use { input ->
            createFromStream(input, mimeType, now)
        } ?: error("No se pudo abrir la imagen")
    }

    fun createFromBytes(
        bytes: ByteArray,
        mimeType: String,
        now: Long = System.currentTimeMillis(),
    ): ImageClipboardItem {
        require(bytes.isNotEmpty()) { "La imagen está vacía" }
        return ByteArrayInputStream(bytes).use { input -> createFromStream(input, mimeType, now) }
    }

    fun createFromStream(
        input: InputStream,
        mimeType: String,
        now: Long = System.currentTimeMillis(),
    ): ImageClipboardItem {
        val normalizedMimeType = mimeType.lowercase()
        val extension = extensionForMime(normalizedMimeType)
            ?: error("Formato de imagen todavía no compatible: $mimeType")
        return writeNewImage(now, extension) { temp ->
            FileOutputStream(temp).use { output ->
                val buffer = ByteArray(BUFFER_SIZE)
                var total = 0L
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (read == 0) continue
                    total += read
                    output.write(buffer, 0, read)
                }
                require(total > 0L) { "La imagen está vacía" }
                output.flush()
            }
        }
    }


    internal fun availableIncomingBytes(now: Long = System.currentTimeMillis()): Long {
        directory.mkdirs()
        incomingDirectory.mkdirs()
        cleanup(now)
        cleanupIncoming(now)
        return incomingDirectory.usableSpace
    }

    internal fun createIncomingTarget(
        mimeType: String,
        createdAt: Long = System.currentTimeMillis(),
    ): IncomingImageTarget {
        val extension = extensionForMime(mimeType.lowercase())
            ?: error("Formato de imagen todavía no compatible: $mimeType")
        directory.mkdirs()
        incomingDirectory.mkdirs()
        val now = System.currentTimeMillis()
        cleanup(now)
        cleanupIncoming(now)

        val id = UUID.randomUUID().toString()
        val fileName = "${createdAt}_${id}.$extension"
        val target = File(directory, fileName)
        val temp = File(incomingDirectory, "$fileName$INCOMING_SUFFIX")
        require(target.canonicalFile.parentFile == directory.canonicalFile) { "Destino de imagen inválido" }
        require(temp.canonicalFile.parentFile == incomingDirectory.canonicalFile) { "Temporal de imagen inválido" }
        temp.delete()
        return IncomingImageTarget(temp, target)
    }

    internal fun commitIncomingTarget(
        incoming: IncomingImageTarget,
        expectedByteSize: Long,
    ): ImageClipboardItem {
        require(expectedByteSize > 0L) { "Tamaño de imagen inválido" }
        require(incoming.tempFile.canonicalFile.parentFile == incomingDirectory.canonicalFile) {
            "Temporal de imagen inválido"
        }
        require(incoming.targetFile.canonicalFile.parentFile == directory.canonicalFile) {
            "Destino de imagen inválido"
        }
        require(incoming.tempFile.isFile && incoming.tempFile.length() == expectedByteSize) {
            "La imagen recibida no coincide con el tamaño declarado"
        }
        require(!incoming.targetFile.exists()) { "El destino de imagen ya existe" }
        require(incoming.tempFile.renameTo(incoming.targetFile)) { "No se pudo guardar la imagen recibida" }
        return itemForFile(incoming.targetFile) ?: run {
            incoming.targetFile.delete()
            error("No se pudo registrar la imagen recibida")
        }
    }

    internal fun discardIncomingTarget(incoming: IncomingImageTarget) {
        if (incoming.tempFile.canonicalFile.parentFile == incomingDirectory.canonicalFile) {
            incoming.tempFile.delete()
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


    private fun cleanupIncoming(now: Long) {
        if (!incomingDirectory.exists()) return
        val staleBefore = now - RETENTION_MS
        incomingDirectory.listFiles().orEmpty().forEach { file ->
            if (!file.isFile || !file.name.endsWith(INCOMING_SUFFIX) || file.lastModified() <= staleBefore) {
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
        private const val INCOMING_DIRECTORY_NAME = "oaclix-images-incoming"
        const val RETENTION_MS = 6L * 60L * 60L * 1000L
        private const val BUFFER_SIZE = 64 * 1024
        private const val TEMP_SUFFIX = ".tmp"
        private const val INCOMING_SUFFIX = ".part"
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
