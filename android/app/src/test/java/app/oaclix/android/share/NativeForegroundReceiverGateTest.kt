package app.oaclix.android.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeForegroundReceiverGateTest {
    @Test
    fun `receiver remains active while any OACLIX activity is foreground`() {
        var starts = 0
        var stops = 0
        val gate = NativeForegroundReceiverGate(
            onFirstSurfaceStarted = { starts += 1 },
            onLastSurfaceStopped = { stops += 1 },
        )

        gate.surfaceStarted()
        gate.surfaceStarted()
        assertTrue(gate.isActive())
        assertEquals(2, gate.startedSurfaceCount())
        assertEquals(1, starts)

        gate.surfaceStopped()
        assertTrue(gate.isActive())
        assertEquals(0, stops)

        gate.surfaceStopped()
        assertFalse(gate.isActive())
        assertEquals(1, stops)
    }

    @Test
    fun `screen transitions do not create duplicate receiver sessions`() {
        var starts = 0
        var stops = 0
        val gate = NativeForegroundReceiverGate(
            onFirstSurfaceStarted = { starts += 1 },
            onLastSurfaceStopped = { stops += 1 },
        )

        gate.surfaceStarted()
        gate.surfaceStarted()
        gate.surfaceStopped()
        assertEquals(1, starts)
        assertEquals(0, stops)

        gate.surfaceStopped()
        gate.surfaceStarted()
        assertEquals(2, starts)
        assertEquals(1, stops)
    }

    @Test
    fun `close stops an active receiver once`() {
        var stops = 0
        val gate = NativeForegroundReceiverGate(
            onFirstSurfaceStarted = {},
            onLastSurfaceStopped = { stops += 1 },
        )

        gate.surfaceStarted()
        gate.close()
        gate.close()
        assertFalse(gate.isActive())
        assertEquals(1, stops)
    }
}
