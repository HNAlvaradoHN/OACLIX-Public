package app.oaclix.android.share

import app.oaclix.android.identity.NativeIdentityApi
import app.oaclix.android.identity.NativeIdentityRemoteSnapshot

internal data class NativeGeneralShareSnapshot(
    val roomId: String,
    val itemId: String,
    val changeSequence: Long,
)

internal class NativeGeneralShareTransport(
    private val bootstrapIdentity: () -> NativeIdentityRemoteSnapshot,
    private val createRemoteText: (String, String) -> NativeClipboardCreateSnapshot,
) {
    constructor(baseUrl: String) : this(
        bootstrapIdentity = { NativeIdentityApi(baseUrl).bootstrap() },
        createRemoteText = { roomId, text -> NativeClipboardApi(baseUrl).createText(roomId, text) },
    )

    fun send(text: String): NativeGeneralShareSnapshot {
        require(text.isNotBlank()) { "Texto vacío" }
        require(text.length <= MAX_TEXT_LENGTH) { "Texto demasiado largo" }

        val identity = bootstrapIdentity()
        require(identity.authenticated) { "Dispositivo no autenticado" }
        require(identity.persisted) { "Identidad no persistida" }
        val roomId = identity.generalRoomId?.trim().orEmpty()
        require(ROOM_ID_PATTERN.matches(roomId)) { "Sala General no disponible" }

        val created = createRemoteText(roomId, text)
        require(created.roomId == roomId) { "El servidor confirmó otra sala" }
        require(created.changeSequence > 0L) { "Secuencia de cambio inválida" }

        return NativeGeneralShareSnapshot(
            roomId = created.roomId,
            itemId = created.itemId,
            changeSequence = created.changeSequence,
        )
    }

    internal companion object {
        private const val MAX_TEXT_LENGTH = 8_000
        private val ROOM_ID_PATTERN = Regex("^[A-Za-z0-9_-]{8,96}$")
    }
}
