package app.oaclix.android.identity

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

internal data class NativeLinkCodeSnapshot(
    val code: String,
    val expiresAt: Long,
)

internal data class NativeLinkConsumeSnapshot(
    val linked: Boolean,
    val personId: String,
    val alreadyLinked: Boolean,
)

internal data class NativeLinkedDeviceSnapshot(
    val id: String,
    val label: String,
    val createdAt: Long,
    val lastSeenAt: Long,
)

internal data class NativeLinkedDevicesSnapshot(
    val personId: String,
    val devices: List<NativeLinkedDeviceSnapshot>,
)

internal data class NativeDeviceRenameSnapshot(
    val renamed: Boolean,
    val deviceId: String,
    val label: String,
)

internal data class NativeDeviceUnlinkSnapshot(
    val unlinked: Boolean,
    val deviceId: String,
    val realtimeInvalidated: Boolean,
)

internal class NativeIdentityLinkingApi(
    baseUrl: String,
    private val identity: AndroidKeystoreDeviceIdentity = AndroidKeystoreDeviceIdentity(),
    private val connectionFactory: (URL) -> HttpURLConnection = { url -> url.openConnection() as HttpURLConnection },
) {
    private val normalizedBaseUrl = NativeIdentityApi.normalizeBaseUrl(baseUrl)

    fun createLinkCode(): NativeLinkCodeSnapshot {
        val response = postSigned("/api/identity/link/create", "identity.link.create", EMPTY_PAYLOAD)
        return parseLinkCodeResponse(response)
    }

    fun consumeLinkCode(code: String): NativeLinkConsumeSnapshot {
        val normalized = normalizeLinkCode(code)
        val payload = "{\"code\":${JSONObject.quote(normalized)}}"
        val response = postSigned("/api/identity/link/consume", "identity.link.consume", payload)
        return parseConsumeResponse(response)
    }

    fun listLinkedDevices(): NativeLinkedDevicesSnapshot {
        val response = postSigned("/api/identity/devices/list", "identity.devices.list", EMPTY_PAYLOAD)
        return parseLinkedDevicesResponse(response)
    }

    fun renameLinkedDevice(deviceId: String, label: String): NativeDeviceRenameSnapshot {
        val normalizedDeviceId = normalizeDeviceId(deviceId)
        val normalizedLabel = normalizeDeviceLabel(label)
        val payload = JSONObject()
            .put("deviceId", normalizedDeviceId)
            .put("label", normalizedLabel)
            .toString()
        val response = postSigned("/api/identity/devices/rename", "identity.devices.rename", payload)
        return parseRenameResponse(response)
    }

    fun unlinkLinkedDevice(deviceId: String): NativeDeviceUnlinkSnapshot {
        val normalizedDeviceId = normalizeDeviceId(deviceId)
        val payload = JSONObject()
            .put("deviceId", normalizedDeviceId)
            .toString()
        val response = postSigned("/api/identity/devices/unlink", "identity.devices.unlink", payload)
        return parseUnlinkResponse(response)
    }

    private fun postSigned(path: String, action: String, payloadJson: String): String {
        val proof = identity.signAction(action, payloadJson)
        val body = signedEnvelopeBody(proof)
        val connection = connectionFactory(URL("$normalizedBaseUrl$path"))
        connection.requestMethod = "POST"
        connection.instanceFollowRedirects = false
        connection.connectTimeout = NativeIdentityApi.DEFAULT_CONNECT_TIMEOUT_MS
        connection.readTimeout = NativeIdentityApi.DEFAULT_READ_TIMEOUT_MS
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Cache-Control", "no-store")

        try {
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val serverMessage = runCatching { JSONObject(responseText).optString("error").trim() }.getOrDefault("")
                throw NativeIdentityApiException(status, serverMessage.ifBlank { "Solicitud de vinculación rechazada ($status)" })
            }
            if (responseText.isBlank()) throw IOException("El servidor devolvió una respuesta vacía")
            return responseText
        } finally {
            connection.disconnect()
        }
    }

    internal companion object {
        private const val EMPTY_PAYLOAD = "{}"
        private val LINK_CODE_PATTERN = Regex("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$")
        private val PERSON_ID_PATTERN = Regex("^per_[A-Za-z0-9_-]{16,64}$")
        private val DEVICE_ID_PATTERN = Regex("^dev_[A-Za-z0-9_-]{16,64}$")
        private val DEVICE_LABEL_CONTROL_PATTERN = Regex("[\\u0000-\\u001F\\u007F]")

        fun normalizeLinkCode(value: String): String {
            val normalized = value.uppercase().replace(Regex("[\\s-]"), "")
            require(LINK_CODE_PATTERN.matches(normalized)) { "Código inválido" }
            return normalized
        }

        fun normalizeDeviceId(value: String): String {
            val normalized = value.trim()
            require(DEVICE_ID_PATTERN.matches(normalized)) { "deviceId inválido" }
            return normalized
        }

        fun normalizeDeviceLabel(value: String): String {
            val normalized = value.trim().replace(DEVICE_LABEL_CONTROL_PATTERN, "").take(48)
            require(normalized.isNotBlank()) { "Escribe un nombre para el dispositivo" }
            return normalized
        }

        fun signedEnvelopeBody(proof: NativeActionProof): String = JSONObject()
            .put("version", proof.version)
            .put("publicKey", JSONObject()
                .put("kty", proof.publicKey.kty)
                .put("crv", proof.publicKey.crv)
                .put("x", proof.publicKey.x)
                .put("y", proof.publicKey.y))
            .put("timestamp", proof.timestamp)
            .put("nonce", proof.nonce)
            .put("payload", JSONObject(proof.payloadJson))
            .put("signature", proof.signature)
            .toString()

        fun parseLinkCodeResponse(raw: String): NativeLinkCodeSnapshot {
            val json = JSONObject(raw)
            val formatted = json.optString("code").trim()
            val normalized = normalizeLinkCode(formatted)
            val expiresAt = json.optLong("expiresAt", 0L)
            require(expiresAt > 0L) { "Expiración de código inválida" }
            return NativeLinkCodeSnapshot("${normalized.take(5)}-${normalized.drop(5)}", expiresAt)
        }

        fun parseConsumeResponse(raw: String): NativeLinkConsumeSnapshot {
            val json = JSONObject(raw)
            val linked = json.optBoolean("linked", false)
            val personId = json.optString("personId").trim()
            require(linked) { "El servidor no confirmó la vinculación" }
            require(PERSON_ID_PATTERN.matches(personId)) { "personId inválido" }
            return NativeLinkConsumeSnapshot(true, personId, json.optBoolean("alreadyLinked", false))
        }

        fun parseLinkedDevicesResponse(raw: String): NativeLinkedDevicesSnapshot {
            val json = JSONObject(raw)
            val personId = json.optString("personId").trim()
            require(PERSON_ID_PATTERN.matches(personId)) { "personId inválido" }
            val devicesJson = json.optJSONArray("devices") ?: JSONArray()
            val devices = buildList {
                for (index in 0 until devicesJson.length()) {
                    val item = devicesJson.optJSONObject(index) ?: throw IllegalArgumentException("Dispositivo inválido")
                    val id = item.optString("id").trim()
                    val label = item.optString("label").trim()
                    val createdAt = item.optLong("createdAt", 0L)
                    val lastSeenAt = item.optLong("lastSeenAt", 0L)
                    require(DEVICE_ID_PATTERN.matches(id)) { "deviceId inválido" }
                    require(label.isNotBlank()) { "Nombre de dispositivo inválido" }
                    require(createdAt > 0L && lastSeenAt > 0L) { "Fechas de dispositivo inválidas" }
                    add(NativeLinkedDeviceSnapshot(id, label, createdAt, lastSeenAt))
                }
            }
            return NativeLinkedDevicesSnapshot(personId, devices)
        }

        fun parseRenameResponse(raw: String): NativeDeviceRenameSnapshot {
            val json = JSONObject(raw)
            val renamed = json.optBoolean("renamed", false)
            val deviceId = normalizeDeviceId(json.optString("deviceId"))
            val label = normalizeDeviceLabel(json.optString("label"))
            require(renamed) { "El servidor no confirmó el cambio de nombre" }
            return NativeDeviceRenameSnapshot(true, deviceId, label)
        }

        fun parseUnlinkResponse(raw: String): NativeDeviceUnlinkSnapshot {
            val json = JSONObject(raw)
            val unlinked = json.optBoolean("unlinked", false)
            val deviceId = normalizeDeviceId(json.optString("deviceId"))
            require(unlinked) { "El servidor no confirmó la desvinculación" }
            return NativeDeviceUnlinkSnapshot(
                unlinked = true,
                deviceId = deviceId,
                realtimeInvalidated = json.optBoolean("realtimeInvalidated", false),
            )
        }
    }
}
