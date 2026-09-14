package app.oaclix.android.identity

internal class NativeLinkingFlow(
    private val bootstrapIdentity: () -> Unit,
    private val consumeLink: (String) -> NativeLinkConsumeSnapshot,
    private val linkedDevices: () -> NativeLinkedDevicesSnapshot,
    private val createLink: () -> NativeLinkCodeSnapshot = { error("Generar código no configurado") },
    private val renameDeviceAction: (String, String) -> NativeDeviceRenameSnapshot = { _, _ -> error("Renombrar no configurado") },
    private val unlinkDeviceAction: (String) -> NativeDeviceUnlinkSnapshot = { _ -> error("Desvincular no configurado") },
) {
    constructor(
        baseUrl: String,
        identity: AndroidKeystoreDeviceIdentity = AndroidKeystoreDeviceIdentity(),
    ) : this(
        bootstrapIdentity = {
            NativeIdentityApi(baseUrl, identity).bootstrap()
            Unit
        },
        consumeLink = { code -> NativeIdentityLinkingApi(baseUrl, identity).consumeLinkCode(code) },
        linkedDevices = { NativeIdentityLinkingApi(baseUrl, identity).listLinkedDevices() },
        createLink = { NativeIdentityLinkingApi(baseUrl, identity).createLinkCode() },
        renameDeviceAction = { deviceId, label ->
            NativeIdentityLinkingApi(baseUrl, identity).renameLinkedDevice(deviceId, label)
        },
        unlinkDeviceAction = { deviceId -> NativeIdentityLinkingApi(baseUrl, identity).unlinkLinkedDevice(deviceId) },
    )

    fun load(): NativeLinkedDevicesSnapshot {
        bootstrapIdentity()
        return linkedDevices()
    }

    fun createCode(): NativeLinkCodeSnapshot {
        bootstrapIdentity()
        return createLink()
    }

    fun consumeAndLoad(code: String): NativeLinkedDevicesSnapshot {
        bootstrapIdentity()
        val linked = consumeLink(code)
        val roster = linkedDevices()
        require(roster.personId == linked.personId) { "La vinculación devolvió una identidad distinta" }
        return roster
    }

    fun renameAndLoad(deviceId: String, label: String): NativeLinkedDevicesSnapshot {
        bootstrapIdentity()
        val renamed = renameDeviceAction(deviceId, label)
        require(renamed.deviceId == deviceId) { "El servidor renombró un dispositivo distinto" }
        return linkedDevices()
    }

    fun unlinkAndLoad(deviceId: String): NativeLinkedDevicesSnapshot {
        bootstrapIdentity()
        val unlinked = unlinkDeviceAction(deviceId)
        require(unlinked.deviceId == deviceId) { "El servidor desvinculó un dispositivo distinto" }
        return linkedDevices()
    }
}
