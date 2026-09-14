package app.oaclix.android.share

import app.oaclix.android.identity.AndroidKeystoreDeviceIdentity
import app.oaclix.android.identity.NativeIdentityApi
import app.oaclix.android.identity.NativeIdentityApiException
import app.oaclix.android.identity.NativeIdentityLinkingApi
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.Base64

internal data class NativeClipboardCreateSnapshot(
    val created: Boolean,
    val itemId: String,
    val roomId: String,
    val text: String,
    val changeSequence: Long,
)

internal class NativeClipboardApi(
    baseUrl: String,
    private val identity: AndroidKeystoreDeviceIdentity = AndroidKeystoreDeviceIdentity(),
    private val connectionFactory: (URL) -> HttpURLConnection = { url -> url.openConnection() as HttpURLConnection },
) {
    private val normalizedBaseUrl = NativeIdentityApi.normalizeBaseUrl(baseUrl)

    fun createText(
        roomId: String,
        text: String,
        itemId: String = newItemId(),
    ): NativeClipboardCreateSnapshot {
        val payload = createTextPayload(roomId, itemId, text)
        val proof = identity.signAction(ACTION_CREATE_TEXT, payload)
        val body = NativeIdentityLinkingApi.signedEnvelopeBody(proof)
        val raw = postJson(PATH_CREATE_TEXT, body)
        return parseCreateTextResponse(raw, roomId, itemId, text)
    }

    private fun postJson(path: String, body: String): String {
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
                throw NativeIdentityApiException(status, serverMessage.ifBlank { "Envío de portapapeles rechazado ($status)" })
            }
            if (responseText.isBlank()) throw IOException("El servidor devolvió una respuesta vacía")
            return responseText
        } finally {
            connection.disconnect()
        }
    }

    internal companion object {
        private const val PATH_CREATE_TEXT = "/api/clipboard/text/create"
        private const val ACTION_CREATE_TEXT = "clipboard.text.create"
        private const val MAX_TEXT_LENGTH = 8_000
        private val ROOM_ID_PATTERN = Regex("^[A-Za-z0-9_-]{8,96}$")
        private val ITEM_ID_PATTERN = Regex("^itm_[A-Za-z0-9_-]{16,80}$")
        private val random = SecureRandom()

        fun createTextPayload(roomId: String, itemId: String, text: String): String {
            val normalizedRoomId = roomId.trim()
            val normalizedItemId = itemId.trim()
            require(ROOM_ID_PATTERN.matches(normalizedRoomId)) { "Sala General inválida" }
            require(ITEM_ID_PATTERN.matches(normalizedItemId)) { "Identificador de elemento inválido" }
            require(text.isNotEmpty() && text.isNotBlank() && text.length <= MAX_TEXT_LENGTH) { "Texto inválido" }

            return JSONObject()
                .put("roomId", normalizedRoomId)
                .put("itemId", normalizedItemId)
                .put("text", text)
                .toString()
        }

        fun newItemId(): String {
            val bytes = ByteArray(18)
            random.nextBytes(bytes)
            val token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
            return "itm_$token"
        }

        fun parseCreateTextResponse(raw: String, expectedRoomId: String, expectedItemId: String, expectedText: String): NativeClipboardCreateSnapshot {
            val json = JSONObject(raw)
            val item = json.optJSONObject("item") ?: throw IllegalArgumentException("Elemento ausente")
            val itemId = item.optString("id").trim()
            val text = item.optString("text")
            val changeSequence = json.optLong("changeSequence", 0L)
            val created = json.optBoolean("created", false)

            require(itemId == expectedItemId) { "El servidor devolvió otro elemento" }
            require(text == expectedText) { "El servidor devolvió contenido distinto" }
            require(ITEM_ID_PATTERN.matches(itemId)) { "Identificador de elemento inválido" }
            require(ROOM_ID_PATTERN.matches(expectedRoomId.trim())) { "Sala General inválida" }
            require(changeSequence > 0L) { "Secuencia de cambio inválida" }

            return NativeClipboardCreateSnapshot(
                created = created,
                itemId = itemId,
                roomId = expectedRoomId.trim(),
                text = text,
                changeSequence = changeSequence,
            )
        }
    }
}
