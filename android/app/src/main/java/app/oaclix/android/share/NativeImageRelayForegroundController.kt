package app.oaclix.android.share

import android.content.Context
import app.oaclix.android.connection.NativeBackendConfig
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Keeps the cloud-relayed image receiver alive only while an Android OACLIX
 * foreground surface explicitly asks for it. Network/bootstrap work never runs
 * on the UI thread and stop/start operations are serialized.
 */
internal class NativeImageRelayForegroundController(
    context: Context,
    private val onStored: () -> Unit,
) : AutoCloseable {
    private val appContext = context.applicationContext
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    @Volatile private var closed = false
    private var receiver: NativeImageDeviceRelayReceiver? = null

    fun start() {
        if (closed || executor.isShutdown) return
        val baseUrl = NativeBackendConfig.resolve(appContext)
        if (baseUrl.isBlank()) return

        val next = NativeImageDeviceRelayReceiver(
            context = appContext,
            baseUrl = baseUrl,
            onStored = onStored,
        )
        executor.execute {
            if (closed) return@execute
            receiver?.stop()
            receiver = next
            runCatching { next.start() }
                .onFailure {
                    if (receiver === next) receiver = null
                    next.stop()
                }
        }
    }

    fun stop() {
        if (closed || executor.isShutdown) return
        executor.execute {
            receiver?.stop()
            receiver = null
        }
    }

    override fun close() {
        if (closed) return
        closed = true
        if (!executor.isShutdown) {
            executor.execute {
                receiver?.stop()
                receiver = null
            }
            executor.shutdown()
        }
    }
}
