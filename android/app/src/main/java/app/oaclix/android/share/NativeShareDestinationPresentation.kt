package app.oaclix.android.share

internal data class NativeShareDestinationOption(
    val stableId: String,
    val label: String,
    val actionable: Boolean,
    val destination: NativeShareDestination,
)

internal object NativeShareDestinationPresentation {
    fun options(destinations: List<NativeShareDestination>): List<NativeShareDestinationOption> {
        val repeatedLinkedLabels = destinations
            .filterIsInstance<NativeShareDestination.LinkedDevice>()
            .groupingBy { it.label.trim().lowercase() }
            .eachCount()

        return destinations.map { destination ->
            val visibleLabel = if (
                destination is NativeShareDestination.LinkedDevice
                && (repeatedLinkedLabels[destination.label.trim().lowercase()] ?: 0) > 1
            ) {
                "${destination.label} · ${shortDeviceTag(destination.deviceId)}"
            } else destination.label

            NativeShareDestinationOption(
                stableId = destination.stableId,
                label = visibleLabel,
                actionable = true,
                destination = destination,
            )
        }
    }

    private fun shortDeviceTag(deviceId: String): String = deviceId.removePrefix("dev_").takeLast(4)
}
