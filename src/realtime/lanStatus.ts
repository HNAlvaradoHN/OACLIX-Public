import {
  clearRealtimeOnlineState,
  getDeviceAvailabilityState,
  hasAnyAvailableDataChannel,
  isRoomRealtimePresenceKnown,
  legacyRouteStatusFromAvailability,
  publishDataChannelDeviceIds,
  publishRealtimeOnlineDeviceIds,
} from './deviceAvailability'

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

const presenceRevisionsByRoom = new Map<string, number>()
const diagnosticsByRoom = new Map<string, Map<string, LanPeerDiagnostic>>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function hasDirectLanPeer() {
  return hasAnyAvailableDataChannel()
}

export function isRealtimePresenceKnown(roomId: string) {
  return isRoomRealtimePresenceKnown(roomId)
}

export function getRealtimePresenceRevision(roomId: string) {
  return presenceRevisionsByRoom.get(roomId) ?? 0
}

export function getDeviceRouteStatus(roomId: string, deviceId: string): DeviceRouteStatus {
  return legacyRouteStatusFromAvailability(getDeviceAvailabilityState(roomId, deviceId))
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
  if (publishDataChannelDeviceIds(roomId, deviceIds)) notify()
}

export function publishRealtimePresence(roomId: string, deviceIds: string[]) {
  publishRealtimeOnlineDeviceIds(roomId, deviceIds)
  presenceRevisionsByRoom.set(roomId, getRealtimePresenceRevision(roomId) + 1)
  // Cada frame de presence es un hint autoritativo del servidor. Aunque los IDs
  // online sean iguales, puede representar un cambio de vínculo de un equipo offline.
  notify()
}

export function clearRealtimePresence(roomId: string) {
  if (clearRealtimeOnlineState(roomId)) notify()
}
