package app.oaclix.android

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import app.oaclix.android.imageclipboard.ImageClipboardItem
import app.oaclix.android.imageclipboard.ImageClipboardStore
import app.oaclix.android.imageclipboard.ImageThumbnailDecoder
import app.oaclix.android.localclipboard.LocalClipboardEntry
import app.oaclix.android.localclipboard.LocalClipboardHistory
import app.oaclix.android.localclipboard.LocalClipboardPolicy
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class ProcessTextActivity : Activity() {
    private lateinit var history: LocalClipboardHistory
    private lateinit var imageStore: ImageClipboardStore
    private lateinit var ioExecutor: ExecutorService
    private lateinit var recentList: LinearLayout
    private lateinit var emptyState: TextView
    private lateinit var subtitle: TextView
    private lateinit var copySelectionAction: TextView
    private lateinit var selectedText: String
    private var isReadOnly = false
    private var largeClipboardChecked = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        selectedText = readSelectedText(intent) ?: run {
            finish()
            return
        }

        setContentView(R.layout.activity_process_text)
        history = LocalClipboardHistory(this)
        imageStore = ImageClipboardStore(this)
        ioExecutor = Executors.newSingleThreadExecutor()
        recentList = findViewById(R.id.process_text_recent_list)
        emptyState = findViewById(R.id.process_text_empty)
        subtitle = findViewById(R.id.process_text_subtitle)
        copySelectionAction = findViewById(R.id.process_text_copy_selection)
        isReadOnly = intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false)

        subtitle.setText(
            if (isReadOnly) R.string.process_text_read_only else R.string.process_text_subtitle,
        )
        copySelectionAction.setOnClickListener { copySelectedTextAndClose() }
        renderRecentItems(loadRecentItems())
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || largeClipboardChecked) return
        largeClipboardChecked = true
        captureLargeClipboardOnOpen()
    }

    override fun onDestroy() {
        if (::ioExecutor.isInitialized) ioExecutor.shutdown()
        super.onDestroy()
    }

    private fun readSelectedText(source: Intent): String? {
        if (source.action != Intent.ACTION_PROCESS_TEXT) return null
        if (source.type != "text/plain") return null

        return source
            .getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
            ?.toString()
            ?.takeIf { it.isNotEmpty() }
    }

    private fun captureLargeClipboardOnOpen() {
        val text = runCatching {
            val clipboard = getSystemService(ClipboardManager::class.java)
            val clip = clipboard.primaryClip ?: return@runCatching null
            clip
                .takeIf { it.itemCount > 0 }
                ?.getItemAt(0)
                ?.text
                ?.toString()
                ?.takeIf { it.isNotBlank() }
        }.getOrNull() ?: return

        if (text.length <= LocalClipboardPolicy.MAX_TEXT_LENGTH) return

        if (!history.canSave(text)) {
            subtitle.text = getString(R.string.process_text_clipboard_too_large)
            Toast.makeText(this, R.string.process_text_clipboard_too_large, Toast.LENGTH_SHORT).show()
            return
        }
        if (!::ioExecutor.isInitialized || ioExecutor.isShutdown) return

        val byteSize = text.toByteArray(Charsets.UTF_8).size.toLong()
        ioExecutor.execute {
            val result = runCatching {
                val visibleRecents = history.list().take(MAX_RECENTS)
                val firstMatches = visibleRecents.firstOrNull()?.let { entry ->
                    runCatching { history.read(entry) }.getOrNull() == text
                } == true

                if (!firstMatches) {
                    visibleRecents
                        .filter { entry -> runCatching { history.read(entry) }.getOrNull() == text }
                        .forEach { entry -> history.delete(entry) }
                    history.save(text)
                }
            }

            runOnUiThread {
                if (isDestroyed || isFinishing) return@runOnUiThread

                result.onSuccess {
                    renderRecentItems(loadRecentItems())
                    subtitle.text = getString(
                        R.string.process_text_large_clipboard_ready,
                        formatKilobytes(byteSize),
                    )
                }.onFailure { error ->
                    Toast.makeText(
                        this,
                        error.message ?: getString(R.string.process_text_clipboard_failed),
                        Toast.LENGTH_SHORT,
                    ).show()
                }
            }
        }
    }

    private fun loadRecentItems(): List<RecentDisplayItem> = buildList {
        history.list().forEach { add(RecentDisplayItem.Text(it)) }
        imageStore.list().forEach { add(RecentDisplayItem.Image(it)) }
    }
        .sortedByDescending { it.createdAt }
        .take(MAX_RECENTS)

    private fun renderRecentItems(items: List<RecentDisplayItem>) {
        recentList.removeAllViews()
        emptyState.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE

        items.forEachIndexed { index, item ->
            recentList.addView(createRecentRow(item, index == items.lastIndex))
        }
    }

    private fun createRecentRow(item: RecentDisplayItem, isLast: Boolean): View = when (item) {
        is RecentDisplayItem.Text -> createTextRecentRow(item.item, isLast)
        is RecentDisplayItem.Image -> createImageRecentRow(item.item, isLast)
    }

    private fun createTextRecentRow(item: LocalClipboardEntry, isLast: Boolean): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            minimumHeight = dp(58)
            isClickable = true
            isFocusable = true
            background = getDrawable(R.drawable.process_text_recent_background)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            layoutParams = recentRowLayoutParams(isLast)
            setOnClickListener { chooseTextRecent(item) }

            addView(TextView(this@ProcessTextActivity).apply {
                text = when (item) {
                    is LocalClipboardEntry.Inline -> preview(item.item.text)
                    is LocalClipboardEntry.TextFile -> getString(
                        R.string.process_text_file_preview,
                        item.item.preview,
                    )
                }
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
                setTextColor(getColor(R.color.oaclix_text))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
            })

            addView(TextView(this@ProcessTextActivity).apply {
                text = when (item) {
                    is LocalClipboardEntry.Inline -> relativeAge(item.createdAt)
                    is LocalClipboardEntry.TextFile -> getString(
                        R.string.process_text_file_meta,
                        formatKilobytes(item.item.byteSize),
                        relativeAge(item.createdAt),
                    )
                }
                setTextColor(getColor(R.color.oaclix_muted))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
                setPadding(0, dp(4), 0, 0)
            })
        }
    }

    private fun createImageRecentRow(item: ImageClipboardItem, isLast: Boolean): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(68)
            isClickable = true
            isFocusable = true
            background = getDrawable(R.drawable.process_text_recent_background)
            setPadding(dp(12), dp(9), dp(14), dp(9))
            layoutParams = recentRowLayoutParams(isLast)
            setOnClickListener { chooseImageRecent(item) }

            val thumbnail = ImageView(this@ProcessTextActivity).apply {
                layoutParams = LinearLayout.LayoutParams(dp(50), dp(50))
                scaleType = ImageView.ScaleType.CENTER_CROP
                setImageResource(android.R.drawable.ic_menu_gallery)
                background = getDrawable(R.drawable.process_text_recent_background)
                clipToOutline = true
                contentDescription = getString(R.string.process_text_image_title)
            }
            addView(thumbnail)

            addView(LinearLayout(this@ProcessTextActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL
                layoutParams = LinearLayout.LayoutParams(
                    0,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    1f,
                ).apply {
                    marginStart = dp(12)
                }

                addView(TextView(this@ProcessTextActivity).apply {
                    text = getString(R.string.process_text_image_title)
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                    setTextColor(getColor(R.color.oaclix_text))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
                })

                addView(TextView(this@ProcessTextActivity).apply {
                    text = getString(
                        R.string.process_text_image_meta,
                        formatImageSize(item.byteSize),
                        relativeAge(item.createdAt),
                    )
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                    setTextColor(getColor(R.color.oaclix_muted))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
                    setPadding(0, dp(4), 0, 0)
                })
            })

            bindThumbnail(thumbnail, item)
        }
    }

    private fun recentRowLayoutParams(isLast: Boolean): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply {
            if (!isLast) bottomMargin = dp(8)
        }
    }

    private fun bindThumbnail(imageView: ImageView, item: ImageClipboardItem) {
        if (!::ioExecutor.isInitialized || ioExecutor.isShutdown) return
        ioExecutor.execute {
            val bitmap = runCatching {
                ImageThumbnailDecoder.decode(
                    store = imageStore,
                    item = item,
                    targetPixels = dp(THUMBNAIL_DECODE_DP),
                )
            }.getOrNull()
            runOnUiThread {
                if (isDestroyed || isFinishing || bitmap == null) return@runOnUiThread
                imageView.setImageBitmap(bitmap)
            }
        }
    }

    private fun chooseTextRecent(item: LocalClipboardEntry) {
        val text = try {
            history.read(item)
        } catch (error: Exception) {
            Toast.makeText(
                this,
                error.message ?: getString(R.string.process_text_recent_failed),
                Toast.LENGTH_SHORT,
            ).show()
            return
        }

        try {
            OaclixClipboardBridge.copy(this, text)
        } catch (error: Exception) {
            Toast.makeText(
                this,
                error.message ?: getString(R.string.process_text_recent_failed),
                Toast.LENGTH_SHORT,
            ).show()
            return
        }

        val result = Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, text)
        setResult(RESULT_OK, result)
        finish()
    }

    private fun chooseImageRecent(item: ImageClipboardItem) {
        try {
            val clipboard = getSystemService(ClipboardManager::class.java)
            val uri = imageStore.contentUri(item)
            val clip = ClipData.newUri(contentResolver, getString(R.string.image_clip_label), uri)
            clipboard.setPrimaryClip(clip)
            Toast.makeText(this, R.string.process_text_image_copied, Toast.LENGTH_SHORT).show()
        } catch (error: Exception) {
            Toast.makeText(
                this,
                error.message ?: getString(R.string.process_text_recent_failed),
                Toast.LENGTH_SHORT,
            ).show()
            return
        }

        setResult(RESULT_CANCELED)
        finish()
    }

    private fun copySelectedTextAndClose() {
        try {
            OaclixClipboardBridge.copy(this, selectedText)
            if (selectedText.isNotBlank()) {
                runCatching { history.save(selectedText) }
            }
            Toast.makeText(this, R.string.process_text_copied, Toast.LENGTH_SHORT).show()
        } catch (error: Exception) {
            Toast.makeText(
                this,
                error.message ?: getString(R.string.process_text_copy_failed),
                Toast.LENGTH_SHORT,
            ).show()
        }

        setResult(RESULT_CANCELED)
        finish()
    }

    private fun preview(text: String): String {
        val firstVisibleLine = text
            .lineSequence()
            .map { line -> line.trim() }
            .firstOrNull { line -> line.isNotEmpty() }
            .orEmpty()
        if (firstVisibleLine.isEmpty()) return getString(R.string.process_text_unnamed_text)
        return if (firstVisibleLine.length <= PREVIEW_LIMIT) {
            firstVisibleLine
        } else {
            firstVisibleLine.take(PREVIEW_LIMIT - 1) + "…"
        }
    }

    private fun relativeAge(createdAt: Long): String {
        val elapsedMinutes = ((System.currentTimeMillis() - createdAt).coerceAtLeast(0L) / 60_000L)
        return when {
            elapsedMinutes < 1L -> getString(R.string.process_text_now)
            elapsedMinutes < 60L -> getString(R.string.process_text_minutes_ago, elapsedMinutes)
            else -> getString(R.string.process_text_hours_ago, elapsedMinutes / 60L)
        }
    }

    private fun formatKilobytes(bytes: Long): String = "${(bytes + 1023L) / 1024L} KB"

    private fun formatImageSize(bytes: Long): String = if (bytes >= 1024L * 1024L) {
        String.format(java.util.Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0))
    } else {
        formatKilobytes(bytes)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private sealed class RecentDisplayItem {
        abstract val createdAt: Long

        data class Text(val item: LocalClipboardEntry) : RecentDisplayItem() {
            override val createdAt: Long get() = item.createdAt
        }

        data class Image(val item: ImageClipboardItem) : RecentDisplayItem() {
            override val createdAt: Long get() = item.createdAt
        }
    }

    companion object {
        private const val MAX_RECENTS = 5
        private const val PREVIEW_LIMIT = 72
        private const val THUMBNAIL_DECODE_DP = 96
    }
}
