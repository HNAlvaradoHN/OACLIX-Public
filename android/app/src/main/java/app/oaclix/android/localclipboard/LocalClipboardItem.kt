package app.oaclix.android.localclipboard

data class LocalClipboardItem(
    val id: String,
    val text: String,
    val createdAt: Long,
    val expiresAt: Long,
    val receivedFromDeviceId: String? = null,
)
