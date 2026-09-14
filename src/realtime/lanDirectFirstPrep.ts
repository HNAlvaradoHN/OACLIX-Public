export type LanDirectFirstPrepMeta = {
  version: 1
  changeId: string
  authorDeviceId: string
  authorSequence: number
  createdAt: number
}

export type LanDirectFirstPrepAck = {
  version: 1
  type: 'ack'
  changeId: string
  authorDeviceId: string
  authorSequence: number
}

type AckListener = (remoteDeviceId: string, ack: LanDirectFirstPrepAck) => void

const CHANGE_ID_PATTERN = /^chg_[A-Za-z0-9_-]{20,96}$/
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const ackListenersByRoom = new Map<string, Set<AckListener>>()

export function validLanDirectFirstPrepMeta(value: unknown): value is LanDirectFirstPrepMeta {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<LanDirectFirstPrepMeta>
  return input.version === 1
    && typeof input.changeId === 'string'
    && CHANGE_ID_PATTERN.test(input.changeId)
    && typeof input.authorDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(input.authorDeviceId)
    && Number.isSafeInteger(input.authorSequence)
    && (input.authorSequence ?? 0) > 0
    && Number.isSafeInteger(input.createdAt)
    && (input.createdAt ?? 0) > 0
}

export function validLanDirectFirstPrepAck(value: unknown): value is LanDirectFirstPrepAck {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<LanDirectFirstPrepAck>
  return input.version === 1
    && input.type === 'ack'
    && typeof input.changeId === 'string'
    && CHANGE_ID_PATTERN.test(input.changeId)
    && typeof input.authorDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(input.authorDeviceId)
    && Number.isSafeInteger(input.authorSequence)
    && (input.authorSequence ?? 0) > 0
}

export function subscribeLanDirectFirstPrepAcks(roomId: string, listener: AckListener) {
  let listeners = ackListenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    ackListenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)

  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) ackListenersByRoom.delete(roomId)
  }
}

export function publishLanDirectFirstPrepAck(roomId: string, remoteDeviceId: string, ack: LanDirectFirstPrepAck) {
  for (const listener of ackListenersByRoom.get(roomId) ?? []) listener(remoteDeviceId, ack)
}
