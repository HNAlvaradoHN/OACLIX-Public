package app.oaclix.android.identity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeLinkingFlowTest {
    @Test
    fun `bootstraps then consumes code then reloads roster`() {
        val calls = mutableListOf<String>()
        val flow = NativeLinkingFlow(
            bootstrapIdentity = { calls += "bootstrap" },
            consumeLink = { code ->
                calls += "consume:$code"
                NativeLinkConsumeSnapshot(
                    linked = true,
                    personId = "per_person123456789",
                    alreadyLinked = false,
                )
            },
            linkedDevices = {
                calls += "roster"
                NativeLinkedDevicesSnapshot(
                    personId = "per_person123456789",
                    devices = emptyList(),
                )
            },
        )

        val roster = flow.consumeAndLoad("ABCDE-FGHIJ")

        assertEquals("per_person123456789", roster.personId)
        assertEquals(listOf("bootstrap", "consume:ABCDE-FGHIJ", "roster"), calls)
    }

    @Test
    fun `rejects roster from a different person`() {
        val flow = NativeLinkingFlow(
            bootstrapIdentity = {},
            consumeLink = {
                NativeLinkConsumeSnapshot(
                    linked = true,
                    personId = "per_person123456789",
                    alreadyLinked = false,
                )
            },
            linkedDevices = {
                NativeLinkedDevicesSnapshot(
                    personId = "per_other1234567890",
                    devices = emptyList(),
                )
            },
        )

        assertThrows(IllegalArgumentException::class.java) {
            flow.consumeAndLoad("ABCDE-FGHIJ")
        }
    }

    @Test
    fun `generates link codes after identity bootstrap`() {
        val calls = mutableListOf<String>()
        val flow = NativeLinkingFlow(
            bootstrapIdentity = { calls += "bootstrap" },
            consumeLink = { error("unused") },
            linkedDevices = { error("unused") },
            createLink = {
                calls += "create"
                NativeLinkCodeSnapshot("ABCDE-FGHIJ", 1234L)
            },
        )

        assertEquals("ABCDE-FGHIJ", flow.createCode().code)
        assertEquals(listOf("bootstrap", "create"), calls)
    }

    @Test
    fun `rename and unlink reload roster after server confirmation`() {
        val calls = mutableListOf<String>()
        val roster = NativeLinkedDevicesSnapshot(
            personId = "per_person123456789",
            devices = emptyList(),
        )
        val flow = NativeLinkingFlow(
            bootstrapIdentity = { calls += "bootstrap" },
            consumeLink = { error("unused") },
            linkedDevices = {
                calls += "roster"
                roster
            },
            renameDeviceAction = { deviceId, label ->
                calls += "rename:$deviceId:$label"
                NativeDeviceRenameSnapshot(true, deviceId, label)
            },
            unlinkDeviceAction = { deviceId ->
                calls += "unlink:$deviceId"
                NativeDeviceUnlinkSnapshot(true, deviceId, true)
            },
        )
        val deviceId = "dev_device123456789"

        flow.renameAndLoad(deviceId, "Tablet")
        flow.unlinkAndLoad(deviceId)

        assertEquals(
            listOf(
                "bootstrap",
                "rename:$deviceId:Tablet",
                "roster",
                "bootstrap",
                "unlink:$deviceId",
                "roster",
            ),
            calls,
        )
    }

    @Test
    fun `bootstrap failure never rotates or replaces the device identity`() {
        val calls = mutableListOf<String>()
        val flow = NativeLinkingFlow(
            bootstrapIdentity = {
                calls += "bootstrap"
                throw NativeIdentityApiException(503, "Persistencia temporalmente no disponible")
            },
            consumeLink = { error("unused") },
            linkedDevices = { error("unused") },
        )

        assertThrows(NativeIdentityApiException::class.java) {
            flow.consumeAndLoad("ABCDE-FGHIJ")
        }
        assertEquals(listOf("bootstrap"), calls)
    }
}
