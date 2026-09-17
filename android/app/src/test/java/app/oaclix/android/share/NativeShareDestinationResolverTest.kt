package app.oaclix.android.share

import app.oaclix.android.identity.NativeLinkedDeviceSnapshot
import app.oaclix.android.identity.NativeLinkedDevicesSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeShareDestinationResolverTest {
    @Test
    fun `local stays first while current device is excluded`() {
        val result = NativeShareDestinationResolver.resolve(
            currentDeviceId = "dev_current123456789",
            linked = NativeLinkedDevicesSnapshot(
                personId = "per_person123456789",
                devices = listOf(
                    device("dev_current123456789", "Este dispositivo"),
                    device("dev_tablet1234567890", "Tablet"),
                    device("dev_pc123456789012345", "PC"),
                ),
            ),
        )

        assertEquals(NativeShareDestination.LocalClipboard, result[0])
        assertEquals(listOf("PC", "Tablet"), result.drop(1).map { it.label })
        assertFalse(result.any { it.stableId == "device:dev_current123456789" })
    }

    @Test
    fun `duplicate devices are removed by stable id`() {
        val result = NativeShareDestinationResolver.resolve(
            currentDeviceId = "dev_current123456789",
            linked = NativeLinkedDevicesSnapshot(
                personId = "per_person123456789",
                devices = listOf(
                    device("dev_phone1234567890", "Teléfono"),
                    device("dev_phone1234567890", "Teléfono duplicado"),
                ),
            ),
        )

        assertEquals(2, result.size)
        assertEquals("device:dev_phone1234567890", result[1].stableId)
        assertEquals("Teléfono", result[1].label)
    }

    @Test
    fun `invalid current device id is rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            NativeShareDestinationResolver.resolve(
                currentDeviceId = "invalid",
                linked = NativeLinkedDevicesSnapshot("per_person123456789", emptyList()),
            )
        }
    }

    private fun device(id: String, label: String) = NativeLinkedDeviceSnapshot(
        id = id,
        label = label,
        createdAt = 1L,
        lastSeenAt = 1L,
    )
}
