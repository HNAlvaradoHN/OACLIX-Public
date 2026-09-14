package app.oaclix.android.localclipboard

import android.content.Context
import android.net.Uri

sealed class LocalClipboardEntry {
    abstract val id: String
    abstract val createdAt: Long
    abstract val expiresAt: Long

    data class Inline(val item: LocalClipboardItem) : LocalClipboardEntry() {
        override val id: String get() = item.id
        override val createdAt: Long get() = item.createdAt
        override val expiresAt: Long get() = item.expiresAt
    }

    data class TextFile(val item: LargeTextFileItem) : LocalClipboardEntry() {
        override val id: String get() = item.id
        override val createdAt: Long get() = item.createdAt
        override val expiresAt: Long get() = item.expiresAt
    }
}

class LocalClipboardHistory(context: Context) {
    private val repository = LocalClipboardRepositoryProvider.get(context)
    private val fileStore = LargeTextFileStore(context)

    fun list(now: Long = System.currentTimeMillis()): List<LocalClipboardEntry> {
        val inlineItems = repository.list(now).map { item -> LocalClipboardEntry.Inline(item) }
        val fileItems = fileStore.list(now).map { item -> LocalClipboardEntry.TextFile(item) }
        return (inlineItems + fileItems)
            .sortedWith(compareByDescending<LocalClipboardEntry> { it.createdAt }.thenByDescending { it.id })
    }

    fun save(text: String, now: Long = System.currentTimeMillis()): LocalClipboardEntry {
        require(text.isNotBlank()) { "Escribe o pega un texto primero" }
        return if (text.length <= LocalClipboardPolicy.MAX_TEXT_LENGTH) {
            LocalClipboardEntry.Inline(repository.create(text, now))
        } else {
            LocalClipboardEntry.TextFile(fileStore.create(text, now))
        }
    }

    fun read(entry: LocalClipboardEntry, now: Long = System.currentTimeMillis()): String = when (entry) {
        is LocalClipboardEntry.Inline -> entry.item.text
        is LocalClipboardEntry.TextFile -> fileStore.read(entry.item, now)
    }

    fun delete(entry: LocalClipboardEntry) {
        when (entry) {
            is LocalClipboardEntry.Inline -> repository.delete(entry.item.id)
            is LocalClipboardEntry.TextFile -> fileStore.delete(entry.item)
        }
    }

    fun readSharedText(uri: Uri): String = fileStore.readSharedText(uri)

    fun canSave(text: String): Boolean {
        if (text.isBlank()) return false
        if (text.length <= LocalClipboardPolicy.MAX_TEXT_LENGTH) return true
        return text.toByteArray(Charsets.UTF_8).size <= LargeTextFileStore.MAX_FILE_BYTES
    }
}
