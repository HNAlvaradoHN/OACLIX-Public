package app.oaclix.android.localclipboard

import java.security.SecureRandom

object LocalClipboardPolicy {
    const val TEXT_RETENTION_MS = 21_600_000L
    const val MAX_TEXT_LENGTH = 8_000

    private val itemIdPattern = Regex("^itm_[a-f0-9]{32}$")
    private val deviceIdPattern = Regex("^dev_[A-Za-z0-9_-]{16,64}$")
    private val secureRandom = SecureRandom()

    fun createDraft(
        text: String,
        now: Long = System.currentTimeMillis(),
        itemId: String = createItemId(),
    ): LocalClipboardItem {
        require(text.isNotBlank()) { "Escribe o pega un texto primero" }
        require(text.length <= MAX_TEXT_LENGTH) { "El texto supera el límite de 8.000 caracteres" }
        require(isValidItemId(itemId)) { "Identificador local inválido" }

        return LocalClipboardItem(
            id = itemId,
            text = text,
            createdAt = now,
            expiresAt = now + TEXT_RETENTION_MS,
        )
    }

    fun isValidStoredItem(item: LocalClipboardItem): Boolean {
        if (!isValidItemId(item.id)) return false
        if (item.text.isBlank() || item.text.length > MAX_TEXT_LENGTH) return false
        if (item.createdAt < 0L || item.expiresAt <= item.createdAt) return false
        if (item.expiresAt - item.createdAt > TEXT_RETENTION_MS) return false
        return item.receivedFromDeviceId == null || deviceIdPattern.matches(item.receivedFromDeviceId)
    }

    fun normalize(items: List<LocalClipboardItem>, now: Long = System.currentTimeMillis()): List<LocalClipboardItem> {
        return items
            .asSequence()
            .filter(::isValidStoredItem)
            .filter { it.expiresAt > now }
            .distinctBy { it.id }
            .sortedWith(compareByDescending<LocalClipboardItem> { it.createdAt }.thenByDescending { it.id })
            .toList()
    }

    fun isValidItemId(itemId: String): Boolean = itemIdPattern.matches(itemId)

    private fun createItemId(): String {
        val bytes = ByteArray(16)
        secureRandom.nextBytes(bytes)
        return buildString(36) {
            append("itm_")
            for (byte in bytes) append("%02x".format(byte.toInt() and 0xff))
        }
    }
}
