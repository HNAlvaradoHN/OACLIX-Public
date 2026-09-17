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
    fun `description and candidate frames contain only connection metadata`() {
        val description = NativeDirectSignalProtocol.descriptionFrame(
            targetDeviceId = "dev_bbbbbbbbbbbbbbbb",
            negotiationId = "0123456789abcdef01234567",
            negotiationGeneration = 7,
            type = "offer",
            sdp = "v=0\r\n",
        )
        assertEquals("signal", description.getString("type"))
        assertFalse(description.toString().contains("clipboard"))
        assertFalse(description.toString().contains("text"))

        val candidate = NativeDirectSignalProtocol.candidateFrame(
            targetDeviceId = "dev_bbbbbbbbbbbbbbbb",
            negotiationId = "0123456789abcdef01234567",
            negotiationGeneration = 7,
            sdpMid = "0",
            sdpMLineIndex = 0,
            candidate = "candidate:1 1 UDP 1 192.168.1.2 12345 typ host",
        )
        assertEquals("candidate", candidate.getJSONObject("signal").getString("kind"))
    }

    @Test
    fun `text direct capability is strict`() {
        val local = NativeDirectSignalProtocol.textDirectCapabilitiesJson()
        assertEquals(1, local.length())
        assertEquals("text-direct", local.getString(0))
        assertTrue(NativeDirectSignalProtocol.remoteSupportsTextDirect(JSONArray().put("text-direct")))
        assertTrue(NativeDirectSignalProtocol.remoteSupportsTextDirect(
            JSONArray().put("room-core").put("text-direct"),
        ))
        assertFalse(NativeDirectSignalProtocol.remoteSupportsTextDirect(JSONArray().put("room-core")))
        assertFalse(NativeDirectSignalProtocol.remoteSupportsTextDirect(JSONArray().put("text-direct").put("unknown")))
    }

    @Test
    fun `malformed signaling is rejected before a transport sees it`() {
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
