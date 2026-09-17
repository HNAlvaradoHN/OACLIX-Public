package app.oaclix.android.fileclipboard

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import java.io.File
import java.io.FileOutputStream
import java.util.Base64
import java.util.UUID

/**
 * Local-only generic file history for OACLIX.
 *
 * Files are copied byte-for-byte into app-private storage. The internal file
 * name contains only generated/safely encoded metadata; the user-facing name
 * is returned through the content provider when another app receives a
 * temporary read grant.
 */
data class FileClipboardItem(
    val id: String,
    val fileName: String,
    val displayName: String,
    val mimeType: String,
    val byteSize: Long,
    val createdAt: Long,
    val expiresAt: Long,
)

internal data class StoredFileName(
    val createdAt: Long,
    val id: String,
    val mimeType: String,
    val displayName: String,
)

class FileClipboardStore(private val context: Context) {
    private val directory = File(context.filesDir, DIRECTORY_NAME)

    fun list(now: Long = System.currentTimeMillis()): List<FileClipboardItem> {
        cleanup(now)
        return directory
            .takeIf { it.exists() }
            ?.listFiles()
            .orEmpty()
            .filter { it.isFile && !it.name.endsWith(TEMP_SUFFIX) }
            .mapNotNull(::itemForFile)
            .filter { it.expiresAt > now }
            .sortedWith(compareByDescending<FileClipboardItem> { it.createdAt }.thenByDescending { it.id })
    }

    fun createFromUri(uri: Uri, now: Long = System.currentTimeMillis()): FileClipboardItem {
        val displayName = normalizeDisplayName(resolveDisplayName(uri))
        val mimeType = normalizeMimeType(context.contentResolver.getType(uri), displayName)
        val id = UUID.randomUUID().toString()
        val fileName = storedFileName(now, id, mimeType, displayName)

        directory.mkdirs()
        cleanup(now)
        val target = fileFor(fileName)
        val temp = File(directory, "$fileName$TEMP_SUFFIX")
        try {
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
                    require(total > 0L) { "El archivo está vacío" }
                    output.flush()
                }
            } ?: error("No se pudo abrir el archivo")

            require(temp.isFile && temp.length() > 0L) { "El archivo está vacío" }
            require(temp.renameTo(target)) { "No se pudo guardar el archivo" }
            return itemForFile(target) ?: error("No se pudo registrar el archivo")
        } catch (error: Exception) {
            temp.delete()
            target.delete()
            throw error
        }
    }

    fun delete(item: FileClipboardItem) {
        fileFor(item.fileName).delete()
    }

    fun contentUri(item: FileClipboardItem): Uri = Uri.Builder()
        .scheme("content")
        .authority(providerAuthority(context.packageName))
        .appendPath(item.fileName)
        .build()

    private fun resolveDisplayName(uri: Uri): String {
        val fromProvider = runCatching {
            context.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor ->
                if (!cursor.moveToFirst()) return@use null
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index < 0) null else cursor.getString(index)
            }
        }.getOrNull()
        return fromProvider?.takeIf { it.isNotBlank() }
            ?: uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() }
            ?: "archivo"
    }

    private fun cleanup(now: Long) {
        if (!directory.exists()) return
        directory.listFiles().orEmpty().forEach { file ->
            if (file.name.endsWith(TEMP_SUFFIX)) {
                file.delete()
                return@forEach
            }
            val item = itemForFile(file)
            if (item == null || item.expiresAt <= now || file.length() <= 0L) {
                file.delete()
            }
        }
    }

    private fun itemForFile(file: File): FileClipboardItem? {
        if (!file.isFile) return null
        val stored = parseStoredFileName(file.name) ?: return null
        return FileClipboardItem(
            id = stored.id,
            fileName = file.name,
            displayName = stored.displayName,
            mimeType = stored.mimeType,
            byteSize = file.length(),
            createdAt = stored.createdAt,
            expiresAt = stored.createdAt + RETENTION_MS,
        )
    }

    private fun fileFor(fileName: String): File {
        require(parseStoredFileName(fileName) != null) { "Archivo inválido" }
        val file = File(directory, fileName)
        require(file.canonicalFile.parentFile == directory.canonicalFile) { "Archivo inválido" }
        return file
    }

    companion object {
        const val DIRECTORY_NAME = "oaclix-files"
        const val RETENTION_MS = 6L * 60L * 60L * 1000L
        private const val BUFFER_SIZE = 64 * 1024
        private const val TEMP_SUFFIX = ".tmp"
        private const val MAX_DISPLAY_NAME_BYTES = 48
        private const val FALLBACK_MIME = "application/octet-stream"
        private val FILE_PATTERN = Regex(
            "^(\\d{1,13})_([0-9a-fA-F-]{36})_([A-Za-z0-9_-]+)_([A-Za-z0-9_-]+)\\.bin$",
        )
        private val MIME_PATTERN = Regex("^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$")

        fun providerAuthority(packageName: String): String = "$packageName.files"

        internal fun storedFileName(
            createdAt: Long,
            id: String,
            mimeType: String,
            displayName: String,
        ): String {
            require(createdAt >= 0L) { "Hora de archivo inválida" }
            require(UUID_PATTERN.matches(id)) { "Identificador de archivo inválido" }
            val safeName = normalizeDisplayName(displayName)
            val safeMime = normalizeMimeType(mimeType, safeName)
            return "${createdAt}_${id}_${encodeToken(safeMime)}_${encodeToken(safeName)}.bin"
        }

        internal fun parseStoredFileName(fileName: String): StoredFileName? {
            val match = FILE_PATTERN.matchEntire(fileName) ?: return null
            val createdAt = match.groupValues[1].toLongOrNull() ?: return null
            val id = match.groupValues[2]
            if (!UUID_PATTERN.matches(id)) return null
            val mimeType = decodeToken(match.groupValues[3]) ?: return null
            val displayName = decodeToken(match.groupValues[4]) ?: return null
            if (!MIME_PATTERN.matches(mimeType)) return null
            if (displayName.isBlank()) return null
            return StoredFileName(createdAt, id, mimeType, displayName)
        }

        internal fun normalizeDisplayName(value: String): String {
            val cleaned = buildString {
                var index = 0
                val source = value.trim()
                while (index < source.length) {
                    val codePoint = source.codePointAt(index)
                    when {
                        codePoint == '/'.code || codePoint == '\\'.code -> append('_')
                        Character.isISOControl(codePoint) -> append('_')
                        else -> appendCodePoint(codePoint)
                    }
                    index += Character.charCount(codePoint)
                }
            }.ifBlank { "archivo" }
            return truncateUtf8(cleaned, MAX_DISPLAY_NAME_BYTES).ifBlank { "archivo" }
        }

        private fun normalizeMimeType(value: String?, displayName: String): String {
            val candidate = value?.trim()?.lowercase()
            if (candidate != null && candidate.toByteArray(Charsets.UTF_8).size <= 96 && MIME_PATTERN.matches(candidate)) {
                return candidate
            }
            val extension = displayName.substringAfterLast('.', "").lowercase()
            return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
                ?.lowercase()
                ?.takeIf(MIME_PATTERN::matches)
                ?: FALLBACK_MIME
        }

        private fun truncateUtf8(value: String, maxBytes: Int): String {
            val builder = StringBuilder()
            var used = 0
            var index = 0
            while (index < value.length) {
                val codePoint = value.codePointAt(index)
                val chunk = String(Character.toChars(codePoint))
                val chunkBytes = chunk.toByteArray(Charsets.UTF_8).size
                if (used + chunkBytes > maxBytes) break
                builder.append(chunk)
                used += chunkBytes
                index += Character.charCount(codePoint)
            }
            return builder.toString()
        }

        private fun encodeToken(value: String): String = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(value.toByteArray(Charsets.UTF_8))

        private fun decodeToken(value: String): String? = runCatching {
            String(Base64.getUrlDecoder().decode(value), Charsets.UTF_8)
        }.getOrNull()

        private val UUID_PATTERN = Regex(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        )
    }
}
