package app.oaclix.android

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import app.oaclix.android.connection.NativeBackendConfig
import app.oaclix.android.fileclipboard.FileClipboardItem
import app.oaclix.android.fileclipboard.FileClipboardStore
import app.oaclix.android.identity.AndroidKeystoreDeviceIdentity
import app.oaclix.android.identity.NativeLinkedDeviceSnapshot
import app.oaclix.android.identity.NativeLinkedDevicesSnapshot
import app.oaclix.android.identity.NativeLinkingFlow
import app.oaclix.android.imageclipboard.ImageClipboardItem
import app.oaclix.android.imageclipboard.ImageClipboardStore
import app.oaclix.android.imageclipboard.ImageThumbnailDecoder
import app.oaclix.android.localclipboard.LocalClipboardEntry
import app.oaclix.android.localclipboard.LocalClipboardHistory
import app.oaclix.android.share.NativeTextReceiptBus
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.ceil

class MainActivity : Activity() {
    private lateinit var history: LocalClipboardHistory
    private lateinit var imageStore: ImageClipboardStore
    private lateinit var fileStore: FileClipboardStore
    private lateinit var emptyState: TextView
    private lateinit var itemsContainer: LinearLayout
    private lateinit var devicesContainer: LinearLayout
    private lateinit var devicesStatus: TextView
    private lateinit var ioExecutor: ExecutorService
    private val identity = AndroidKeystoreDeviceIdentity()
    private var currentDeviceId = ""
    private var textReceiptSubscription: AutoCloseable? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        history = LocalClipboardHistory(this)
        imageStore = ImageClipboardStore(this)
        fileStore = FileClipboardStore(this)
        ioExecutor = Executors.newSingleThreadExecutor()
        emptyState = findViewById(R.id.empty_state)
        itemsContainer = findViewById(R.id.items_container)
        devicesContainer = findViewById(R.id.linked_devices_shortcuts)
        devicesStatus = findViewById(R.id.devices_status)
        currentDeviceId = identity.getOrCreateSnapshot().deviceId

        findViewById<Button>(R.id.manage_devices_button).setOnClickListener { openLinkedDevices() }
        findViewById<Button>(R.id.send_something_button).setOnClickListener { showAddContentMenu() }
    }

    override fun onStart() {
        super.onStart()
        textReceiptSubscription?.close()
        textReceiptSubscription = NativeTextReceiptBus.subscribe {
            runOnUiThread {
                if (isDestroyed || isFinishing) return@runOnUiThread
                toast(getString(R.string.text_received))
                loadItems()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (::history.isInitialized && ::imageStore.isInitialized && ::fileStore.isInitialized) loadItems()
        if (::devicesContainer.isInitialized) loadLinkedDevices()
    }

    override fun onStop() {
        textReceiptSubscription?.close()
        textReceiptSubscription = null
        super.onStop()
    }

    override fun onDestroy() {
        textReceiptSubscription?.close()
        textReceiptSubscription = null
        if (::ioExecutor.isInitialized) ioExecutor.shutdown()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Android; retained for the small local pickers until Activity Result is introduced.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        when (requestCode) {
            PICK_IMAGE_REQUEST -> importImage(uri, getString(R.string.home_image_selected))
            PICK_FILE_REQUEST -> importFile(uri)
        }
    }

    private fun openLinkedDevices() {
        startActivity(Intent(this, LinkDeviceActivity::class.java))
    }

    private fun showAddContentMenu() {
        val actions = arrayOf(
            getString(R.string.home_add_write_text),
            getString(R.string.home_add_clipboard),
            getString(R.string.home_add_image),
            getString(R.string.home_add_file),
        )
        AlertDialog.Builder(this)
            .setTitle(R.string.home_add_content)
            .setItems(actions) { _, which ->
                when (which) {
                    0 -> showWriteTextDialog()
                    1 -> saveFromSystemClipboard()
                    2 -> chooseImage()
                    3 -> chooseFile()
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun showWriteTextDialog() {
        val input = EditText(this).apply {
            hint = getString(R.string.home_write_text_hint)
            minLines = 4
            maxLines = 8
            setPadding(dp(18), dp(14), dp(18), dp(14))
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle(R.string.home_write_text_title)
            .setView(input)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.save, null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val text = input.text?.toString().orEmpty()
                if (text.isBlank()) {
                    input.error = getString(R.string.share_text_required)
                    return@setOnClickListener
                }
                runStorage(
                    task = { history.save(text) },
                    onSuccess = {
                        dialog.dismiss()
                        toast(getString(R.string.saved_local))
                        loadItems()
                    },
                )
            }
        }
        dialog.show()
    }

    private fun chooseImage() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Intent(MediaStore.ACTION_PICK_IMAGES).apply {
                type = "image/*"
            }
        } else {
            Intent(Intent.ACTION_PICK).apply {
                setDataAndType(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image/*")
            }
        }
        @Suppress("DEPRECATION")
        startActivityForResult(intent, PICK_IMAGE_REQUEST)
    }

    private fun chooseFile() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        @Suppress("DEPRECATION")
        startActivityForResult(intent, PICK_FILE_REQUEST)
    }

    private fun saveFromSystemClipboard() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = clipboard.primaryClip
        if (clip == null || clip.itemCount == 0) {
            toast(getString(R.string.nothing_to_paste))
            return
        }

        val item = clip.getItemAt(0)
        val uri = item.uri
        val mimeType = uri?.let { runCatching { contentResolver.getType(it) }.getOrNull() }
        if (uri != null && mimeType?.startsWith("image/") == true) {
            importImage(uri, getString(R.string.home_saved_from_clipboard))
            return
        }

        val text = item.coerceToText(this)?.toString().orEmpty()
        if (text.isBlank()) {
            toast(getString(R.string.nothing_to_paste))
            return
        }

        runStorage(
            task = { history.save(text) },
            onSuccess = {
                toast(getString(R.string.home_saved_from_clipboard))
                loadItems()
            },
        )
    }

    private fun loadLinkedDevices() {
        val baseUrl = NativeBackendConfig.resolve(this)
        if (baseUrl.isBlank()) {
            devicesStatus.setText(R.string.home_devices_unavailable)
            renderLinkedDevices(null)
            return
        }

        devicesStatus.setText(R.string.home_devices_loading)
        ioExecutor.execute {
            val result = runCatching { NativeLinkingFlow(baseUrl, identity).load() }
            runOnUiThread {
                if (isDestroyed || isFinishing) return@runOnUiThread
                result.onSuccess { roster ->
                    currentDeviceId = identity.getOrCreateSnapshot().deviceId
                    (application as? OaclixApplication)?.refreshDirectTextSession()
                    renderLinkedDevices(roster)
                    val remoteCount = roster.devices.count { it.id != currentDeviceId }
                    devicesStatus.text = if (remoteCount > 0) {
                        resources.getQuantityString(R.plurals.home_devices_ready, remoteCount, remoteCount)
                    } else {
                        getString(R.string.home_devices_empty)
                    }
                }.onFailure {
                    devicesStatus.setText(R.string.home_devices_failed)
                    renderLinkedDevices(null)
                }
            }
        }
    }

    private fun renderLinkedDevices(roster: NativeLinkedDevicesSnapshot?) {
        devicesContainer.removeAllViews()
        roster?.devices
            ?.filter { it.id != currentDeviceId }
            ?.sortedBy { it.label.lowercase() }
            ?.forEach(::addDeviceShortcut)
        addLinkShortcut()
    }

    private fun addDeviceShortcut(device: NativeLinkedDeviceSnapshot) {
        val tile = layoutInflater.inflate(R.layout.item_linked_device_shortcut, devicesContainer, false)
        val initial = tile.findViewById<TextView>(R.id.device_shortcut_initial)
        val label = tile.findViewById<TextView>(R.id.device_shortcut_label)
        initial.text = device.label.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "•"
        label.text = device.label
        tile.contentDescription = getString(R.string.home_device_open) + ": " + device.label
        tile.setOnClickListener { openLinkedDevices() }
        devicesContainer.addView(tile)
    }

    private fun addLinkShortcut() {
        val tile = layoutInflater.inflate(R.layout.item_linked_device_shortcut, devicesContainer, false)
        tile.findViewById<TextView>(R.id.device_shortcut_initial).text = "+"
        tile.findViewById<TextView>(R.id.device_shortcut_label).setText(R.string.home_add_link_device)
        tile.contentDescription = getString(R.string.home_add_link_device)
        tile.setOnClickListener { openLinkedDevices() }
        devicesContainer.addView(tile)
    }

    private fun loadItems() {
        runStorage(
            task = {
                buildList<ClipboardDisplayItem> {
                    history.list().forEach { add(ClipboardDisplayItem.Text(it)) }
                    imageStore.list().forEach { add(ClipboardDisplayItem.Image(it)) }
                    fileStore.list().forEach { add(ClipboardDisplayItem.FileItem(it)) }
                }.sortedByDescending { it.createdAt }
            },
            onSuccess = ::renderItems,
        )
    }

    private fun renderItems(items: List<ClipboardDisplayItem>) {
        itemsContainer.removeAllViews()
        emptyState.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE

        for (displayItem in items) {
            val row = layoutInflater.inflate(R.layout.item_local_clipboard, itemsContainer, false)
            val imagePreview = row.findViewById<ImageView>(R.id.item_image_preview)
            val typeBadge = row.findViewById<TextView>(R.id.item_type_badge)
            val preview = row.findViewById<TextView>(R.id.item_preview)
            val expiry = row.findViewById<TextView>(R.id.item_expiry)
            val copy = row.findViewById<Button>(R.id.copy_button)
            val share = row.findViewById<Button>(R.id.share_button)
            val delete = row.findViewById<Button>(R.id.delete_button)

            when (displayItem) {
                is ClipboardDisplayItem.Text -> {
                    imagePreview.visibility = View.GONE
                    typeBadge.visibility = View.VISIBLE
                    typeBadge.text = "TXT"
                    preview.text = when (val item = displayItem.item) {
                        is LocalClipboardEntry.Inline -> item.item.text
                        is LocalClipboardEntry.TextFile -> getString(
                            R.string.large_text_item_preview,
                            item.item.preview,
                            formatKilobytes(item.item.byteSize),
                        )
                    }
                    copy.setOnClickListener { copyTextItem(displayItem.item) }
                    share.setOnClickListener { shareTextItem(displayItem.item) }
                    delete.setOnClickListener { deleteTextItem(displayItem.item) }
                }

                is ClipboardDisplayItem.Image -> {
                    typeBadge.visibility = View.GONE
                    imagePreview.visibility = View.VISIBLE
                    imagePreview.setImageResource(android.R.drawable.ic_menu_gallery)
                    preview.text = getString(
                        R.string.image_item_preview,
                        imageFormatLabel(displayItem.item.mimeType),
                        formatFileSize(displayItem.item.byteSize),
                    )
                    bindImageThumbnail(imagePreview, displayItem.item)
                    copy.setOnClickListener { copyImageItem(displayItem.item) }
                    share.setOnClickListener { shareImageItem(displayItem.item) }
                    delete.setOnClickListener { deleteImageItem(displayItem.item) }
                }

                is ClipboardDisplayItem.FileItem -> {
                    imagePreview.visibility = View.GONE
                    typeBadge.visibility = View.VISIBLE
                    typeBadge.text = fileTypeLabel(displayItem.item)
                    preview.text = getString(
                        R.string.file_item_preview,
                        displayItem.item.displayName,
                        formatFileSize(displayItem.item.byteSize),
                    )
                    copy.visibility = View.GONE
                    share.setOnClickListener { shareFileItem(displayItem.item) }
                    delete.setOnClickListener { deleteFileItem(displayItem.item) }
                }
            }

            expiry.text = remainingLabel(displayItem.expiresAt)
            itemsContainer.addView(row)
        }
    }

    private fun bindImageThumbnail(imageView: ImageView, item: ImageClipboardItem) {
        if (!::ioExecutor.isInitialized || ioExecutor.isShutdown) return
        ioExecutor.execute {
            val bitmap = runCatching {
                ImageThumbnailDecoder.decode(
                    store = imageStore,
                    item = item,
                    targetPixels = dp(LOCAL_IMAGE_THUMBNAIL_DECODE_DP),
                )
            }.getOrNull()

            runOnUiThread {
                if (isDestroyed || isFinishing || bitmap == null) return@runOnUiThread
                imageView.setImageBitmap(bitmap)
            }
        }
    }

    private fun copyTextItem(item: LocalClipboardEntry) {
        runStorage(
            task = { history.read(item) },
            onSuccess = ::copyTextToSystemClipboard,
        )
    }

    private fun shareTextItem(item: LocalClipboardEntry) {
        when (item) {
            is LocalClipboardEntry.Inline -> shareText(item.item.text)
            is LocalClipboardEntry.TextFile -> shareTextFile(item)
        }
    }

    private fun shareText(text: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        startActivity(Intent.createChooser(intent, getString(R.string.share_out_title)))
    }

    private fun shareTextFile(item: LocalClipboardEntry.TextFile) {
        val uri = history.contentUri(item)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newUri(contentResolver, getString(R.string.app_name), uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(intent, getString(R.string.share_out_title)))
    }

    private fun deleteTextItem(item: LocalClipboardEntry) {
        runStorage(
            task = { history.delete(item) },
            onSuccess = {
                toast(getString(R.string.deleted_local))
                loadItems()
            },
        )
    }

    private fun copyImageItem(item: ImageClipboardItem) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val uri = imageStore.contentUri(item)
        val clip = ClipData.newUri(contentResolver, getString(R.string.image_clip_label), uri)
        clipboard.setPrimaryClip(clip)
        toast(getString(R.string.image_copied))
    }

    private fun shareImageItem(item: ImageClipboardItem) {
        val uri = imageStore.contentUri(item)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = item.mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newUri(contentResolver, getString(R.string.image_clip_label), uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(intent, getString(R.string.share_out_title)))
    }

    private fun deleteImageItem(item: ImageClipboardItem) {
        runStorage(
            task = { imageStore.delete(item) },
            onSuccess = {
                toast(getString(R.string.deleted_local))
                loadItems()
            },
        )
    }

    private fun shareFileItem(item: FileClipboardItem) {
        val uri = fileStore.contentUri(item)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = item.mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newUri(contentResolver, item.displayName, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(intent, getString(R.string.share_out_title)))
    }

    private fun deleteFileItem(item: FileClipboardItem) {
        runStorage(
            task = { fileStore.delete(item) },
            onSuccess = {
                toast(getString(R.string.deleted_local))
                loadItems()
            },
        )
    }

    private fun copyTextToSystemClipboard(text: String) {
        OaclixClipboardBridge.copy(this, text)
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) toast(getString(R.string.copied))
    }

    private fun importImage(uri: Uri, successMessage: String) {
        runStorage(
            task = { imageStore.createFromUri(uri) },
            onSuccess = {
                toast(successMessage)
                loadItems()
            },
        )
    }

    private fun importFile(uri: Uri) {
        runStorage(
            task = { fileStore.createFromUri(uri) },
            onSuccess = {
                toast(getString(R.string.home_file_selected))
                loadItems()
            },
        )
    }

    private fun remainingLabel(expiresAt: Long): String {
        val remainingMinutes = ceil((expiresAt - System.currentTimeMillis()).coerceAtLeast(0L) / 60_000.0).toLong()
        if (remainingMinutes >= 60L) {
            val hours = remainingMinutes / 60L
            val minutes = remainingMinutes % 60L
            return if (minutes == 0L) {
                resources.getQuantityString(R.plurals.expires_hours, hours.toInt(), hours)
            } else {
                getString(R.string.expires_hours_minutes, hours, minutes)
            }
        }
        return resources.getQuantityString(
            R.plurals.expires_minutes,
            remainingMinutes.toInt(),
            remainingMinutes,
        )
    }

    private fun imageFormatLabel(mimeType: String): String = when (mimeType) {
        "image/png" -> "PNG"
        "image/jpeg" -> "JPG"
        "image/webp" -> "WEBP"
        "image/gif" -> "GIF"
        else -> "IMG"
    }

    private fun fileTypeLabel(item: FileClipboardItem): String {
        val extension = item.displayName.substringAfterLast('.', "").trim().uppercase()
        return extension.takeIf { it.isNotBlank() }?.take(6) ?: "FILE"
    }

    private fun formatKilobytes(bytes: Long): String = "${(bytes + 1023L) / 1024L} KB"

    private fun formatFileSize(bytes: Long): String = when {
        bytes >= 1024L * 1024L * 1024L -> String.format(
            java.util.Locale.US,
            "%.1f GB",
            bytes / (1024.0 * 1024.0 * 1024.0),
        )
        bytes >= 1024L * 1024L -> String.format(
            java.util.Locale.US,
            "%.1f MB",
            bytes / (1024.0 * 1024.0),
        )
        else -> formatKilobytes(bytes)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun <T> runStorage(task: () -> T, onSuccess: (T) -> Unit) {
        if (ioExecutor.isShutdown) return
        ioExecutor.execute {
            try {
                val result = task()
                runOnUiThread {
                    if (!isDestroyed) onSuccess(result)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (!isDestroyed) toast(error.message ?: getString(R.string.local_error))
                }
            }
        }
    }

    private sealed class ClipboardDisplayItem {
        abstract val createdAt: Long
        abstract val expiresAt: Long

        data class Text(val item: LocalClipboardEntry) : ClipboardDisplayItem() {
            override val createdAt: Long get() = item.createdAt
            override val expiresAt: Long get() = item.expiresAt
        }

        data class Image(val item: ImageClipboardItem) : ClipboardDisplayItem() {
            override val createdAt: Long get() = item.createdAt
            override val expiresAt: Long get() = item.expiresAt
        }

        data class FileItem(val item: FileClipboardItem) : ClipboardDisplayItem() {
            override val createdAt: Long get() = item.createdAt
            override val expiresAt: Long get() = item.expiresAt
        }
    }

    companion object {
        private const val LOCAL_IMAGE_THUMBNAIL_DECODE_DP = 112
        private const val PICK_IMAGE_REQUEST = 3101
        private const val PICK_FILE_REQUEST = 3102
    }
}
