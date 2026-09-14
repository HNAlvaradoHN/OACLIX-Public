package app.oaclix.android.imageclipboard

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import app.oaclix.android.R

object ImageClipboardPublisher {
    fun publish(context: Context, uri: Uri) {
        val clip = ClipData.newUri(
            context.contentResolver,
            context.getString(R.string.image_clip_label),
            uri,
        )
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(clip)
    }
}
