import type { ClipboardTextSnapshot } from '../data/clipboardCloudApi'
import {
  validLanDirectFirstPrepMeta,
  type LanDirectFirstPrepMeta,
} from './lanDirectFirstPrep.ts'
import {
  validLanDirectFirstBaselineMessage,
  validLanDirectFirstGapRequestMessage,
  validLanDirectFirstReplayMessage,
  type LanDirectFirstBaselineMessage,
  type LanDirectFirstGapRequestMessage,
  type LanDirectFirstReplayMessage,
} from './lanDirectFirstRepair'

export type LanClipboardContentChange =
  | {
      sequence: number
      type: 'upsert'
      item: ClipboardTextSnapshot
      directFirstPrep?: LanDirectFirstPrepMeta
      directOnly?: true
    }
  | {
      sequence: number
      type: 'delete'
      itemId: string
      directFirstPrep?: LanDirectFirstPrepMeta
      directOnly?: true
    }

export type LanClipboardChange =
  | LanClipboardContentChange
  | LanDirectFirstGapRequestMessage
  | LanDirectFirstReplayMessage
  | LanDirectFirstBaselineMessage

type Listener = (change: LanClipboardContentChange, remoteDeviceId: string | null) => void
type GapRequestListener = (message: LanDirectFirstGapRequestMessage, remoteDeviceId: string | null) => void
type ReplayListener = (message: LanDirectFirstReplayMessage, remoteDeviceId: string | null) => void
type BaselineListener = (message: LanDirectFirstBaselineMessage, remoteDeviceId: string | null) => void

const listenersByRoom = new Map<string, Set<Listener>>()
const gapRequestListenersByRoom = new Map<string, Set<GapRequestListener>>()
const replayListenersByRoom = new Map<string, Set<ReplayListener>>()
const baselineListenersByRoom = new Map<string, Set<BaselineListener>>()
const ITEM_ID_PATTERN = /^itm_[A-Za-z0-9_-]{16,80}$/
const PERSON_ID_PATTERN = /^per_[A-Za-z0-9_-]{16,64}$/
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const MAX_TEXT_LENGTH = 8_000

function validSnapshot(value: unknown): value is ClipboardTextSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ClipboardTextSnapshot>
  return Number.isSafeInteger(item.sequence)
    && Number(item.sequence) > 0
    && typeof item.id === 'string'
    && ITEM_ID_PATTERN.test(item.id)
    && typeof item.authorPersonId === 'string'
    && PERSON_ID_PATTERN.test(item.authorPersonId)
    && typeof item.authorDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(item.authorDeviceId)
    && typeof item.text === 'string'
    && item.text.length > 0
    && item.text.length <= MAX_TEXT_LENGTH
    && item.text.trim().length > 0
    && Number.isSafeInteger(item.createdAt)
    && Number.isSafeInteger(item.expiresAt)
    && Number(item.expiresAt) > Number(item.createdAt)
    && (item.directOnly === undefined || item.directOnly === true)
}

export function validLanClipboardChange(value: unknown): value is LanClipboardChange {
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  if (type === 'direct-first-gap-request') return validLanDirectFirstGapRequestMessage(value)
  if (type === 'direct-first-replay') return validLanDirectFirstReplayMessage(value)
  if (type === 'direct-first-baseline') return validLanDirectFirstBaselineMessage(value)

  const change = value as Partial<LanClipboardContentChange>
  if (!Number.isSafeInteger(change.sequence) || Number(change.sequence) <= 0) return false
  if (change.directFirstPrep !== undefined && !validLanDirectFirstPrepMeta(change.directFirstPrep)) return false
  if (change.directOnly !== undefined && change.directOnly !== true) return false
  if (change.directOnly && !change.directFirstPrep) return false

  if (change.type === 'delete') {
    return typeof change.itemId === 'string' && ITEM_ID_PATTERN.test(change.itemId)
  }
  return change.type === 'upsert'
    && validSnapshot(change.item)
    && (!change.directOnly || change.item.directOnly === true)
}

export function subscribeLanClipboardChanges(roomId: string, listener: Listener) {
  let listeners = listenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    listenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)

  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) listenersByRoom.delete(roomId)
  }
}

export function subscribeLanDirectFirstGapRequests(roomId: string, listener: GapRequestListener) {
  let listeners = gapRequestListenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    gapRequestListenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)

  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) gapRequestListenersByRoom.delete(roomId)
  }
}

export function subscribeLanDirectFirstReplays(roomId: string, listener: ReplayListener) {
  let listeners = replayListenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    replayListenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)

  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) replayListenersByRoom.delete(roomId)
  }
}

export function subscribeLanDirectFirstBaselines(roomId: string, listener: BaselineListener) {
  let listeners = baselineListenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    baselineListenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)

  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) baselineListenersByRoom.delete(roomId)
  }
}

export function publishLanClipboardChange(
  roomId: string,
  change: LanClipboardChange,
  remoteDeviceId: string | null = null,
) {
  if (change.type === 'direct-first-gap-request') {
    for (const listener of gapRequestListenersByRoom.get(roomId) ?? []) listener(change, remoteDeviceId)
    return
  }
  if (change.type === 'direct-first-replay') {
    for (const listener of replayListenersByRoom.get(roomId) ?? []) listener(change, remoteDeviceId)
    return
  }
  if (change.type === 'direct-first-baseline') {
    for (const listener of baselineListenersByRoom.get(roomId) ?? []) listener(change, remoteDeviceId)
    return
  }
  for (const listener of listenersByRoom.get(roomId) ?? []) listener(change, remoteDeviceId)
}
