package app.oaclix.android.identity

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

internal data class NativeIdentityRemoteSnapshot(
    val personId: String,
    val deviceId: String,
    val deviceLabel: String,
    val authenticated: Boolean,
    val persisted: Boolean,
    val generalRoomId: String?,
)

internal class NativeIdentityApi(
    baseUrl: String,
    private val identity: AndroidKeystoreDeviceIdentity = AndroidKeystoreDeviceIdentity(),
    private val connectionFactory: (URL) -> HttpURLConnection = { url -> url.openConnection() as HttpURLConnection },
) {
    private val normalizedBaseUrl = normalizeBaseUrl(baseUrl)

    fun bootstrap(
        deviceLabel: String = DEFAULT_DEVICE_LABEL,
        connectTimeoutMs: Int = DEFAULT_CONNECT_TIMEOUT_MS,
        readTimeoutMs: Int = DEFAULT_READ_TIMEOUT_MS,
    ): NativeIdentityRemoteSnapshot {
        val proof = identity.createBootstrapProof()
        val body = bootstrapBody(proof, sanitizeDeviceLabel(deviceLabel))
        val response = postJson("/api/identity/bootstrap", body, connectTimeoutMs, readTimeoutMs)
        return parseBootstrapResponse(response)
    }

    private fun postJson(path: String, body: String, connectTimeoutMs: Int, readTimeoutMs: Int): String {
        require(connectTimeoutMs in 1..60_000) { "Timeout de conexión inválido" }
        require(readTimeoutMs in 1..60_000) { "Timeout de lectura inválido" }
        val connection = connectionFactory(URL("$normalizedBaseUrl$path"))
        connection.requestMethod = "POST"
        connection.instanceFollowRedirects = false
        connection.connectTimeout = connectTimeoutMs
        connection.readTimeout = readTimeoutMs
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
                throw NativeIdentityApiException(status, serverMessage.ifBlank { "Solicitud de identidad rechazada ($status)" })
            }
            if (responseText.isBlank()) throw IOException("El servidor devolvió una respuesta vacía")
            return responseText
        } finally {
            connection.disconnect()
        }
    }

    internal companion object {
        const val DEFAULT_DEVICE_LABEL = "Este dispositivo"
        const val DEFAULT_CONNECT_TIMEOUT_MS = 8_000
        const val DEFAULT_READ_TIMEOUT_MS = 12_000

        fun normalizeBaseUrl(value: String): String {
            val trimmed = value.trim().trimEnd('/')
            require(trimmed.startsWith("https://")) { "OACLIX Android requiere un endpoint HTTPS" }
            val parsed = URL(trimmed)
            require(parsed.protocol == "https") { "OACLIX Android requiere HTTPS" }
            require(!parsed.host.isNullOrBlank()) { "Endpoint OACLIX inválido" }
            require(parsed.userInfo == null) { "El endpoint no puede incluir credenciales" }
            require(parsed.query == null && parsed.ref == null) { "El endpoint debe ser una URL base" }
            return trimmed
        }

        fun sanitizeDeviceLabel(value: String): String {
            val clean = value.filterNot { it.code in 0..31 || it.code == 127 }.trim().take(48)
            return clean.ifBlank { DEFAULT_DEVICE_LABEL }
        }

        fun bootstrapBody(proof: NativeBootstrapProof, deviceLabel: String): String = JSONObject()
            .put("version", proof.version)
            .put("publicKey", JSONObject().put("kty", proof.publicKey.kty).put("crv", proof.publicKey.crv).put("x", proof.publicKey.x).put("y", proof.publicKey.y))
            .put("timestamp", proof.timestamp)
            .put("nonce", proof.nonce)
            .put("signature", proof.signature)
            .put("deviceLabel", sanitizeDeviceLabel(deviceLabel))
            .toString()

        fun parseBootstrapResponse(raw: String): NativeIdentityRemoteSnapshot {
            val json = JSONObject(raw)
            val authenticated = json.optBoolean("authenticated", false)
            val personId = json.optString("personId").trim()
            val deviceId = json.optString("deviceId").trim()
            val deviceLabel = json.optString("deviceLabel", DEFAULT_DEVICE_LABEL).trim()
            val persisted = json.optBoolean("persisted", false)
            val room = if (json.isNull("generalRoomId")) null else json.optString("generalRoomId").trim().ifBlank { null }
            require(authenticated) { "El servidor no autenticó el dispositivo" }
            require(personId.matches(Regex("^per_[A-Za-z0-9_-]{16,64}$"))) { "personId inválido" }
            require(deviceId.matches(Regex("^dev_[A-Za-z0-9_-]{16,64}$"))) { "deviceId inválido" }
            require(deviceLabel.isNotBlank()) { "Nombre de dispositivo inválido" }
            if (persisted) require(room?.matches(Regex("^[A-Za-z0-9_-]{8,96}$")) == true) { "Sala General inválida" }
            return NativeIdentityRemoteSnapshot(personId, deviceId, deviceLabel, true, persisted, room)
        }
    }
}

internal class NativeIdentityApiException(val statusCode: Int, message: String) : IOException(message)
