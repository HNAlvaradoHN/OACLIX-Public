package app.oaclix.android.imageclipboard

/**
 * Route-specific image policy.
 *
 * Local/direct routes keep the original bytes and intentionally have no
 * cloud-plan size cap. When OACLIX cloud storage is required, an image above
 * the cloud limit must be optimized as a separate cloud copy before upload;
 * the local original is never replaced by that optimization.
 */
object ImageTransferPolicy {
    const val CLOUD_MAX_IMAGE_BYTES = 10L * 1024L * 1024L

    private const val CLOUD_DECODE_MAX_DIMENSION = 4096
    private const val CLOUD_DECODE_MAX_PIXELS = 6L * 1024L * 1024L
    private const val CLOUD_DECODE_ATTEMPTS = 5

    fun requiresCloudOptimization(byteSize: Long): Boolean {
        require(byteSize >= 0L) { "Tamaño de imagen inválido" }
        return byteSize > CLOUD_MAX_IMAGE_BYTES
    }

    internal fun cloudDecodeSampleSize(width: Int, height: Int): Int {
        require(width > 0 && height > 0) { "Dimensiones de imagen inválidas" }

        var sampleSize = 1
        while (true) {
            val sampledWidth = maxOf(1, width / sampleSize)
            val sampledHeight = maxOf(1, height / sampleSize)
            val sampledPixels = sampledWidth.toLong() * sampledHeight.toLong()
            val withinWorkingSet =
                sampledWidth <= CLOUD_DECODE_MAX_DIMENSION &&
                    sampledHeight <= CLOUD_DECODE_MAX_DIMENSION &&
                    sampledPixels <= CLOUD_DECODE_MAX_PIXELS
            if (withinWorkingSet) return sampleSize
            sampleSize *= 2
        }
    }

    internal fun cloudDecodeSampleSizes(width: Int, height: Int): List<Int> {
        val sizes = ArrayList<Int>(CLOUD_DECODE_ATTEMPTS)
        var sampleSize = cloudDecodeSampleSize(width, height)
        repeat(CLOUD_DECODE_ATTEMPTS) {
            sizes += sampleSize
            if (sampleSize > Int.MAX_VALUE / 2) return sizes
            sampleSize *= 2
        }
        return sizes
    }
}
