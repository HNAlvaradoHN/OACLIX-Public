export type DirectFirstCoverage = {
  personId: string
  destinationDeviceIds: string[]
}

/**
 * Direct-first solo puede omitir cloud cuando TODOS los demás dispositivos
 * vinculados activos están cubiertos por un DataChannel validado.
 *
 * La lista de vinculados viene del plano de control firmado. Los peers directos
 * vienen del LanPeerManager ya validado por probe/ack. No se infieren destinos
 * a partir de presencia parcial.
 */
export function selectAllDirectDestinations(
  localDeviceId: string,
  linkedDeviceIds: Iterable<string>,
  validatedPeerIds: Iterable<string>,
) {
  const required = Array.from(new Set(linkedDeviceIds))
    .filter((deviceId) => deviceId !== localDeviceId)
    .sort()
  if (required.length === 0) return null

  const direct = new Set(validatedPeerIds)
  if (direct.size !== required.length) return null
  for (const deviceId of required) {
    if (!direct.has(deviceId)) return null
  }
  return required
}
