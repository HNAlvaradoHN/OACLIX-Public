package app.oaclix.android.share

import app.oaclix.android.identity.NativeIdentityRemoteSnapshot
import org.junit.Assert.assertEquals
import org.junit.Test

class NativeGeneralShareTransportTest {
    @Test
    fun `send bootstraps General room and writes text through native clipboard api`() {
        var bootstrapCalls = 0
        var capturedRoom = ""
        var capturedText = ""
        val transport = NativeGeneralShareTransport(
            bootstrapIdentity = {
                bootstrapCalls += 1
                persistedIdentity("room_general_1234")
            },
            createRemoteText = { roomId, text ->
                capturedRoom = roomId
                capturedText = text
                NativeClipboardCreateSnapshot(
                    created = true,
                    itemId = "itm_1234567890abcdef",
                    roomId = roomId,
                    text = text,
                    changeSequence = 8,
                )
            },
        )

        val result = transport.send("Hola General")

        assertEquals(1, bootstrapCalls)
        assertEquals("room_general_1234", capturedRoom)
        assertEquals("Hola General", capturedText)
        assertEquals("room_general_1234", result.roomId)
        assertEquals("itm_1234567890abcdef", result.itemId)
        assertEquals(8L, result.changeSequence)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `send refuses identity without persisted General room`() {
        NativeGeneralShareTransport(
            bootstrapIdentity = {
                NativeIdentityRemoteSnapshot(
                    personId = "per_1234567890abcdef",
                    deviceId = "dev_1234567890abcdef",
                    deviceLabel = "Móvil",
                    authenticated = true,
                    persisted = false,
                    generalRoomId = null,
                )
            },
            createRemoteText = { _, _ -> error("network must not run") },
        ).send("Hola")
    }

    @Test(expected = IllegalArgumentException::class)
    fun `send rejects blank text before bootstrap`() {
        NativeGeneralShareTransport(
            bootstrapIdentity = { error("bootstrap must not run") },
            createRemoteText = { _, _ -> error("network must not run") },
        ).send("   ")
    }

    private fun persistedIdentity(roomId: String) = NativeIdentityRemoteSnapshot(
        personId = "per_1234567890abcdef",
        deviceId = "dev_1234567890abcdef",
        deviceLabel = "Móvil",
        authenticated = true,
        persisted = true,
        generalRoomId = roomId,
    )
}
