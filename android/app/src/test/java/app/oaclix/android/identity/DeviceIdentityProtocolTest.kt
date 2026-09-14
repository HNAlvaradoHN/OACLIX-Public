package app.oaclix.android.identity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64

class DeviceIdentityProtocolTest {
    @Test
    fun publicKeyEncodingMatchesServerJwkShapeAndDeviceIdContract() {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        val pair = generator.generateKeyPair()
        val publicKey = DeviceIdentityProtocol.publicKeyFrom(pair.public as ECPublicKey)

        assertEquals("EC", publicKey.kty)
        assertEquals("P-256", publicKey.crv)
        assertTrue(publicKey.x.matches(Regex("^[A-Za-z0-9_-]{43}$")))
        assertTrue(publicKey.y.matches(Regex("^[A-Za-z0-9_-]{43}$")))

        val canonical = DeviceIdentityProtocol.canonicalPublicKey(publicKey)
        assertEquals(
            "{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"${publicKey.x}\",\"y\":\"${publicKey.y}\"}",
            canonical,
        )
        assertTrue(DeviceIdentityProtocol.deviceId(publicKey).matches(Regex("^dev_[A-Za-z0-9_-]{24}$")))
    }

    @Test
    fun bootstrapAndActionMessagesMatchWebProtocolDigests() {
        val key = DevicePublicKey(x = "A".repeat(43), y = "B".repeat(43))
        val timestamp = 1_789_000_000_000L
        val nonce = "abcdefghijklmnopqrstuvwx"
        val canonical = DeviceIdentityProtocol.canonicalPublicKey(key)
        val expectedKeyDigest = digest(canonical)
        val expectedPayloadDigest = digest("{}")

        assertEquals(
            "oaclix-bootstrap|1|$timestamp|$nonce|$expectedKeyDigest",
            DeviceIdentityProtocol.bootstrapMessage(key, timestamp, nonce),
        )
        assertEquals(
            "oaclix-action|1|identity.devices.list|$timestamp|$nonce|$expectedKeyDigest|$expectedPayloadDigest",
            DeviceIdentityProtocol.actionMessage(key, "identity.devices.list", timestamp, nonce, "{}"),
        )
    }

    @Test
    fun derSignatureConvertsToWebCryptoP1363Format() {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        val pair = generator.generateKeyPair()
        val message = "oaclix-identity-format-test".toByteArray()

        val derSigner = Signature.getInstance("SHA256withECDSA")
        derSigner.initSign(pair.private)
        derSigner.update(message)
        val raw = DeviceIdentityProtocol.derToP1363(derSigner.sign())

        assertEquals(64, raw.size)
        val verifier = Signature.getInstance("SHA256withECDSAinP1363Format")
        verifier.initVerify(pair.public)
        verifier.update(message)
        assertTrue(verifier.verify(raw))
    }

    @Test
    fun malformedDerSignatureFailsClosed() {
        assertThrows(IllegalArgumentException::class.java) {
            DeviceIdentityProtocol.derToP1363(byteArrayOf(0x30, 0x01, 0x00))
        }
    }

    @Test
    fun nonceUsesServerAcceptedBase64UrlLength() {
        val nonce = DeviceIdentityProtocol.randomNonce()
        assertTrue(nonce.matches(Regex("^[A-Za-z0-9_-]{24}$")))
    }

    private fun digest(value: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }
}
