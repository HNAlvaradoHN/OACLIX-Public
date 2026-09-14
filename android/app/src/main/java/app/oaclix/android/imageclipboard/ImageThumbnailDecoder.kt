package app.oaclix.android.imageclipboard

import android.graphics.Bitmap
import android.graphics.BitmapFactory

object ImageThumbnailDecoder {
    fun decode(
        store: ImageClipboardStore,
        item: ImageClipboardItem,
        targetPixels: Int,
    ): Bitmap? {
        require(targetPixels > 0) { "El tamaño de miniatura debe ser positivo" }

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        store.openInputStream(item).use { input ->
            BitmapFactory.decodeStream(input, null, bounds)
        }

        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sampleSize = 1
        while (
            bounds.outWidth / sampleSize > targetPixels * 2 ||
            bounds.outHeight / sampleSize > targetPixels * 2
        ) {
            sampleSize *= 2
        }

        val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        return store.openInputStream(item).use { input ->
            BitmapFactory.decodeStream(input, null, options)
        }
    }
}
