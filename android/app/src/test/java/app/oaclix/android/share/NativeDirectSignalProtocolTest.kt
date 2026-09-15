package app.oaclix.android.share

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeDirectSignalProtocolTest {
    @Test
    fun `presence requires unique valid device sessions`() {
        val valid = JSONObject()
            .put("type", "presence")
            .put("deviceIds", JSONArray().put("dev_aaaaaaaaaaaaaaaa"))
            .put("peers", JSONArray()
                .put(JSONObject()
                    .put("deviceId", "dev_aaaaaaaaaaaaaaaa")
                    .put("sessionId", "12345678-abcd")))
        val parsed = NativeDirectSignalProtocol.parsePresence(valid)
        assertNotNull(parsed)
        assertEquals("dev_aaaaaaaaaaaaaaaa", parsed!!.single().deviceId)

        val duplicate = JSONObject(valid.toString())
        duplicate.getJSONArray("peers").put(JSONObject()
            .put("deviceId", "dev_aaaaaaaaaaaaaaaa")
            .put("sessionId", "87654321-dcba"))
        assertNull(NativeDirectSignalProtocol.parsePresence(duplicate))
    }

    @Test
    fun `description and candidate signaling match the PWA contract`() {
        val description = JSONObject()
            .put("type", "signal")
            .put("fromDeviceId", "dev_aaaaaaaaaaaaaaaa")
            .put("fromSessionId", "12345678-abcd")
            .put("signal", JSONObject()
                .put("kind", "description")
                .put("negotiationId", "0123456789abcdef01234567")
                .put("negotiationGeneration", 7)
                .put("description", JSONObject()
                    .put("type", "offer")
                    .put("sdp", "v=0\r\n")))
        val parsedDescription = NativeDirectSignalProtocol.parseSignal(description)
        assertTrue(parsedDescription is NativeDirectSignalProtocol.Signal.Description)

        val candidateFrame = NativeDirectSignalProtocol.candidateFrame(
            targetDeviceId = "dev_bbbbbbbbbbbbbbbb",
            negotiationId = "0123456789abcdef01234567",
            negotiationGeneration = 7,
            sdpMid = "0",
            sdpMLineIndex = 0,
            candidate = "candidate:1 1 UDP 1 192.168.1.2 12345 typ host",
        )
        assertEquals("signal", candidateFrame.getString("type"))
        assertEquals("candidate", candidateFrame.getJSONObject("signal").getString("kind"))
    }

    @Test
    fun `android advertises only image direct and rejects unknown capability sets`() {
        val local = NativeDirectSignalProtocol.imageDirectCapabilitiesJson()
        assertEquals(1, local.length())
        assertEquals("image-direct", local.getString(0))
        assertTrue(NativeDirectSignalProtocol.remoteSupportsImageDirect(JSONArray().put("image-direct")))
        assertTrue(NativeDirectSignalProtocol.remoteSupportsImageDirect(
            JSONArray().put("room-core").put("image-direct"),
        ))
        assertFalse(NativeDirectSignalProtocol.remoteSupportsImageDirect(JSONArray().put("room-core")))
        assertFalse(NativeDirectSignalProtocol.remoteSupportsImageDirect(JSONArray().put("image-direct").put("unknown")))
    }

    @Test
    fun `malformed signaling is rejected before WebRTC sees it`() {
        val malformed = JSONObject()
            .put("type", "signal")
            .put("fromDeviceId", "dev_aaaaaaaaaaaaaaaa")
            .put("fromSessionId", "12345678-abcd")
            .put("signal", JSONObject()
                .put("kind", "candidate")
                .put("negotiationId", "not-valid")
                .put("negotiationGeneration", 1)
                .put("candidate", JSONObject()
                    .put("candidate", "candidate:1")
                    .put("sdpMLineIndex", 0)))
        assertNull(NativeDirectSignalProtocol.parseSignal(malformed))
    }
}
