package app.oaclix.android.imageclipboard

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
 * Read-only provider for short-lived OACLIX image clipboard entries.
 *
 * The provider exposes only random, expiring files from filesDir/oaclix-images.
 * It never accepts writes, inserts, updates or deletes from other apps.
 */
class OaclixImageProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun getType(uri: Uri): String? = resolveFile(uri)?.let { file ->
        ImageClipboardStore.mimeForExtension(file.extension)
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("Solo lectura")
        val file = resolveFile(uri) ?: throw FileNotFoundException("Imagen no disponible")
        if (!file.exists() || isExpired(file)) {
            file.delete()
            throw FileNotFoundException("La imagen venció")
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
        if (!file.exists() || isExpired(file)) return null
        val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val cursor = MatrixCursor(columns, 1)
        val row = cursor.newRow()
        columns.forEach { column ->
            when (column) {
                OpenableColumns.DISPLAY_NAME -> row.add(file.name)
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
        if (uri.authority != ImageClipboardStore.providerAuthority(appContext.packageName)) return null
        if (uri.pathSegments.size != 1) return null
        val fileName = uri.pathSegments.single()
        val directory = File(appContext.filesDir, ImageClipboardStore.DIRECTORY_NAME)
        val file = File(directory, fileName)
        val canonicalDirectory = runCatching { directory.canonicalFile }.getOrNull() ?: return null
        val canonicalFile = runCatching { file.canonicalFile }.getOrNull() ?: return null
        if (canonicalFile.parentFile != canonicalDirectory) return null
        return canonicalFile
    }

    private fun isExpired(file: File): Boolean {
        val createdAt = file.name.substringBefore('_').toLongOrNull() ?: return true
        return createdAt + ImageClipboardStore.RETENTION_MS <= System.currentTimeMillis()
    }
}
