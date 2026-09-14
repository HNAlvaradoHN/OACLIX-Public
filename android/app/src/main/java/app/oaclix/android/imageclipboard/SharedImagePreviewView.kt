package app.oaclix.android.imageclipboard

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.AttributeSet
import android.widget.ImageView
import kotlin.math.max
import kotlin.math.roundToInt

class SharedImagePreviewView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : ImageView(context, attrs, defStyleAttr) {
    private var loadGeneration = 0
    private val fallbackPreview = Runnable {
        if (drawable == null) loadIncomingImageFallback()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        // ShareReceiverActivity conserva su decoder muestreado normal. Este fallback
        // solo entra si ese proveedor URI no pudo producir la miniatura.
        postDelayed(fallbackPreview, FALLBACK_DELAY_MS)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(fallbackPreview)
        loadGeneration += 1
        super.onDetachedFromWindow()
    }

    private fun loadIncomingImageFallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
        val activity = context.findActivity() ?: return
        val uri = sharedStreamUri(activity.intent) ?: return
        val generation = ++loadGeneration
        val targetPixels = (96f * resources.displayMetrics.density).roundToInt().coerceAtLeast(1)

        Thread {
            val bitmap = runCatching {
                val source = ImageDecoder.createSource(activity.contentResolver, uri)
                ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                    val sourceWidth = info.size.width.coerceAtLeast(1)
                    val sourceHeight = info.size.height.coerceAtLeast(1)
                    val longest = max(sourceWidth, sourceHeight)
                    if (longest > targetPixels * 2) {
                        val ratio = (targetPixels * 2f) / longest.toFloat()
                        decoder.setTargetSize(
                            (sourceWidth * ratio).roundToInt().coerceAtLeast(1),
                            (sourceHeight * ratio).roundToInt().coerceAtLeast(1),
                        )
                    }
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                }
            }.getOrNull() ?: return@Thread

            post {
                if (!isAttachedToWindow || generation != loadGeneration || drawable != null) return@post
                setImageBitmap(bitmap)
            }
        }.start()
    }

    @Suppress("DEPRECATION")
    private fun sharedStreamUri(intent: Intent): Uri? {
        if (intent.action != Intent.ACTION_SEND || !intent.type.orEmpty().startsWith("image/")) return null
        val extra = intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        if (extra != null) return extra
        val clip = intent.clipData ?: return null
        if (clip.itemCount == 0) return null
        return clip.getItemAt(0).uri
    }

    private tailrec fun Context.findActivity(): Activity? = when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }

    companion object {
        private const val FALLBACK_DELAY_MS = 120L
    }
}
