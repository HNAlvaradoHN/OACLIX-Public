package app.oaclix.android.localclipboard

interface LocalClipboardRepository {
    fun list(now: Long = System.currentTimeMillis()): List<LocalClipboardItem>
    fun create(text: String, now: Long = System.currentTimeMillis()): LocalClipboardItem
    fun delete(itemId: String)
}
