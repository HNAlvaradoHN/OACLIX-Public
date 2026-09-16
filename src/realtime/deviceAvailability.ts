import type { TransferControlMessage } from '../shared/transferControlProtocol'

export type DevicePresenceState = 'unknown' | 'online' | 'offline'
export type DeviceDataChannelState = 'available' | 'unavailable'
export type DevicePendingTransferState = 'none' | 'pending'

export type DeviceAvailabilitySnapshot = {
  linked: boolean
  presence: DevicePresenceState
  dataChannel: DeviceDataChannelState
  pendingTransfer: DevicePendingTransferState
  pendingRequestCount: number
}

const linkedDeviceIdsByRoom = new Map<string, Set<string>>()
const onlineDeviceIdsByRoom = new Map<string, Set<string>>()
const presenceKnownRooms = new Set<string>()
const dataChannelDeviceIdsByRoom = new Map<string, Set<string>>()
const pendingRequestsByRoom = new Map<string, Map<string, Map<string, number>>>()
const listeners = new Set<() => void>()

function sameIds(current: Set<string> | undefined, next: Set<string>) {
  if (!current || current.size !== next.size) return false
  for (const value of next) {
    if (!current.has(value)) return false
  }
  return true
}

function publishIds(target: Map<string, Set<string>>, roomId: string, deviceIds: string[]) {
  const normalized = new Set(deviceIds)
  const current = target.get(roomId)
  if (sameIds(current, normalized)) return false
  if (normalized.size === 0) target.delete(roomId)
  else target.set(roomId, normalized)
  return true
}

function notify() {
  for (const listener of listeners) listener()
}

function pendingForDevice(roomId: string, deviceId: string, now: number) {
  const room = pendingRequestsByRoom.get(roomId)
  const device = room?.get(deviceId)
  if (!device) return 0

  for (const [requestId, expiresAt] of device) {
    if (expiresAt <= now) device.delete(requestId)
  }
  if (device.size === 0) {
    room?.delete(deviceId)
    if (room?.size === 0) pendingRequestsByRoom.delete(roomId)
    return 0
  }
  return device.size
}

function setPendingRequest(roomId: string, deviceId: string, requestId: string, expiresAt: number) {
  let room = pendingRequestsByRoom.get(roomId)
  if (!room) {
    room = new Map()
    pendingRequestsByRoom.set(roomId, room)
  }
  let device = room.get(deviceId)
  if (!device) {
    device = new Map()
    room.set(deviceId, device)
  }
  const previous = device.get(requestId)
  device.set(requestId, expiresAt)
  return previous !== expiresAt
}

function clearPendingRequest(roomId: string, deviceId: string, requestId: string) {
  const room = pendingRequestsByRoom.get(roomId)
  const device = room?.get(deviceId)
  if (!device?.delete(requestId)) return false
  if (device.size === 0) room?.delete(deviceId)
  if (room?.size === 0) pendingRequestsByRoom.delete(roomId)
  return true
}

export function subscribeDeviceAvailability(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishKnownLinkedDeviceIds(roomId: string, deviceIds: string[]) {
  const changed = publishIds(linkedDeviceIdsByRoom, roomId, deviceIds)
  if (changed) notify()
  return changed
}

export function publishRealtimeOnlineDeviceIds(roomId: string, deviceIds: string[]) {
  const wasKnown = presenceKnownRooms.has(roomId)
  presenceKnownRooms.add(roomId)
  const changed = publishIds(onlineDeviceIdsByRoom, roomId, deviceIds) || !wasKnown
  if (changed) notify()
  return changed
}

export function clearRealtimeOnlineState(roomId: string) {
  const wasKnown = presenceKnownRooms.delete(roomId)
  const hadOnline = onlineDeviceIdsByRoom.delete(roomId)
  const changed = wasKnown || hadOnline
  if (changed) notify()
  return changed
}

export function publishDataChannelDeviceIds(roomId: string, deviceIds: string[]) {
  const changed = publishIds(dataChannelDeviceIdsByRoom, roomId, deviceIds)
  if (changed) notify()
  return changed
}

export function applyTransferControlAvailability(
  roomId: string,
  remoteDeviceId: string,
  message: TransferControlMessage,
) {
  if (message.senderDeviceId !== remoteDeviceId && message.receiverDeviceId !== remoteDeviceId) return false

  const changed = message.type === 'transfer-request'
    ? setPendingRequest(roomId, remoteDeviceId, message.requestId, message.expiresAt)
    : clearPendingRequest(roomId, remoteDeviceId, message.requestId)
  if (changed) notify()
  return changed
}

export function isRoomRealtimePresenceKnown(roomId: string) {
  return presenceKnownRooms.has(roomId)
}

export function hasAnyAvailableDataChannel() {
  for (const deviceIds of dataChannelDeviceIdsByRoom.values()) {
    if (deviceIds.size > 0) return true
  }
  return false
}

export function getDeviceAvailabilityState(
  roomId: string,
  deviceId: string,
  now = Date.now(),
): DeviceAvailabilitySnapshot {
  const presence: DevicePresenceState = !presenceKnownRooms.has(roomId)
    ? 'unknown'
    : onlineDeviceIdsByRoom.get(roomId)?.has(deviceId) ? 'online' : 'offline'
  const pendingRequestCount = pendingForDevice(roomId, deviceId, now)

  return {
    linked: linkedDeviceIdsByRoom.get(roomId)?.has(deviceId) ?? false,
    presence,
    dataChannel: dataChannelDeviceIdsByRoom.get(roomId)?.has(deviceId) ? 'available' : 'unavailable',
    pendingTransfer: pendingRequestCount > 0 ? 'pending' : 'none',
    pendingRequestCount,
  }
}

export function legacyRouteStatusFromAvailability(
  state: DeviceAvailabilitySnapshot,
): 'direct' | 'cloud' | 'offline' | 'checking' {
  if (state.dataChannel === 'available') return 'direct'
  if (state.presence === 'unknown') return 'checking'
  return state.presence === 'online' ? 'cloud' : 'offline'
}
