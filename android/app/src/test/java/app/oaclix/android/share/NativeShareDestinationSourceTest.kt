package app.oaclix.android.share

import app.oaclix.android.identity.NativeLinkedDeviceSnapshot
import app.oaclix.android.identity.NativeLinkedDevicesSnapshot
import org.junit.Assert.assertEquals
import org.junit.Test

class NativeShareDestinationSourceTest {
    @Test
    fun `bootstraps identity before loading roster`() {
        val calls = mutableListOf<String>()
        val source = NativeShareDestinationSource(
            bootstrapIdentity = { calls += "bootstrap" },
            currentDeviceId = {
                calls += "current"
                "dev_current123456789"
            },
            linkedDevices = {
                calls += "linked"
                NativeLinkedDevicesSnapshot(
                    personId = "per_person123456789",
                    devices = emptyList(),
                )
            },
        )

        source.load()

        assertEquals(listOf("bootstrap", "current", "linked"), calls)
    }

    @Test
    fun `loads linked devices into resolver`() {
        var currentCalls = 0
        var linkedCalls = 0
        val source = NativeShareDestinationSource(
            bootstrapIdentity = {},
            currentDeviceId = {
                currentCalls += 1
                "dev_current123456789"
            },
            linkedDevices = {
                linkedCalls += 1
                NativeLinkedDevicesSnapshot(
                    personId = "per_person123456789",
                    devices = listOf(
                        device("dev_current123456789", "Este dispositivo"),
                        device("dev_tablet1234567890", "Tablet"),
                    ),
                )
            },
        )

        val result = source.load()

        assertEquals(1, currentCalls)
        assertEquals(1, linkedCalls)
        assertEquals(
            listOf("local", "device:dev_tablet1234567890"),
            result.map { it.stableId },
        )
    }

    @Test
    fun `empty linked-device list exposes only local clipboard`() {
        val source = NativeShareDestinationSource(
            bootstrapIdentity = {},
            currentDeviceId = { "dev_current123456789" },
            linkedDevices = {
                NativeLinkedDevicesSnapshot(
                    personId = "per_person123456789",
                    devices = emptyList(),
                )
            },
        )

        assertEquals(
            listOf(NativeShareDestination.LocalClipboard),
            source.load(),
        )
    }

    private fun device(id: String, label: String) = NativeLinkedDeviceSnapshot(
        id = id,
        label = label,
        createdAt = 1L,
        lastSeenAt = 1L,
    )
}
