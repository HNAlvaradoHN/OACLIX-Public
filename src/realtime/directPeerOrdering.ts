export function localDeviceInitiatesDirect(localDeviceId: string, remoteDeviceId: string) {
  return localDeviceId !== remoteDeviceId && localDeviceId < remoteDeviceId
}
