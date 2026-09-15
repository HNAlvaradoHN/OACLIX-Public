package app.oaclix.android

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import app.oaclix.android.imageclipboard.ImageClipboardItem
import app.oaclix.android.imageclipboard.ImageClipboardStore
import app.oaclix.android.imageclipboard.ImageThumbnailDecoder
import app.oaclix.android.localclipboard.LocalClipboardEntry
import app.oaclix.android.localclipboard.LocalClipboardHistory
import app.oaclix.android.share.NativeImageReceiptBus
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.ceil

class MainActivity : Activity() {
    private lateinit var history: LocalClipboardHistory
    private lateinit var imageStore: ImageClipboardStore
    private lateinit var input: EditText
    private lateinit var emptyState: TextView
    private lateinit var itemsContainer: LinearLayout
    private lateinit var ioExecutor: ExecutorService
    private var imageReceiptSubscription: AutoCloseable? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        history = LocalClipboardHistory(this)
        imageStore = ImageClipboardStore(this)
        ioExecutor = Executors.newSingleThreadExecutor()
        input = findViewById(R.id.local_text_input)
        emptyState = findViewById(R.id.empty_state)
        itemsContainer = findViewById(R.id.items_container)

        findViewById<Button>(R.id.link_device_open_button).setOnClickListener {
            startActivity(Intent(this, LinkDeviceActivity::class.java))
        }
        findViewById<Button>(R.id.paste_button).setOnClickListener { pasteFromSystemClipboard() }
        findViewById<Button>(R.id.save_button).setOnClickListener { saveCurrentText() }
    }

    override fun onStart() {
        super.onStart()
        imageReceiptSubscription?.close()
        imageReceiptSubscription = NativeImageReceiptBus.subscribe {
            runOnUiThread {
                if (isDestroyed || isFinishing) return@runOnUiThread
                toast(getString(R.string.image_received_cloud))
                loadItems()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (::history.isInitialized && ::imageStore.isInitialized) loadItems()
    }

    override fun onStop() {
        imageReceiptSubscription?.close()
        imageReceiptSubscription = null
        super.onStop()
    }

    override fun onDestroy() {
        imageReceiptSubscription?.close()
        imageReceiptSubscription = null
        if (::ioExecutor.isInitialized) ioExecutor.shutdown()
        super.onDestroy()
    }

    private fun saveCurrentText() {
        val text = input.text.toString()
        runStorage(
            task = { history.save(text) },
            onSuccess = {
                input.text.clear()
                toast(getString(R.string.saved_local))
                loadItems()
            },
        )
    }

    private fun loadItems() {
        runStorage(
            task = {
                buildList<ClipboardDisplayItem> {
                    history.list().forEach { add(ClipboardDisplayItem.Text(it)) }
                    imageStore.list().forEach { add(ClipboardDisplayItem.Image(it)) }
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
            val preview = row.findViewById<TextView>(R.id.item_preview)
            val expiry = row.findViewById<TextView>(R.id.item_expiry)
            val copy = row.findViewById<Button>(R.id.copy_button)
            val delete = row.findViewById<Button>(R.id.delete_button)

            when (displayItem) {
                is ClipboardDisplayItem.Text -> {
                    imagePreview.visibility = View.GONE
                    preview.text = when (val item = displayItem.item) {
                        is LocalClipboardEntry.Inline -> item.item.text
                        is LocalClipboardEntry.TextFile -> getString(
                            R.string.large_text_item_preview,
                            item.item.preview,
                            formatKilobytes(item.item.byteSize),
                        )
                    }
                    copy.setOnClickListener { copyTextItem(displayItem.item) }
                    delete.setOnClickListener { deleteTextItem(displayItem.item) }
                }

                is ClipboardDisplayItem.Image -> {
                    imagePreview.visibility = View.VISIBLE
                    imagePreview.setImageResource(android.R.drawable.ic_menu_gallery)
                    preview.text = getString(
                        R.string.image_item_preview,
                        imageFormatLabel(displayItem.item.mimeType),
                        formatImageSize(displayItem.item.byteSize),
                    )
                    bindImageThumbnail(imagePreview, displayItem.item)
                    copy.setOnClickListener { copyImageItem(displayItem.item) }
                    delete.setOnClickListener { deleteImageItem(displayItem.item) }
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

    private fun deleteImageItem(item: ImageClipboardItem) {
        runStorage(
            task = { imageStore.delete(item) },
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

    private fun pasteFromSystemClipboard() {
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
            importImage(uri)
            return
        }

        val text = item.coerceToText(this)?.toString().orEmpty()
        if (text.isBlank()) {
            toast(getString(R.string.nothing_to_paste))
            return
        }

        input.setText(text)
        input.setSelection(input.text.length)
    }

    private fun importImage(uri: android.net.Uri) {
        runStorage(
            task = { imageStore.createFromUri(uri) },
            onSuccess = {
                toast(getString(R.string.image_saved_local))
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

    private fun formatKilobytes(bytes: Long): String = "${(bytes + 1023L) / 1024L} KB"

    private fun formatImageSize(bytes: Long): String = if (bytes >= 1024L * 1024L) {
        String.format(java.util.Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0))
    } else {
        formatKilobytes(bytes)
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
    }

    companion object {
        private const val LOCAL_IMAGE_THUMBNAIL_DECODE_DP = 112
    }
}
