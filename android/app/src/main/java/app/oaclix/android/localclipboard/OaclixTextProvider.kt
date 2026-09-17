package app.oaclix.android.localclipboard

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * Read-only provider for short-lived OACLIX large-text clipboard entries.
 *
 * The provider exposes only validated, expiring .txt files from
 * filesDir/oaclix-large-text and never accepts writes from other apps.
 */
class OaclixTextProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun getType(uri: Uri): String? = resolveFile(uri)?.let { "text/plain" }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("Solo lectura")
        val file = resolveFile(uri) ?: throw FileNotFoundException("Texto no disponible")
        if (!isUsable(file)) {
            if (isExpired(file)) file.delete()
            throw FileNotFoundException("El texto ya no está disponible")
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? {
        val file = resolveFile(uri) ?: return null
        if (!isUsable(file)) return null
        val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val cursor = MatrixCursor(columns, 1)
        val row = cursor.newRow()
        columns.forEach { column ->
            when (column) {
                OpenableColumns.DISPLAY_NAME -> row.add("OACLIX-${file.name}")
                OpenableColumns.SIZE -> row.add(file.length())
                else -> row.add(null)
            }
        }
        return cursor
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    private fun resolveFile(uri: Uri): File? {
        val appContext = context ?: return null
        if (uri.authority != LargeTextFileStore.providerAuthority(appContext.packageName)) return null
        if (uri.pathSegments.size != 1) return null
        val fileName = uri.pathSegments.single()
        if (!LargeTextFileStore.isValidFileName(fileName)) return null

        val directory = File(appContext.filesDir, LargeTextFileStore.DIRECTORY_NAME)
        val file = File(directory, fileName)
        val canonicalDirectory = runCatching { directory.canonicalFile }.getOrNull() ?: return null
        val canonicalFile = runCatching { file.canonicalFile }.getOrNull() ?: return null
        if (canonicalFile.parentFile != canonicalDirectory) return null
        return canonicalFile
    }

    private fun isUsable(file: File): Boolean =
        file.isFile &&
            file.length() in 1..LargeTextFileStore.MAX_FILE_BYTES.toLong() &&
            !isExpired(file)

    private fun isExpired(file: File): Boolean {
        val createdAt = LargeTextFileStore.createdAtFromFileName(file.name) ?: return true
        return createdAt + LocalClipboardPolicy.TEXT_RETENTION_MS <= System.currentTimeMillis()
    }
}
