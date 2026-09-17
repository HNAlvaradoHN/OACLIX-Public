package app.oaclix.android.share

import app.oaclix.android.identity.NativeLinkedDevicesSnapshot

internal sealed interface NativeShareDestination {
    val stableId: String
    val label: String

    data object LocalClipboard : NativeShareDestination {
        override val stableId: String = "local"
        override val label: String = "Mi portapapeles"
    }

    data class LinkedDevice(
        val deviceId: String,
        override val label: String,
    ) : NativeShareDestination {
        override val stableId: String = "device:$deviceId"
    }
}

internal object NativeShareDestinationResolver {
    fun resolve(
        currentDeviceId: String,
        linked: NativeLinkedDevicesSnapshot,
    ): List<NativeShareDestination> {
        require(currentDeviceId.startsWith("dev_")) { "deviceId actual inválido" }

        val remoteDevices = linked.devices
            .asSequence()
            .filter { it.id != currentDeviceId }
            .distinctBy { it.id }
            .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.label })
            .map { device ->
                NativeShareDestination.LinkedDevice(
                    deviceId = device.id,
                    label = device.label,
                )
            }
            .toList()

        return buildList {
            add(NativeShareDestination.LocalClipboard)
            addAll(remoteDevices)
        }
    }
}
