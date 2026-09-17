package app.oaclix.android.localclipboard

import android.content.Context
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.SecureRandom

data class LargeTextFileItem(
    val id: String,
    val createdAt: Long,
    val expiresAt: Long,
    val byteSize: Long,
    val preview: String,
)

class LargeTextFileStore(context: Context) {
    private val appContext = context.applicationContext
    private val directory = File(appContext.filesDir, DIRECTORY_NAME)

    fun list(now: Long = System.currentTimeMillis()): List<LargeTextFileItem> {
        if (!directory.exists()) return emptyList()

        return directory.listFiles().orEmpty()
            .mapNotNull { file -> itemFromFile(file, now) }
            .sortedWith(compareByDescending<LargeTextFileItem> { it.createdAt }.thenByDescending { it.id })
    }

    fun create(text: String, now: Long = System.currentTimeMillis()): LargeTextFileItem {
        require(text.isNotBlank()) { "Escribe o pega un texto primero" }
        require(text.length > LocalClipboardPolicy.MAX_TEXT_LENGTH) {
            "El texto normal debe guardarse en el historial local"
        }

        val bytes = text.toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_FILE_BYTES) {
            "El texto supera el límite seguro de ${MAX_FILE_BYTES / 1024} KB para esta prueba"
        }

        if (!directory.exists() && !directory.mkdirs()) {
            error("No se pudo preparar el almacenamiento local de texto largo")
        }

        val id = createItemId(now)
        val file = File(directory, "$id.txt")
        file.writeBytes(bytes)

        return LargeTextFileItem(
            id = id,
            createdAt = now,
            expiresAt = now + LocalClipboardPolicy.TEXT_RETENTION_MS,
            byteSize = bytes.size.toLong(),
            preview = preview(text),
        )
    }

    fun read(item: LargeTextFileItem, now: Long = System.currentTimeMillis()): String {
        require(FILE_ID_PATTERN.matches(item.id)) { "Identificador de texto largo inválido" }
        if (item.expiresAt <= now) {
            delete(item)
            error("Este texto ya venció")
        }

        val file = File(directory, "${item.id}.txt")
        require(file.isFile) { "El archivo de texto ya no está disponible" }
        val bytes = file.inputStream().use(::readLimitedBytes)
        return decodeUtf8(bytes).also { text ->
            require(text.isNotBlank()) { "El archivo de texto está vacío" }
        }
    }

    fun contentUri(item: LargeTextFileItem): Uri {
        require(FILE_ID_PATTERN.matches(item.id)) { "Identificador de texto largo inválido" }
        return Uri.Builder()
            .scheme("content")
            .authority(providerAuthority(appContext.packageName))
            .appendPath("${item.id}.txt")
            .build()
    }

    fun delete(item: LargeTextFileItem) {
        require(FILE_ID_PATTERN.matches(item.id)) { "Identificador de texto largo inválido" }
        File(directory, "${item.id}.txt").delete()
    }

    fun readSharedText(uri: Uri): String {
        val input = appContext.contentResolver.openInputStream(uri)
            ?: error("No se pudo abrir el archivo compartido")
        val bytes = input.use(::readLimitedBytes)
        val text = decodeUtf8(bytes)
        require(text.isNotBlank()) { "El archivo compartido no contiene texto" }
        return text
    }

    private fun itemFromFile(file: File, now: Long): LargeTextFileItem? {
        val createdAt = createdAtFromFileName(file.name)
        if (createdAt == null) {
            file.delete()
            return null
        }

        val expiresAt = createdAt + LocalClipboardPolicy.TEXT_RETENTION_MS
        if (!file.isFile || expiresAt <= now || file.length() <= 0L || file.length() > MAX_FILE_BYTES) {
            file.delete()
            return null
        }

        return LargeTextFileItem(
            id = file.name.removeSuffix(".txt"),
            createdAt = createdAt,
            expiresAt = expiresAt,
            byteSize = file.length(),
            preview = readPreview(file),
        )
    }

    private fun readPreview(file: File): String = runCatching {
        file.bufferedReader(Charsets.UTF_8).use { reader ->
            val chars = CharArray(PREVIEW_SCAN_CHARS)
            val count = reader.read(chars)
            if (count <= 0) return@use DEFAULT_PREVIEW
            preview(String(chars, 0, count))
        }
    }.getOrDefault(DEFAULT_PREVIEW)

    private fun preview(text: String): String {
        val firstVisibleLine = text
            .lineSequence()
            .map { line -> line.trim() }
            .firstOrNull { line -> line.isNotEmpty() }
            .orEmpty()
        if (firstVisibleLine.isEmpty()) return DEFAULT_PREVIEW
        return if (firstVisibleLine.length <= PREVIEW_LIMIT) {
            firstVisibleLine
        } else {
            firstVisibleLine.take(PREVIEW_LIMIT - 1) + "…"
        }
    }

    private fun readLimitedBytes(input: InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        var total = 0

        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            require(total <= MAX_FILE_BYTES) {
                "El archivo supera el límite seguro de ${MAX_FILE_BYTES / 1024} KB para esta prueba"
            }
            output.write(buffer, 0, count)
        }

        return output.toByteArray()
    }

    private fun decodeUtf8(bytes: ByteArray): String {
        val decoder = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        return decoder.decode(ByteBuffer.wrap(bytes)).toString()
    }

    private fun createItemId(now: Long): String {
        val bytes = ByteArray(16)
        secureRandom.nextBytes(bytes)
        val suffix = buildString(32) {
            for (byte in bytes) append("%02x".format(byte.toInt() and 0xff))
        }
        return "txt_${now}_$suffix"
    }

    companion object {
        const val DIRECTORY_NAME = "oaclix-large-text"
        const val MAX_FILE_BYTES = 384 * 1024
        private const val PREVIEW_SCAN_CHARS = 4096
        private const val PREVIEW_LIMIT = 72
        private const val DEFAULT_PREVIEW = "Texto largo"
        private val FILE_PATTERN = Regex("^txt_(\\d{1,13})_[a-f0-9]{32}\\.txt$")
        private val FILE_ID_PATTERN = Regex("^txt_\\d{1,13}_[a-f0-9]{32}$")
        private val secureRandom = SecureRandom()

        fun providerAuthority(packageName: String): String = "$packageName.text"

        internal fun createdAtFromFileName(fileName: String): Long? = FILE_PATTERN
            .matchEntire(fileName)
            ?.groupValues
            ?.get(1)
            ?.toLongOrNull()
            ?.takeIf { it >= 0L }

        internal fun isValidFileName(fileName: String): Boolean = createdAtFromFileName(fileName) != null
    }
}
