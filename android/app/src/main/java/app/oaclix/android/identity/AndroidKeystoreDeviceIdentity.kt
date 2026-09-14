package app.oaclix.android.identity

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

internal data class NativeDeviceIdentitySnapshot(
    val deviceId: String,
    val publicKey: DevicePublicKey,
    val createdLocally: Boolean,
)

internal data class NativeBootstrapProof(
    val version: Int = 1,
    val publicKey: DevicePublicKey,
    val timestamp: Long,
    val nonce: String,
    val signature: String,
)

internal data class NativeActionProof(
    val version: Int = 1,
    val publicKey: DevicePublicKey,
    val timestamp: Long,
    val nonce: String,
    val payloadJson: String,
    val signature: String,
)

internal class AndroidKeystoreDeviceIdentity {
    fun getOrCreateSnapshot(): NativeDeviceIdentitySnapshot {
        val material = loadOrCreateKeyPair()
        val publicKey = DeviceIdentityProtocol.publicKeyFrom(material.keyPair.public as ECPublicKey)
        return NativeDeviceIdentitySnapshot(
            deviceId = DeviceIdentityProtocol.deviceId(publicKey),
            publicKey = publicKey,
            createdLocally = material.createdLocally,
        )
    }

    fun createBootstrapProof(
        timestamp: Long = System.currentTimeMillis(),
        nonce: String = DeviceIdentityProtocol.randomNonce(),
    ): NativeBootstrapProof {
        val material = loadOrCreateKeyPair()
        val publicKey = DeviceIdentityProtocol.publicKeyFrom(material.keyPair.public as ECPublicKey)
        val message = DeviceIdentityProtocol.bootstrapMessage(publicKey, timestamp, nonce)
        val signature = signP1363(material.keyPair.private, message)

        return NativeBootstrapProof(
            publicKey = publicKey,
            timestamp = timestamp,
            nonce = nonce,
            signature = DeviceIdentityProtocol.base64Url(signature),
        )
    }

    fun signAction(
        action: String,
        payloadJson: String,
        timestamp: Long = System.currentTimeMillis(),
        nonce: String = DeviceIdentityProtocol.randomNonce(),
    ): NativeActionProof {
        require(action.isNotBlank()) { "Acción de identidad inválida" }
        val material = loadOrCreateKeyPair()
        val publicKey = DeviceIdentityProtocol.publicKeyFrom(material.keyPair.public as ECPublicKey)
        val message = DeviceIdentityProtocol.actionMessage(publicKey, action, timestamp, nonce, payloadJson)

        return NativeActionProof(
            publicKey = publicKey,
            timestamp = timestamp,
            nonce = nonce,
            payloadJson = payloadJson,
            signature = DeviceIdentityProtocol.base64Url(signP1363(material.keyPair.private, message)),
        )
    }

    private fun loadOrCreateKeyPair(): KeyMaterial {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existingCertificate = keyStore.getCertificate(KEY_ALIAS)
        val existingPrivate = runCatching { keyStore.getKey(KEY_ALIAS, null) as? PrivateKey }.getOrNull()
        val existingPublic = existingCertificate?.publicKey as? ECPublicKey

        if (existingPrivate != null && existingPublic != null) {
            return KeyMaterial(KeyPair(existingPublic, existingPrivate), createdLocally = false)
        }

        if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)

        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false)
            .build()
        generator.initialize(spec)
        val generated = generator.generateKeyPair()
        require(generated.public is ECPublicKey) { "Android Keystore no generó una clave P-256 válida" }
        return KeyMaterial(generated, createdLocally = true)
    }

    private fun signP1363(privateKey: PrivateKey, message: String): ByteArray {
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey)
        signer.update(message.toByteArray(Charsets.UTF_8))
        return DeviceIdentityProtocol.derToP1363(signer.sign(), 32)
    }

    private data class KeyMaterial(
        val keyPair: KeyPair,
        val createdLocally: Boolean,
    )

    private companion object {
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val KEY_ALIAS = "oaclix-native-device-identity-v1"
    }
}
