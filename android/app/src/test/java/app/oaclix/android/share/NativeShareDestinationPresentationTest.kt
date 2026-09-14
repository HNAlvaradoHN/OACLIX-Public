package app.oaclix.android.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeShareDestinationPresentationTest {
    @Test
    fun `local General and linked devices are actionable once transport exists`() {
        val options = NativeShareDestinationPresentation.options(
            listOf(
                NativeShareDestination.LocalClipboard,
                NativeShareDestination.GeneralRoom,
                NativeShareDestination.LinkedDevice(
                    deviceId = "dev_1234567890abcdef",
                    label = "Tablet",
                ),
            ),
        )

        assertTrue(options[0].actionable)
        assertTrue(options[1].actionable)
        assertTrue(options[2].actionable)
        assertEquals("Tablet", options[2].label)
    }

    @Test
    fun `repeated linked labels include a stable short device tag`() {
        val options = NativeShareDestinationPresentation.options(
            listOf(
                NativeShareDestination.LocalClipboard,
                NativeShareDestination.LinkedDevice(
                    deviceId = "dev_1234567890abcdef",
                    label = "Este dispositivo",
                ),
                NativeShareDestination.LinkedDevice(
                    deviceId = "dev_fedcba0987654321",
                    label = "Este dispositivo",
                ),
            ),
        )

        assertEquals("Este dispositivo · cdef", options[1].label)
        assertEquals("Este dispositivo · 4321", options[2].label)
    }
}
