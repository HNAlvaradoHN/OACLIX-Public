import { postSigned } from './signedRequest'

export type LinkedDeviceSnapshot = {
  id: string
  label: string
  createdAt: number
  lastSeenAt: number
}

export type LinkedDevicesSnapshot = {
  personId: string
  devices: LinkedDeviceSnapshot[]
}

type ListLinkedDevicesOptions = {
  timeoutMs?: number
}

let knownLinkedDevices: LinkedDevicesSnapshot | null = null

function cloneLinkedDevices(snapshot: LinkedDevicesSnapshot): LinkedDevicesSnapshot {
  return {
    personId: snapshot.personId,
    devices: snapshot.devices.map((device) => ({ ...device })),
  }
}

function normalizeDeviceLabel(label: string) {
  const visible = label.trim().split('').filter((character) => {
    const code = character.charCodeAt(0)
    return code >= 0x20 && code !== 0x7f
  }).join('')
  return visible.slice(0, 48)
}

export function getKnownLinkedDevices(): LinkedDevicesSnapshot | null {
  return knownLinkedDevices ? cloneLinkedDevices(knownLinkedDevices) : null
}

export async function createDeviceLinkCode() {
  return postSigned<Record<string, never>, { code: string; expiresAt: number }>(
    '/api/identity/link/create',
    'identity.link.create',
    {},
  )
}

export async function consumeDeviceLinkCode(code: string) {
  const normalized = code.toUpperCase().replace(/[\s-]/g, '')
  const result = await postSigned<{ code: string }, { linked: true; personId: string; alreadyLinked: boolean }>(
    '/api/identity/link/consume',
    'identity.link.consume',
    { code: normalized },
  )
  knownLinkedDevices = null
  return result
}

export async function listLinkedDevices(options: ListLinkedDevicesOptions = {}) {
  const result = await postSigned<Record<string, never>, LinkedDevicesSnapshot>(
    '/api/identity/devices/list',
    'identity.devices.list',
    {},
    options,
  )
  knownLinkedDevices = cloneLinkedDevices(result)
  return result
}

export async function renameLinkedDevice(deviceId: string, label: string) {
  const normalizedLabel = normalizeDeviceLabel(label)
  if (!normalizedLabel) throw new Error('Escribe un nombre para el dispositivo')

  const result = await postSigned<{ deviceId: string; label: string }, { renamed: true; deviceId: string; label: string }>(
    '/api/identity/devices/rename',
    'identity.devices.rename',
    { deviceId, label: normalizedLabel },
  )
  if (knownLinkedDevices) {
    knownLinkedDevices = {
      ...knownLinkedDevices,
      devices: knownLinkedDevices.devices.map((device) => (
        device.id === result.deviceId ? { ...device, label: result.label } : device
      )),
    }
  }
  return result
}

export async function unlinkLinkedDevice(deviceId: string) {
  const result = await postSigned<
    { deviceId: string },
    { unlinked: true; deviceId: string; realtimeInvalidated: boolean }
  >(
    '/api/identity/devices/unlink',
    'identity.devices.unlink',
    { deviceId },
  )
  if (knownLinkedDevices) {
    knownLinkedDevices = {
      ...knownLinkedDevices,
      devices: knownLinkedDevices.devices.filter((device) => device.id !== result.deviceId),
    }
  }
  return result
}
