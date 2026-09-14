package app.oaclix.android.identity

import java.math.BigInteger
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.util.Base64

internal data class DevicePublicKey(
    val kty: String = "EC",
    val crv: String = "P-256",
    val x: String,
    val y: String,
)

internal object DeviceIdentityProtocol {
    private val urlEncoder = Base64.getUrlEncoder().withoutPadding()

    fun publicKeyFrom(key: ECPublicKey): DevicePublicKey = DevicePublicKey(
        x = base64Url(fixedUnsigned(key.w.affineX, 32)),
        y = base64Url(fixedUnsigned(key.w.affineY, 32)),
    )

    fun canonicalPublicKey(key: DevicePublicKey): String =
        "{\"crv\":\"${key.crv}\",\"kty\":\"${key.kty}\",\"x\":\"${key.x}\",\"y\":\"${key.y}\"}"

    fun deviceId(key: DevicePublicKey): String {
        val digest = sha256(canonicalPublicKey(key).toByteArray(Charsets.UTF_8))
        return "dev_${base64Url(digest).take(24)}"
    }

    fun randomNonce(random: SecureRandom = SecureRandom()): String {
        val bytes = ByteArray(18)
        random.nextBytes(bytes)
        return base64Url(bytes)
    }

    fun bootstrapMessage(key: DevicePublicKey, timestamp: Long, nonce: String): String {
        val digest = base64Url(sha256(canonicalPublicKey(key).toByteArray(Charsets.UTF_8)))
        return "oaclix-bootstrap|1|$timestamp|$nonce|$digest"
    }

    fun actionMessage(
        key: DevicePublicKey,
        action: String,
        timestamp: Long,
        nonce: String,
        payloadJson: String,
    ): String {
        val deviceDigest = base64Url(sha256(canonicalPublicKey(key).toByteArray(Charsets.UTF_8)))
        val payloadDigest = base64Url(sha256(payloadJson.toByteArray(Charsets.UTF_8)))
        return "oaclix-action|1|$action|$timestamp|$nonce|$deviceDigest|$payloadDigest"
    }

    fun base64Url(bytes: ByteArray): String = urlEncoder.encodeToString(bytes)

    fun derToP1363(der: ByteArray, componentSize: Int = 32): ByteArray {
        require(componentSize > 0) { "Tamaño ECDSA inválido" }
        val reader = DerReader(der)
        require(reader.readByte() == 0x30) { "Firma ECDSA DER inválida" }
        val sequenceLength = reader.readLength()
        require(sequenceLength == reader.remaining()) { "Longitud ECDSA DER inválida" }

        require(reader.readByte() == 0x02) { "Componente R ausente" }
        val r = normalizeDerInteger(reader.readBytes(reader.readLength()), componentSize)
        require(reader.readByte() == 0x02) { "Componente S ausente" }
        val s = normalizeDerInteger(reader.readBytes(reader.readLength()), componentSize)
        require(reader.remaining() == 0) { "Datos extra en firma ECDSA" }

        return r + s
    }

    private fun sha256(bytes: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(bytes)

    private fun fixedUnsigned(value: BigInteger, size: Int): ByteArray {
        require(value.signum() >= 0) { "Coordenada EC inválida" }
        val raw = value.toByteArray()
        val unsigned = if (raw.size > 1 && raw[0] == 0.toByte()) raw.copyOfRange(1, raw.size) else raw
        require(unsigned.size <= size) { "Coordenada EC fuera de P-256" }
        return ByteArray(size).also { output ->
            unsigned.copyInto(output, destinationOffset = size - unsigned.size)
        }
    }

    private fun normalizeDerInteger(encoded: ByteArray, size: Int): ByteArray {
        require(encoded.isNotEmpty()) { "Entero ECDSA vacío" }
        require((encoded[0].toInt() and 0x80) == 0) { "Entero ECDSA negativo" }

        var first = 0
        while (first < encoded.lastIndex && encoded[first] == 0.toByte()) first += 1
        val unsigned = encoded.copyOfRange(first, encoded.size)
        require(unsigned.size <= size) { "Entero ECDSA fuera de P-256" }

        return ByteArray(size).also { output ->
            unsigned.copyInto(output, destinationOffset = size - unsigned.size)
        }
    }

    private class DerReader(private val bytes: ByteArray) {
        private var offset = 0

        fun remaining(): Int = bytes.size - offset

        fun readByte(): Int {
            require(offset < bytes.size) { "Firma ECDSA DER truncada" }
            return bytes[offset++].toInt() and 0xff
        }

        fun readLength(): Int {
            val first = readByte()
            if ((first and 0x80) == 0) return first

            val count = first and 0x7f
            require(count in 1..4) { "Longitud DER no soportada" }
            require(count <= remaining()) { "Longitud DER truncada" }

            var length = 0
            repeat(count) {
                length = (length shl 8) or readByte()
            }
            require(length >= 0 && length <= remaining()) { "Longitud DER inválida" }
            return length
        }

        fun readBytes(length: Int): ByteArray {
            require(length >= 0 && length <= remaining()) { "Firma ECDSA DER truncada" }
            return bytes.copyOfRange(offset, offset + length).also { offset += length }
        }
    }
}
