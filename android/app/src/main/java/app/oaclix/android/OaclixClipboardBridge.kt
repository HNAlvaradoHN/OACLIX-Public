package app.oaclix.android

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.PersistableBundle
import app.oaclix.android.imageclipboard.ImageClipboardPublisher

object OaclixClipboardBridge {
    fun copy(context: Context, text: String) {
        require(text.isNotEmpty()) { "No hay texto seleccionado" }

        val clip = ClipData.newPlainText(context.getString(R.string.clip_label), text)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            clip.description.extras = PersistableBundle().apply {
                putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            }
        }

        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(clip)
    }

    fun copy(context: Context, uri: Uri) {
        ImageClipboardPublisher.publish(context, uri)
    }
}
