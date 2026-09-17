package app.oaclix.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast
import app.oaclix.android.connection.NativeBackendConfig
import app.oaclix.android.imageclipboard.ImageClipboardStore
import app.oaclix.android.localclipboard.LargeTextFileStore
import app.oaclix.android.localclipboard.LocalClipboardHistory
import app.oaclix.android.localclipboard.LocalClipboardPolicy
import app.oaclix.android.share.NativeShareDestination
import app.oaclix.android.share.NativeShareDestinationPresentation
import app.oaclix.android.share.NativeShareDestinationSource
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class ShareReceiverActivity : Activity() {
    private lateinit var history: LocalClipboardHistory
    private lateinit var imageStore: ImageClipboardStore
    private lateinit var input: EditText
    private lateinit var ioExecutor: ExecutorService
    private lateinit var destinationGroup: RadioGroup
    private lateinit var destinationStatus: TextView
    private lateinit var shareSubtitle: TextView
    private lateinit var textHeader: View
    private lateinit var characterCount: TextView
    private lateinit var imageSection: View
    private lateinit var imagePreview: ImageView
    private lateinit var imageMeta: TextView
    private lateinit var confirmButton: Button
    private lateinit var configureConnectionButton: Button
    private val destinationByButtonId = mutableMapOf<Int, NativeShareDestination>()
    private var largeSharedText: String? = null
    private var sharedImageUri: Uri? = null
    private var sharedImageMimeType: String? = null
    private var contentMode = SharedContentMode.Text
    private var isBusy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_share_receiver)

        history = LocalClipboardHistory(this)
        imageStore = ImageClipboardStore(this)
        ioExecutor = Executors.newSingleThreadExecutor()
        input = findViewById(R.id.shared_text_input)
        destinationGroup = findViewById(R.id.share_destination_group)
        destinationStatus = findViewById(R.id.share_destination_status)
        shareSubtitle = findViewById(R.id.share_subtitle)
        textHeader = findViewById(R.id.share_text_header)
        characterCount = findViewById(R.id.share_character_count)
        imageSection = findViewById(R.id.share_image_section)
        imagePreview = findViewById(R.id.share_image_preview)
        imageMeta = findViewById(R.id.share_image_meta)
        confirmButton = findViewById(R.id.share_save_button)
        configureConnectionButton = findViewById(R.id.share_configure_backend_button)

        val detectedMode = detectShareMode(intent)
        if (detectedMode == null) {
            toast(getString(R.string.share_invalid))
            finish()
            return
        }
        contentMode = detectedMode

        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(text: Editable?) = updateEditorState()
        })

        configureContentUi()
        renderDestinations(initialDestinations())
        updateConnectionButton()

        findViewById<Button>(R.id.share_cancel_button).setOnClickListener { finish() }
        configureConnectionButton.setOnClickListener { showConnectionDialog() }
        confirmButton.setOnClickListener { confirmSharedContent() }

        when (contentMode) {
            SharedContentMode.Text -> {
                loadSharedText(intent)
                loadLinkedDestinations()
            }
            SharedContentMode.Image -> loadSharedImage(intent)
        }
    }

    override fun onDestroy() {
        if (::ioExecutor.isInitialized) ioExecutor.shutdown()
        super.onDestroy()
    }

    private fun detectShareMode(source: Intent): SharedContentMode? {
        if (source.action != Intent.ACTION_SEND) return null
        val type = source.type?.lowercase().orEmpty()
        return when {
            type == "text/plain" -> SharedContentMode.Text
            type.startsWith("image/") -> SharedContentMode.Image
            else -> null
        }
    }

    private fun configureContentUi() {
        when (contentMode) {
            SharedContentMode.Text -> {
                shareSubtitle.setText(R.string.share_subtitle)
                textHeader.visibility = View.VISIBLE
                input.visibility = View.VISIBLE
                imageSection.visibility = View.GONE
            }
            SharedContentMode.Image -> {
                shareSubtitle.setText(R.string.share_image_subtitle)
                textHeader.visibility = View.GONE
                input.visibility = View.GONE
                imageSection.visibility = View.VISIBLE
                imageMeta.setText(R.string.share_image_meta)
                destinationStatus.setText(R.string.share_destination_image_local_only)
            }
        }
    }

    private fun loadSharedText(source: Intent) {
        val streamUri = sharedStreamUri(source)
        if (streamUri != null) {
            showBusyState(R.string.share_loading_file)
            input.isEnabled = false
            characterCount.text = getString(R.string.share_loading_file)

            ioExecutor.execute {
                val result = runCatching { history.readSharedText(streamUri) }
                runOnUiThread {
                    if (isDestroyed) return@runOnUiThread
                    result.onSuccess(::applySharedText).onFailure { error ->
                        toast(error.message ?: getString(R.string.share_invalid))
                        finish()
                    }
                }
            }
            return
        }

        val inlineText = source
            .getCharSequenceExtra(Intent.EXTRA_TEXT)
            ?.toString()
            ?.takeIf { it.isNotBlank() }

        if (inlineText == null) {
            toast(getString(R.string.share_invalid))
            finish()
            return
        }

        applySharedText(inlineText)
    }

    private fun loadSharedImage(source: Intent) {
        val uri = sharedStreamUri(source)
        if (uri == null) {
            toast(getString(R.string.share_invalid))
            finish()
            return
        }

        sharedImageUri = uri
        sharedImageMimeType = source.type
        updateConfirmEnabled()
        bindSharedImagePreview(uri)
    }

    private fun applySharedText(text: String) {
        largeSharedText = text.takeIf { it.length > LocalClipboardPolicy.MAX_TEXT_LENGTH }
        if (largeSharedText != null) {
            input.isEnabled = true
            input.isFocusable = false
            input.isFocusableInTouchMode = false
            input.isCursorVisible = false
            input.isLongClickable = false
            input.setText(largePreview(text))
        } else {
            input.isEnabled = true
            input.isFocusable = true
            input.isFocusableInTouchMode = true
            input.isCursorVisible = true
            input.isLongClickable = true
            input.setText(text)
            input.setSelection(input.text.length)
        }

        isBusy = false
        updateEditorState()
        updateConfirmLabel(destinationByButtonId[destinationGroup.checkedRadioButtonId])
    }

    private fun currentText(): String = largeSharedText ?: input.text?.toString().orEmpty()

    private fun largePreview(text: String): String {
        if (text.length <= LARGE_PREVIEW_HEAD + LARGE_PREVIEW_TAIL) return text
        return buildString {
            append(text.take(LARGE_PREVIEW_HEAD))
            append("\n\n")
            append(getString(R.string.share_large_preview_marker))
            append("\n\n")
            append(text.takeLast(LARGE_PREVIEW_TAIL))
        }
    }

    @Suppress("DEPRECATION")
    private fun sharedStreamUri(source: Intent): Uri? {
        val extraUri = source.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        if (extraUri != null) return extraUri
        val clip = source.clipData ?: return null
        if (clip.itemCount == 0) return null
        return clip.getItemAt(0).uri
    }

    private fun initialDestinations(): List<NativeShareDestination> =
        listOf(NativeShareDestination.LocalClipboard)

    private fun configuredBaseUrl(): String = NativeBackendConfig.resolve(this)

    private fun updateConnectionButton() {
        configureConnectionButton.visibility = if (
            contentMode == SharedContentMode.Text && configuredBaseUrl().isBlank()
        ) View.VISIBLE else View.GONE
    }

    private fun showConnectionDialog() {
        if (contentMode != SharedContentMode.Text) return

        val urlInput = EditText(this).apply {
            hint = getString(R.string.share_connection_hint)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setText(configuredBaseUrl())
            setSelection(text.length)
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.share_connection_title)
            .setMessage(R.string.share_connection_message)
            .setView(urlInput)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.share_connection_save) { _, _ ->
                try {
                    NativeBackendConfig.save(this, urlInput.text.toString())
                    updateConnectionButton()
                    renderDestinations(initialDestinations())
                    loadLinkedDestinations()
                    toast(getString(R.string.share_connection_saved))
                } catch (error: IllegalArgumentException) {
                    toast(error.message ?: getString(R.string.share_error))
                }
            }
            .show()
    }

    private fun loadLinkedDestinations() {
        if (contentMode != SharedContentMode.Text) return
        val baseUrl = configuredBaseUrl()
        if (baseUrl.isBlank()) {
            destinationStatus.setText(R.string.share_destination_local_only)
            return
        }

        destinationStatus.setText(R.string.share_destination_loading)
        ioExecutor.execute {
            try {
                val destinations = NativeShareDestinationSource(baseUrl).load()
                runOnUiThread {
                    if (!isDestroyed) {
                        renderDestinations(destinations)
                        destinationStatus.setText(R.string.share_destination_devices_ready)
                    }
                }
            } catch (_: Exception) {
                runOnUiThread {
                    if (!isDestroyed) {
                        destinationStatus.setText(R.string.share_destination_load_failed)
                    }
                }
            }
        }
    }

    private fun renderDestinations(destinations: List<NativeShareDestination>) {
        destinationGroup.setOnCheckedChangeListener(null)
        destinationGroup.removeAllViews()
        destinationByButtonId.clear()

        val buttonTint = ColorStateList(
            arrayOf(
                intArrayOf(android.R.attr.state_checked),
                intArrayOf(-android.R.attr.state_enabled),
                intArrayOf(),
            ),
            intArrayOf(
                getColor(R.color.oaclix_accent),
                getColor(R.color.oaclix_disabled),
                getColor(R.color.oaclix_muted),
            ),
        )
        val textTint = ColorStateList(
            arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(getColor(R.color.oaclix_disabled), getColor(R.color.oaclix_text)),
        )

        NativeShareDestinationPresentation.options(destinations).forEachIndexed { index, option ->
            val button = RadioButton(this).apply {
                id = View.generateViewId()
                text = option.label
                isEnabled = option.actionable
                isChecked = index == 0 && option.actionable
                gravity = Gravity.CENTER_VERTICAL
                minHeight = dp(58)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15.5f)
                setTextColor(textTint)
                buttonTintList = buttonTint
                background = getDrawable(R.drawable.share_destination_selector)
                setPadding(dp(16), dp(8), dp(14), dp(8))
                layoutParams = RadioGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { bottomMargin = dp(8) }
            }
            destinationByButtonId[button.id] = option.destination
            destinationGroup.addView(button)
        }

        destinationGroup.setOnCheckedChangeListener { _, checkedId ->
            updateConfirmLabel(destinationByButtonId[checkedId])
        }
        updateConfirmLabel(destinationByButtonId[destinationGroup.checkedRadioButtonId])
    }

    private fun updateConfirmLabel(destination: NativeShareDestination?) {
        if (isBusy) return
        confirmButton.text = when (destination) {
            is NativeShareDestination.LinkedDevice -> getString(R.string.share_send_device, destination.label)
            else -> getString(R.string.share_save_local)
        }
        updateConfirmEnabled()
    }

    private fun updateEditorState() {
        if (contentMode == SharedContentMode.Image) {
            updateConfirmEnabled()
            return
        }

        val text = currentText()
        characterCount.text = if (text.length <= LocalClipboardPolicy.MAX_TEXT_LENGTH) {
            getString(R.string.share_character_count, text.length, LocalClipboardPolicy.MAX_TEXT_LENGTH)
        } else {
            getString(R.string.share_character_count_file, text.length, LargeTextFileStore.MAX_FILE_BYTES / 1024)
        }
        characterCount.setTextColor(
            getColor(if (history.canSave(text)) R.color.oaclix_muted else R.color.oaclix_danger),
        )
        updateConfirmEnabled()
    }

    private fun updateConfirmEnabled() {
        if (!::confirmButton.isInitialized || !::destinationGroup.isInitialized) return
        val destination = destinationByButtonId[destinationGroup.checkedRadioButtonId]
        val canUseDestination = when (contentMode) {
            SharedContentMode.Image -> sharedImageUri != null && destination == NativeShareDestination.LocalClipboard
            SharedContentMode.Text -> {
                if (!::input.isInitialized) return
                val text = currentText()
                when (destination) {
                    NativeShareDestination.LocalClipboard -> history.canSave(text)
                    is NativeShareDestination.LinkedDevice ->
                        text.isNotBlank() && text.length <= LocalClipboardPolicy.MAX_TEXT_LENGTH
                    null -> false
                }
            }
        }
        val enabled = !isBusy && canUseDestination
        confirmButton.isEnabled = enabled
        confirmButton.alpha = if (enabled) 1f else 0.48f
    }

    private fun confirmSharedContent() {
        when (contentMode) {
            SharedContentMode.Text -> confirmSharedText()
            SharedContentMode.Image -> confirmSharedImage()
        }
    }

    private fun confirmSharedText() {
        val destination = destinationByButtonId[destinationGroup.checkedRadioButtonId]
        val text = currentText()
        if (text.isBlank()) {
            toast(getString(R.string.share_text_required))
            return
        }

        if (destination == NativeShareDestination.LocalClipboard) {
            if (!history.canSave(text)) {
                toast(getString(R.string.share_text_file_too_long, LargeTextFileStore.MAX_FILE_BYTES / 1024))
                return
            }
            saveLocal(text)
            return
        }

        if (text.length > LocalClipboardPolicy.MAX_TEXT_LENGTH) {
            toast(getString(R.string.share_text_too_long))
            return
        }

        when (destination) {
            is NativeShareDestination.LinkedDevice -> sendDevice(destination, text)
            NativeShareDestination.LocalClipboard -> Unit
            null -> toast(getString(R.string.share_destination_select))
        }
    }

    private fun confirmSharedImage() {
        val destination = destinationByButtonId[destinationGroup.checkedRadioButtonId]
        val uri = sharedImageUri
        if (uri == null) {
            toast(getString(R.string.share_invalid))
            return
        }
        if (destination == NativeShareDestination.LocalClipboard) {
            saveLocalImage(uri, sharedImageMimeType)
        } else {
            toast(getString(R.string.share_destination_select))
        }
    }

    private fun saveLocal(text: String) {
        runStorage(
            busyLabel = R.string.share_saving,
            task = { history.save(text) },
            onSuccess = {
                toast(getString(R.string.share_saved_local))
                finish()
            },
        )
    }

    private fun saveLocalImage(uri: Uri, mimeType: String?) {
        runStorage(
            busyLabel = R.string.share_saving,
            task = { imageStore.createFromUri(uri, mimeTypeHint = mimeType) },
            onSuccess = { item ->
                val copied = runCatching { OaclixClipboardBridge.copy(this, imageStore.contentUri(item)) }.isSuccess
                toast(getString(if (copied) R.string.image_copied else R.string.share_image_saved_local))
                finish()
            },
        )
    }

    private fun sendDevice(destination: NativeShareDestination.LinkedDevice, text: String) {
        runStorage(
            busyLabel = R.string.share_sending,
            task = {
                val app = application as? OaclixApplication
                    ?: throw IllegalStateException("OACLIX no pudo abrir el canal directo")
                app.sendDirectText(destination.deviceId, text)
            },
            onSuccess = {
                toast(getString(R.string.share_sent_device, destination.label))
                finish()
            },
        )
    }

    private fun bindSharedImagePreview(uri: Uri) {
        if (ioExecutor.isShutdown) return
        ioExecutor.execute {
            val bitmap = runCatching { decodeSharedImagePreview(uri) }.getOrNull()
            runOnUiThread {
                if (isDestroyed || isFinishing || bitmap == null) return@runOnUiThread
                imagePreview.setImageBitmap(bitmap)
            }
        }
    }

    private fun decodeSharedImagePreview(uri: Uri): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { inputStream -> BitmapFactory.decodeStream(inputStream, null, bounds) }
            ?: return null
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val targetPixels = dp(IMAGE_PREVIEW_DECODE_DP).coerceAtLeast(1)
        var sampleSize = 1
        while (
            bounds.outWidth / sampleSize > targetPixels * 2 ||
            bounds.outHeight / sampleSize > targetPixels * 2
        ) sampleSize *= 2

        val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        return contentResolver.openInputStream(uri)?.use { inputStream -> BitmapFactory.decodeStream(inputStream, null, options) }
    }

    private fun showBusyState(labelRes: Int) {
        isBusy = true
        confirmButton.text = getString(labelRes)
        updateConfirmEnabled()
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun <T> runStorage(busyLabel: Int, task: () -> T, onSuccess: (T) -> Unit) {
        if (ioExecutor.isShutdown || isBusy) return
        showBusyState(busyLabel)
        ioExecutor.execute {
            try {
                val result = task()
                runOnUiThread { if (!isDestroyed) onSuccess(result) }
            } catch (error: Exception) {
                runOnUiThread {
                    if (!isDestroyed) {
                        isBusy = false
                        updateConfirmLabel(destinationByButtonId[destinationGroup.checkedRadioButtonId])
                        toast(error.message ?: getString(R.string.share_error))
                    }
                }
            }
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private enum class SharedContentMode { Text, Image }

    companion object {
        private const val LARGE_PREVIEW_HEAD = 1_800
        private const val LARGE_PREVIEW_TAIL = 600
        private const val IMAGE_PREVIEW_DECODE_DP = 320
    }
}
