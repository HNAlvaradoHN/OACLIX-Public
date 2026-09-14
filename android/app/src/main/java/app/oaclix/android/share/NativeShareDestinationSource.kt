package app.oaclix.android.share

import app.oaclix.android.identity.AndroidKeystoreDeviceIdentity
import app.oaclix.android.identity.NativeIdentityApi
import app.oaclix.android.identity.NativeIdentityLinkingApi
import app.oaclix.android.identity.NativeLinkedDevicesSnapshot

internal class NativeShareDestinationSource(
    private val bootstrapIdentity: () -> Unit,
    private val currentDeviceId: () -> String,
    private val linkedDevices: () -> NativeLinkedDevicesSnapshot,
) {
    constructor(
        baseUrl: String,
        identity: AndroidKeystoreDeviceIdentity = AndroidKeystoreDeviceIdentity(),
    ) : this(
        bootstrapIdentity = {
            NativeIdentityApi(baseUrl, identity).bootstrap()
            Unit
        },
        currentDeviceId = { identity.getOrCreateSnapshot().deviceId },
        linkedDevices = { NativeIdentityLinkingApi(baseUrl, identity).listLinkedDevices() },
    )

    fun load(): List<NativeShareDestination> {
        bootstrapIdentity()
        return NativeShareDestinationResolver.resolve(
            currentDeviceId = currentDeviceId(),
            linked = linkedDevices(),
        )
    }
}
