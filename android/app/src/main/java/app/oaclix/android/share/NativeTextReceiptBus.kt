package app.oaclix.android.share

import java.util.concurrent.CopyOnWriteArraySet

internal object NativeTextReceiptBus {
    private val listeners = CopyOnWriteArraySet<() -> Unit>()

    fun subscribe(listener: () -> Unit): AutoCloseable {
        listeners.add(listener)
        return AutoCloseable { listeners.remove(listener) }
    }

    fun publishStored() {
        listeners.forEach { listener -> runCatching { listener() } }
    }
}
