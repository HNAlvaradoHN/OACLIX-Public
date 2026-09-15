package app.oaclix.android

import android.webkit.JavascriptInterface
import app.oaclix.android.identity.AndroidKeystoreDeviceIdentity
import org.json.JSONObject
import org.json.JSONTokener

internal class OaclixWebBridge(
    private val identity: AndroidKeystoreDeviceIdentity = AndroidKeystoreDeviceIdentity(),
) {
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
}
