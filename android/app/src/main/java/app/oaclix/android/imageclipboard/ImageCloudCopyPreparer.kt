package app.oaclix.android.imageclipboard

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import java.io.ByteArrayOutputStream
import java.io.File

internal data class PreparedImageCloudCopy(
    val bytes: ByteArray,
    val mimeType: String,
    val optimized: Boolean,
)

internal object ImageCloudCopyPreparer {
    private const val MIN_DIMENSION = 640
    private val QUALITY_STEPS = intArrayOf(92, 84, 76, 68, 60, 52, 44)

    fun prepare(context: Context, uri: Uri, mimeTypeHint: String? = null): PreparedImageCloudCopy {
        val resolver = context.contentResolver
        val mimeType = resolver.getType(uri)?.lowercase()
            ?: mimeTypeHint?.lowercase()
            ?: throw IllegalArgumentException("No se pudo determinar el formato de la imagen")
        require(ImageClipboardStore.extensionForMime(mimeType) != null) { "Formato de imagen no compatible" }

        val tempFile = File.createTempFile("oaclix-cloud-image-", ".bin", context.cacheDir)
        try {
            val input = resolver.openInputStream(uri)
                ?: throw IllegalArgumentException("No se pudo leer la imagen")
            val source = input.use {
                ImageCloudSourceSpooler.snapshot(
                    input = it,
                    maxInMemoryBytes = ImageTransferPolicy.CLOUD_MAX_IMAGE_BYTES,
                    tempFile = tempFile,
                )
            }

            return when (source) {
                is CloudImageSourceSnapshot.InMemory -> PreparedImageCloudCopy(
                    source.bytes,
                    normalizeMime(mimeType),
                    optimized = false,
                )
                is CloudImageSourceSnapshot.OnDisk -> {
                    require(mimeType != "image/gif") {
                        "Los GIF mayores de 10 MB requieren una ruta Directo para conservar la animación"
                    }
                    optimizeOversizedFile(source.file)
                }
            }
        } finally {
            tempFile.delete()
        }
    }

    private fun optimizeOversizedFile(file: File): PreparedImageCloudCopy {
        val decoded = decodeSampledBitmap(file)
            ?: throw IllegalArgumentException("No se pudo optimizar la imagen")
        try {
            var current = decoded
            try {
                while (true) {
                    for (quality in QUALITY_STEPS) {
                        val output = ByteArrayOutputStream()
                        val compressed = current.compress(webpFormat(), quality, output)
                        if (compressed && output.size().toLong() <= ImageTransferPolicy.CLOUD_MAX_IMAGE_BYTES) {
                            return PreparedImageCloudCopy(output.toByteArray(), "image/webp", optimized = true)
                        }
                    }

                    val nextWidth = current.width / 2
                    val nextHeight = current.height / 2
                    if (nextWidth < MIN_DIMENSION || nextHeight < MIN_DIMENSION) break
                    val next = Bitmap.createScaledBitmap(current, nextWidth, nextHeight, true)
                    if (current !== decoded) current.recycle()
                    current = next
                }
            } finally {
                if (current !== decoded) current.recycle()
            }
        } finally {
            decoded.recycle()
        }

        throw IllegalArgumentException("No se pudo reducir la imagen al límite cloud de 10 MB")
    }

    private fun decodeSampledBitmap(file: File): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        for (sampleSize in ImageTransferPolicy.cloudDecodeSampleSizes(bounds.outWidth, bounds.outHeight)) {
            val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
            val decoded = try {
                BitmapFactory.decodeFile(file.absolutePath, options)
            } catch (_: OutOfMemoryError) {
                null
            }
            if (decoded != null) return decoded
        }
        return null
    }

    @Suppress("DEPRECATION")
    private fun webpFormat(): Bitmap.CompressFormat = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Bitmap.CompressFormat.WEBP_LOSSY
    } else {
        Bitmap.CompressFormat.WEBP
    }

    private fun normalizeMime(mimeType: String): String = when (mimeType) {
        "image/jpg" -> "image/jpeg"
        else -> mimeType
    }
}
