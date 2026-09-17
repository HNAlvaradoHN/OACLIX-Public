package app.oaclix.android.fileclipboard

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/** Read-only provider for short-lived generic files stored privately by OACLIX. */
class OaclixFileProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun getType(uri: Uri): String? = resolve(uri)?.stored?.mimeType

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("Solo lectura")
        val resolved = resolve(uri) ?: throw FileNotFoundException("Archivo no disponible")
        if (!isUsable(resolved)) {
            if (isExpired(resolved.stored)) resolved.file.delete()
            throw FileNotFoundException("El archivo ya no está disponible")
        }
        return ParcelFileDescriptor.open(resolved.file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? {
        val resolved = resolve(uri) ?: return null
        if (!isUsable(resolved)) return null
        val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val cursor = MatrixCursor(columns, 1)
        val row = cursor.newRow()
        columns.forEach { column ->
            when (column) {
                OpenableColumns.DISPLAY_NAME -> row.add(resolved.stored.displayName)
                OpenableColumns.SIZE -> row.add(resolved.file.length())
                else -> row.add(null)
            }
        }
        return cursor
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    private fun resolve(uri: Uri): ResolvedFile? {
        val appContext = context ?: return null
        if (uri.authority != FileClipboardStore.providerAuthority(appContext.packageName)) return null
        if (uri.pathSegments.size != 1) return null
        val fileName = uri.pathSegments.single()
        val stored = FileClipboardStore.parseStoredFileName(fileName) ?: return null
        val directory = File(appContext.filesDir, FileClipboardStore.DIRECTORY_NAME)
        val file = File(directory, fileName)
        val canonicalDirectory = runCatching { directory.canonicalFile }.getOrNull() ?: return null
        val canonicalFile = runCatching { file.canonicalFile }.getOrNull() ?: return null
        if (canonicalFile.parentFile != canonicalDirectory) return null
        return ResolvedFile(canonicalFile, stored)
    }

    private fun isUsable(resolved: ResolvedFile): Boolean =
        resolved.file.isFile && resolved.file.length() > 0L && !isExpired(resolved.stored)

    private fun isExpired(stored: StoredFileName): Boolean =
        stored.createdAt + FileClipboardStore.RETENTION_MS <= System.currentTimeMillis()

    private data class ResolvedFile(
        val file: File,
        val stored: StoredFileName,
    )
}
