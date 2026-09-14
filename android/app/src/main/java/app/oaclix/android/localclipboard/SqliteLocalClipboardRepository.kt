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
        val values = ContentValues().apply {
            put("id", item.id)
            put("text_content", item.text)
            put("created_at", item.createdAt)
            put("expires_at", item.expiresAt)
            putNull("received_from_device_id")
        }

        writableDatabase.insertOrThrow(TABLE_NAME, null, values)
        return item
    }

    override fun delete(itemId: String) {
        require(LocalClipboardPolicy.isValidItemId(itemId)) { "Identificador local inválido" }
        writableDatabase.delete(TABLE_NAME, "id = ?", arrayOf(itemId))
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
