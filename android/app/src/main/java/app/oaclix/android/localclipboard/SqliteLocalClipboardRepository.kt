package app.oaclix.android.localclipboard

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class SqliteLocalClipboardRepository(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DATABASE_NAME, null, DATABASE_VERSION),
    LocalClipboardRepository {

    override fun onCreate(database: SQLiteDatabase) {
        database.execSQL(
            """
            CREATE TABLE $TABLE_NAME (
                id TEXT PRIMARY KEY NOT NULL,
                text_content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                received_from_device_id TEXT
            )
            """.trimIndent(),
        )
        database.execSQL("CREATE INDEX idx_${TABLE_NAME}_created_at ON $TABLE_NAME(created_at DESC)")
        database.execSQL("CREATE INDEX idx_${TABLE_NAME}_expires_at ON $TABLE_NAME(expires_at)")
    }

    override fun onUpgrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw IllegalStateException("Migración local no definida: $oldVersion → $newVersion")
    }

    override fun list(now: Long): List<LocalClipboardItem> {
        val database = writableDatabase
        val rawItems = mutableListOf<LocalClipboardItem>()

        database.query(
            TABLE_NAME,
            COLUMNS,
            null,
            null,
            null,
            null,
            "created_at DESC, id DESC",
        ).use { cursor ->
            val idColumn = cursor.getColumnIndexOrThrow("id")
            val textColumn = cursor.getColumnIndexOrThrow("text_content")
            val createdColumn = cursor.getColumnIndexOrThrow("created_at")
            val expiresColumn = cursor.getColumnIndexOrThrow("expires_at")
            val sourceColumn = cursor.getColumnIndexOrThrow("received_from_device_id")

            while (cursor.moveToNext()) {
                rawItems += LocalClipboardItem(
                    id = cursor.getString(idColumn),
                    text = cursor.getString(textColumn),
                    createdAt = cursor.getLong(createdColumn),
                    expiresAt = cursor.getLong(expiresColumn),
                    receivedFromDeviceId = if (cursor.isNull(sourceColumn)) null else cursor.getString(sourceColumn),
                )
            }
        }

        val validItems = LocalClipboardPolicy.normalize(rawItems, now)
        val validIds = validItems.asSequence().map { it.id }.toHashSet()
        rawItems.asSequence()
            .map { it.id }
            .filterNot(validIds::contains)
            .distinct()
            .forEach { staleId ->
                database.delete(TABLE_NAME, "id = ?", arrayOf(staleId))
            }

        return validItems
    }

    override fun create(text: String, now: Long): LocalClipboardItem {
        val item = LocalClipboardPolicy.createDraft(text, now)
        writableDatabase.insertOrThrow(TABLE_NAME, null, valuesFor(item))
        return item
    }

    override fun storeReceived(item: LocalClipboardItem): LocalClipboardItem {
        require(LocalClipboardPolicy.isValidStoredItem(item)) { "Texto recibido inválido" }
        require(item.receivedFromDeviceId != null) { "Falta el dispositivo emisor" }

        val database = writableDatabase
        val rowId = database.insertWithOnConflict(
            TABLE_NAME,
            null,
            valuesFor(item),
            SQLiteDatabase.CONFLICT_IGNORE,
        )
        if (rowId != -1L) return item

        val existing = findById(database, item.id)
            ?: throw IllegalStateException("No se pudo confirmar el texto recibido")
        require(existing == item) { "El identificador recibido ya pertenece a otro contenido" }
        return existing
    }

    override fun delete(itemId: String) {
        require(LocalClipboardPolicy.isValidItemId(itemId)) { "Identificador local inválido" }
        writableDatabase.delete(TABLE_NAME, "id = ?", arrayOf(itemId))
    }

    private fun findById(database: SQLiteDatabase, itemId: String): LocalClipboardItem? {
        database.query(
            TABLE_NAME,
            COLUMNS,
            "id = ?",
            arrayOf(itemId),
            null,
            null,
            null,
            "1",
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            val sourceColumn = cursor.getColumnIndexOrThrow("received_from_device_id")
            return LocalClipboardItem(
                id = cursor.getString(cursor.getColumnIndexOrThrow("id")),
                text = cursor.getString(cursor.getColumnIndexOrThrow("text_content")),
                createdAt = cursor.getLong(cursor.getColumnIndexOrThrow("created_at")),
                expiresAt = cursor.getLong(cursor.getColumnIndexOrThrow("expires_at")),
                receivedFromDeviceId = if (cursor.isNull(sourceColumn)) null else cursor.getString(sourceColumn),
            )
        }
    }

    private fun valuesFor(item: LocalClipboardItem): ContentValues = ContentValues().apply {
        put("id", item.id)
        put("text_content", item.text)
        put("created_at", item.createdAt)
        put("expires_at", item.expiresAt)
        if (item.receivedFromDeviceId == null) putNull("received_from_device_id")
        else put("received_from_device_id", item.receivedFromDeviceId)
    }

    companion object {
        private const val DATABASE_NAME = "oaclix-local-clipboard.db"
        private const val DATABASE_VERSION = 1
        private const val TABLE_NAME = "local_text_items"
        private val COLUMNS = arrayOf(
            "id",
            "text_content",
            "created_at",
            "expires_at",
            "received_from_device_id",
        )
    }
}
