package app.oaclix.android

import android.content.Context
import android.webkit.JavascriptInterface
import app.oaclix.android.identity.AndroidKeystoreDeviceIdentity
import app.oaclix.android.imageclipboard.ImageClipboardStore
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

internal class OaclixWebBridge(
    context: Context,
    private val identity: AndroidKeystoreDeviceIdentity = AndroidKeystoreDeviceIdentity(),
) {
    private val imageStore = ImageClipboardStore(context.applicationContext)

    @JavascriptInterface
    fun getDeviceId(): String = identity.getOrCreateSnapshot().deviceId

    @JavascriptInterface
    fun createBootstrapProof(): String {
        val proof = identity.createBootstrapProof()
        return JSONObject()
            .put("version", proof.version)
            .put(
                "publicKey",
                JSONObject()
                    .put("kty", proof.publicKey.kty)
                    .put("crv", proof.publicKey.crv)
                    .put("x", proof.publicKey.x)
                    .put("y", proof.publicKey.y),
            )
            .put("timestamp", proof.timestamp)
            .put("nonce", proof.nonce)
            .put("signature", proof.signature)
            .toString()
    }

    @JavascriptInterface
    fun signAction(action: String, payloadJson: String): String {
        require(action.isNotBlank()) { "Acción de identidad inválida" }
        JSONTokener(payloadJson).nextValue() ?: error("Payload JSON inválido")
        val proof = identity.signAction(action, payloadJson)
        return JSONObject()
            .put("version", proof.version)
            .put(
                "publicKey",
                JSONObject()
                    .put("kty", proof.publicKey.kty)
                    .put("crv", proof.publicKey.crv)
                    .put("x", proof.publicKey.x)
                    .put("y", proof.publicKey.y),
            )
            .put("timestamp", proof.timestamp)
            .put("nonce", proof.nonce)
            .put("signature", proof.signature)
            .toString()
    }

    @JavascriptInterface
    fun listLocalImages(): String = JSONArray().apply {
        imageStore.list().forEach { item ->
            put(
                JSONObject()
                    .put("id", item.id)
                    .put("mimeType", item.mimeType)
                    .put("byteSize", item.byteSize)
                    .put("createdAt", item.createdAt)
                    .put("expiresAt", item.expiresAt),
            )
        }
    }.toString()

    @JavascriptInterface
    fun deleteLocalImage(id: String): Boolean {
        val item = imageStore.list().firstOrNull { it.id == id } ?: return false
        imageStore.delete(item)
        return true
    }
}
