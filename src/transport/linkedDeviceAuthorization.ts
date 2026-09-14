import { getLocalDeviceId } from '../identity/deviceIdentity'
import {
  getKnownLinkedDevices,
  listLinkedDevices,
  type LinkedDeviceSnapshot,
  type LinkedDevicesSnapshot,
} from '../identity/deviceLinking'
import { getCloudConnectivityStatus } from '../realtime/cloudSyncHintBus'

const ROSTER_REFRESH_TIMEOUT_MS = 4_000

type AuthorizedShareRoster = {
  localDeviceId: string
  devices: LinkedDeviceSnapshot[]
  deviceIds: Set<string>
}

function authorizedRosterFromSnapshot(
  localDeviceId: string,
  snapshot: LinkedDevicesSnapshot | null,
): AuthorizedShareRoster | null {
  if (!snapshot?.personId?.startsWith('per_')) return null
  const deviceIds = new Set(snapshot.devices.map((device) => device.id))
  if (!deviceIds.has(localDeviceId)) return null
  return { localDeviceId, devices: snapshot.devices, deviceIds }
}

async function knownAuthorizedShareRoster() {
  const localDeviceId = await getLocalDeviceId()
  return authorizedRosterFromSnapshot(localDeviceId, getKnownLinkedDevices())
}

async function refreshAuthorizedShareRoster(): Promise<AuthorizedShareRoster> {
  const localDeviceId = await getLocalDeviceId()
  const result = await listLinkedDevices({ timeoutMs: ROSTER_REFRESH_TIMEOUT_MS })
  const roster = authorizedRosterFromSnapshot(localDeviceId, result)
  if (!roster) throw new Error('Roster vinculado inválido')
  return roster
}

function isNetworkUnavailable(error: unknown) {
  return error instanceof TypeError
    || (error instanceof Error && error.message === 'La conexión tardó demasiado en responder')
}

export async function loadLinkedShareDevices(roomId: string): Promise<LinkedDeviceSnapshot[]> {
  const knownRoster = await knownAuthorizedShareRoster()
  if (knownRoster) return knownRoster.devices
  if (getCloudConnectivityStatus(roomId) === 'offline') {
    throw new Error('Abre Vinculados con Internet una vez antes de compartir sin conexión')
  }
  return (await refreshAuthorizedShareRoster()).devices
}

export async function requireAuthorizedLinkedDevice(
  roomId: string,
  remoteDeviceId: string,
) {
  const localDeviceId = await getLocalDeviceId()
  if (remoteDeviceId === localDeviceId) throw new Error('El destino debe ser otro dispositivo')

  const knownRoster = authorizedRosterFromSnapshot(localDeviceId, getKnownLinkedDevices())
  let roster: AuthorizedShareRoster | null = knownRoster

  if (getCloudConnectivityStatus(roomId) === 'online') {
    try {
      roster = await refreshAuthorizedShareRoster()
    } catch (error) {
      if (!isNetworkUnavailable(error)) throw new Error('No se pudo verificar el dispositivo de destino')
      roster = knownRoster
    }
  }

  if (!roster || roster.localDeviceId !== localDeviceId || !roster.deviceIds.has(remoteDeviceId)) {
    throw new Error('No se pudo verificar el dispositivo de destino')
  }

  return localDeviceId
}
