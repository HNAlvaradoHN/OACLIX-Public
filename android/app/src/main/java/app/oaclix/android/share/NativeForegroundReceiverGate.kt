package app.oaclix.android.share

internal class NativeForegroundReceiverGate(
    private val onFirstSurfaceStarted: () -> Unit,
    private val onLastSurfaceStopped: () -> Unit,
) {
    private var startedSurfaces = 0
    private var active = false

    fun surfaceStarted() {
        startedSurfaces += 1
        if (active) return
        active = true
        onFirstSurfaceStarted()
    }

    fun surfaceStopped() {
        if (startedSurfaces > 0) startedSurfaces -= 1
        if (startedSurfaces != 0 || !active) return
        active = false
        onLastSurfaceStopped()
    }

    fun close() {
        startedSurfaces = 0
        if (!active) return
        active = false
        onLastSurfaceStopped()
    }

    fun isActive(): Boolean = active

    fun startedSurfaceCount(): Int = startedSurfaces
}
