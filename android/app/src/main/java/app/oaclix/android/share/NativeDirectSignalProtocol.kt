package app.oaclix.android.share

import org.json.JSONArray
import org.json.JSONObject

/**
 * Metadata-only signaling contract for native direct transport.
 *
 * These frames may travel through the OACLIX realtime service because they contain
 * only connection metadata (presence, SDP and ICE). User clipboard payload must
 * never be added to this protocol.
 */
internal object NativeDirectSignalProtocol {
    const val MAX_NEGOTIATION_GENERATION = 1_000_000_000
    private const val MAX_SDP_LENGTH = 24_000
    private const val MAX_CANDIDATE_LENGTH = 8_000
    private val deviceIdPattern = Regex("^dev_[A-Za-z0-9_-]{16,64}$")
    private val sessionIdPattern = Regex("^[A-Za-z0-9_-]{8,96}$")
    private val negotiationIdPattern = Regex("^[a-f0-9]{24}$")

    data class ReadySession(val deviceId: String, val sessionId: String)
    data class PresencePeer(val deviceId: String, val sessionId: String)

    sealed interface Signal {
        val fromDeviceId: String
        val fromSessionId: String
        val negotiationId: String
        val negotiationGeneration: Int

        data class Description(
            override val fromDeviceId: String,
            override val fromSessionId: String,
            override val negotiationId: String,
            override val negotiationGeneration: Int,
            val type: String,
            val sdp: String,
        ) : Signal

        data class Candidate(
            override val fromDeviceId: String,
            override val fromSessionId: String,
            override val negotiationId: String,
            override val negotiationGeneration: Int,
            val sdpMid: String?,
            val sdpMLineIndex: Int,
            val candidate: String,
        ) : Signal
    }

    fun parseReady(message: JSONObject): ReadySession? {
        if (!hasExactKeys(message, setOf("type", "deviceId", "sessionId"))) return null
        if (message.optString("type") != "ready") return null
        val deviceId = message.optString("deviceId")
        val sessionId = message.optString("sessionId")
        if (!validDeviceId(deviceId) || !sessionIdPattern.matches(sessionId)) return null
        return ReadySession(deviceId, sessionId)
    }

    fun parsePresence(message: JSONObject): List<PresencePeer>? {
        if (message.optString("type") != "presence") return null
        val peers = message.optJSONArray("peers") ?: return null
        val result = ArrayList<PresencePeer>(peers.length())
        val seen = HashSet<String>()
        for (index in 0 until peers.length()) {
            val peer = peers.optJSONObject(index) ?: return null
            val deviceId = peer.optString("deviceId")
            val sessionId = peer.optString("sessionId")
            if (!validDeviceId(deviceId) || !sessionIdPattern.matches(sessionId) || !seen.add(deviceId)) return null
            result.add(PresencePeer(deviceId, sessionId))
        }
        return result
    }

    fun parseSignal(message: JSONObject): Signal? {
        if (message.optString("type") != "signal") return null
        val fromDeviceId = message.optString("fromDeviceId")
        val fromSessionId = message.optString("fromSessionId")
        val signal = message.optJSONObject("signal") ?: return null
        val negotiationId = signal.optString("negotiationId")
        val generation = signal.optLong("negotiationGeneration", -1L)
        if (
            !validDeviceId(fromDeviceId)
            || !sessionIdPattern.matches(fromSessionId)
            || !negotiationIdPattern.matches(negotiationId)
            || generation <= 0L
            || generation > MAX_NEGOTIATION_GENERATION.toLong()
        ) return null

        return when (signal.optString("kind")) {
            "description" -> {
                val description = signal.optJSONObject("description") ?: return null
                val type = description.optString("type")
                val sdp = description.optString("sdp")
                if ((type != "offer" && type != "answer") || sdp.isBlank() || sdp.length > MAX_SDP_LENGTH) return null
                Signal.Description(
                    fromDeviceId = fromDeviceId,
                    fromSessionId = fromSessionId,
                    negotiationId = negotiationId,
                    negotiationGeneration = generation.toInt(),
                    type = type,
                    sdp = sdp,
                )
            }

            "candidate" -> {
                val candidateJson = signal.optJSONObject("candidate") ?: return null
                val candidate = candidateJson.optString("candidate")
                val lineIndex = candidateJson.optInt("sdpMLineIndex", -1)
                val mid = if (candidateJson.isNull("sdpMid")) null else candidateJson.optString("sdpMid").takeIf { it.isNotBlank() }
                if (candidate.isBlank() || candidate.length > MAX_CANDIDATE_LENGTH || lineIndex < 0) return null
                Signal.Candidate(
                    fromDeviceId = fromDeviceId,
                    fromSessionId = fromSessionId,
                    negotiationId = negotiationId,
                    negotiationGeneration = generation.toInt(),
                    sdpMid = mid,
                    sdpMLineIndex = lineIndex,
                    candidate = candidate,
                )
            }

            else -> null
        }
    }

    fun descriptionFrame(
        targetDeviceId: String,
        negotiationId: String,
        negotiationGeneration: Int,
        type: String,
        sdp: String,
    ): JSONObject {
        require(validDeviceId(targetDeviceId)) { "Dispositivo de destino inválido" }
        require(negotiationIdPattern.matches(negotiationId)) { "Negociación inválida" }
        require(negotiationGeneration in 1..MAX_NEGOTIATION_GENERATION) { "Generación inválida" }
        require(type == "offer" || type == "answer") { "Descripción inválida" }
        require(sdp.isNotBlank() && sdp.length <= MAX_SDP_LENGTH) { "SDP inválido" }
        return JSONObject()
            .put("type", "signal")
            .put("targetDeviceId", targetDeviceId)
            .put("signal", JSONObject()
                .put("kind", "description")
                .put("negotiationId", negotiationId)
                .put("negotiationGeneration", negotiationGeneration)
                .put("description", JSONObject().put("type", type).put("sdp", sdp)))
    }

    fun candidateFrame(
        targetDeviceId: String,
        negotiationId: String,
        negotiationGeneration: Int,
        sdpMid: String?,
        sdpMLineIndex: Int,
        candidate: String,
    ): JSONObject {
        require(validDeviceId(targetDeviceId)) { "Dispositivo de destino inválido" }
        require(negotiationIdPattern.matches(negotiationId)) { "Negociación inválida" }
        require(negotiationGeneration in 1..MAX_NEGOTIATION_GENERATION) { "Generación inválida" }
        require(sdpMLineIndex >= 0 && candidate.isNotBlank() && candidate.length <= MAX_CANDIDATE_LENGTH) {
            "Candidato ICE inválido"
        }
        return JSONObject()
            .put("type", "signal")
            .put("targetDeviceId", targetDeviceId)
            .put("signal", JSONObject()
                .put("kind", "candidate")
                .put("negotiationId", negotiationId)
                .put("negotiationGeneration", negotiationGeneration)
                .put("candidate", JSONObject()
                    .put("candidate", candidate)
                    .put("sdpMLineIndex", sdpMLineIndex)
                    .put("sdpMid", sdpMid ?: JSONObject.NULL)))
    }

    /** Reject any outbound realtime frame that contains anything beyond SDP/ICE metadata. */
    fun isOutboundSignalFrame(message: JSONObject): Boolean {
        if (!hasExactKeys(message, setOf("type", "targetDeviceId", "signal"))) return false
        if (message.optString("type") != "signal") return false
        if (!validDeviceId(message.optString("targetDeviceId"))) return false
        val signal = message.optJSONObject("signal") ?: return false
        val negotiationId = signal.optString("negotiationId")
        val generation = signal.optLong("negotiationGeneration", -1L)
        if (
            !negotiationIdPattern.matches(negotiationId)
            || generation <= 0L
            || generation > MAX_NEGOTIATION_GENERATION.toLong()
        ) return false

        return when (signal.optString("kind")) {
            "description" -> {
                if (!hasExactKeys(signal, setOf("kind", "negotiationId", "negotiationGeneration", "description"))) return false
                val description = signal.optJSONObject("description") ?: return false
                if (!hasExactKeys(description, setOf("type", "sdp"))) return false
                val type = description.optString("type")
                val sdp = description.optString("sdp")
                (type == "offer" || type == "answer") && sdp.isNotBlank() && sdp.length <= MAX_SDP_LENGTH
            }

            "candidate" -> {
                if (!hasExactKeys(signal, setOf("kind", "negotiationId", "negotiationGeneration", "candidate"))) return false
                val candidateJson = signal.optJSONObject("candidate") ?: return false
                if (!hasExactKeys(candidateJson, setOf("candidate", "sdpMLineIndex", "sdpMid"))) return false
                val candidate = candidateJson.optString("candidate")
                val lineIndex = candidateJson.optInt("sdpMLineIndex", -1)
                candidate.isNotBlank() && candidate.length <= MAX_CANDIDATE_LENGTH && lineIndex >= 0
            }

            else -> false
        }
    }

    fun textDirectCapabilitiesJson(): JSONArray = JSONArray().put(TEXT_DIRECT_CAPABILITY)

    fun remoteSupportsTextDirect(value: Any?): Boolean {
        if (value !is JSONArray || value.length() == 0 || value.length() > 2) return false
        val seen = HashSet<String>()
        for (index in 0 until value.length()) {
            val capability = value.optString(index)
            if (capability != ROOM_CORE_CAPABILITY && capability != TEXT_DIRECT_CAPABILITY) return false
            if (!seen.add(capability)) return false
        }
        return TEXT_DIRECT_CAPABILITY in seen
    }

    fun validDeviceId(value: String): Boolean = deviceIdPattern.matches(value)

    private fun hasExactKeys(value: JSONObject, expected: Set<String>): Boolean {
        val actual = mutableSetOf<String>()
        val keys = value.keys()
        while (keys.hasNext()) actual += keys.next()
        return actual == expected
    }

    private const val ROOM_CORE_CAPABILITY = "room-core"
    private const val TEXT_DIRECT_CAPABILITY = "text-direct"
}
