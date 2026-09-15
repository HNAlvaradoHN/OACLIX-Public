package app.oaclix.android.share

import java.io.OutputStream

class NativeDirectImageAssembler(
    private val byteSize: Long,
    private val chunkSize: Int,
    private val chunkCount: Int,
    private val output: OutputStream,
) {
    private var nextChunkIndex = 0
    private var writtenBytes = 0L
    private var completed = false

    init {
        require(byteSize > 0L) { "Tamaño de imagen inválido" }
        require(chunkSize > 0) { "Tamaño de chunk inválido" }
        require(chunkCount > 0) { "Cantidad de chunks inválida" }
        val expectedChunkCount = ((byteSize + chunkSize - 1L) / chunkSize).toInt()
        require(chunkCount == expectedChunkCount) { "Cantidad de chunks no coincide con el tamaño declarado" }
    }

    fun append(chunkIndex: Int, bytes: ByteArray): Boolean {
        check(!completed) { "La transferencia ya terminó" }
        require(chunkIndex == nextChunkIndex) { "Chunk fuera de orden" }

        val expectedBytes = expectedChunkBytes(chunkIndex)
        require(bytes.size == expectedBytes) { "Tamaño de chunk inesperado" }

        output.write(bytes)
        writtenBytes += bytes.size
        nextChunkIndex += 1

        if (nextChunkIndex == chunkCount) {
            check(writtenBytes == byteSize) { "La transferencia no coincide con el tamaño declarado" }
            output.flush()
            completed = true
        }

        return completed
    }

    fun bytesWritten(): Long = writtenBytes

    fun isComplete(): Boolean = completed

    fun expectedChunkBytes(chunkIndex: Int): Int {
        if (chunkIndex < 0 || chunkIndex >= chunkCount) return 0
        if (chunkIndex < chunkCount - 1) return chunkSize
        return (byteSize - chunkSize.toLong() * (chunkCount - 1)).toInt()
    }
}
