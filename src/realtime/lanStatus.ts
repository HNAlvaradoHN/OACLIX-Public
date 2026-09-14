export type DeviceRouteStatus = 'direct' | 'cloud' | 'offline' | 'checking'

export type LanPeerDiagnostic = {
  signaling: 'ready' | 'connecting' | 'closed'
  role: 'initiator' | 'responder' | 'unknown'
  present: boolean
  peerExists: boolean
  connectionState: string
  iceConnectionState: string
  iceGatheringState: string
  signalingState: string
  channelState: string
  validated: boolean
  localCandidates: number
  remoteCandidates: number
  retryAttempt: number
  sessionSuffix: string
  negotiationSuffix: string
  lastEvent: string
  updatedAt: number
}

const directPeerIdsByRoom = new Map<string, Set<string>>()
const presentDeviceIdsByRoom = new Map<string, Set<string>>()
const presenceKnownRooms = new Set<string>()
const presenceRevisionsByRoom = new Map<string, number>()
const diagnosticsByRoom = new Map<string, Map<string, LanPeerDiagnostic>>()
const listeners = new Set<() => void>()

function sameIds(current: Set<string> | undefined, next: Set<string>) {
  if (!current || current.size !== next.size) return false
  for (const value of next) {
    if (!current.has(value)) return false
  }
  return true
}

function notify() {
  for (const listener of listeners) listener()
}

function publishIds(target: Map<string, Set<string>>, roomId: string, deviceIds: string[]) {
  const normalized = new Set(deviceIds)
  const current = target.get(roomId)
  if (sameIds(current, normalized)) return false

  if (normalized.size === 0) target.delete(roomId)
  else target.set(roomId, normalized)
  return true
}

export function hasDirectLanPeer() {
  for (const deviceIds of directPeerIdsByRoom.values()) {
    if (deviceIds.size > 0) return true
  }
  return false
}

export function isRealtimePresenceKnown(roomId: string) {
  return presenceKnownRooms.has(roomId)
}

export function getRealtimePresenceRevision(roomId: string) {
  return presenceRevisionsByRoom.get(roomId) ?? 0
}

export function getDeviceRouteStatus(roomId: string, deviceId: string): DeviceRouteStatus {
  if (directPeerIdsByRoom.get(roomId)?.has(deviceId)) return 'direct'
  if (!presenceKnownRooms.has(roomId)) return 'checking'
  if (presentDeviceIdsByRoom.get(roomId)?.has(deviceId)) return 'cloud'
  return 'offline'
}

export function getLanPeerDiagnostic(roomId: string, deviceId: string) {
  return diagnosticsByRoom.get(roomId)?.get(deviceId) ?? null
}

export function publishLanPeerDiagnostic(roomId: string, deviceId: string, diagnostic: LanPeerDiagnostic) {
  let roomDiagnostics = diagnosticsByRoom.get(roomId)
  if (!roomDiagnostics) {
    roomDiagnostics = new Map<string, LanPeerDiagnostic>()
    diagnosticsByRoom.set(roomId, roomDiagnostics)
  }
  roomDiagnostics.set(deviceId, diagnostic)
  notify()
}

export function clearLanPeerDiagnostics(roomId: string) {
  if (diagnosticsByRoom.delete(roomId)) notify()
}

export function subscribeDirectLanStatus(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishDirectLanPeerIds(roomId: string, deviceIds: string[]) {
  if (publishIds(directPeerIdsByRoom, roomId, deviceIds)) notify()
}

export function publishRealtimePresence(roomId: string, deviceIds: string[]) {
  presenceKnownRooms.add(roomId)
  publishIds(presentDeviceIdsByRoom, roomId, deviceIds)
  presenceRevisionsByRoom.set(roomId, getRealtimePresenceRevision(roomId) + 1)
  // Cada frame de presence es un hint autoritativo del servidor. Aunque los IDs
  // online sean iguales, puede representar un cambio de vínculo de un equipo offline.
  notify()
}

export function clearRealtimePresence(roomId: string) {
  const wasKnown = presenceKnownRooms.delete(roomId)
  const hadPresence = presentDeviceIdsByRoom.delete(roomId)
  if (wasKnown || hadPresence) notify()
}
