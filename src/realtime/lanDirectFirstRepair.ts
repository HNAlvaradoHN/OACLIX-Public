import type { DirectChangeEnvelope } from '../transport/directFirstProtocol'

export type LanDirectFirstGapRequest = {
  version: 1
  type: 'gap-request'
  authorDeviceId: string
  afterSequence: number
  throughSequence: number
}

export type LanDirectFirstReplay = {
  version: 1
  type: 'replay-change'
  throughSequence: number
  change: DirectChangeEnvelope
}

export type LanDirectFirstBaseline = {
  version: 1
  type: 'baseline'
  authorDeviceId: string
  throughSequence: number
}

export type LanDirectFirstGapRequestMessage = {
  type: 'direct-first-gap-request'
  targetDeviceId: string
  request: LanDirectFirstGapRequest
}

export type LanDirectFirstReplayMessage = {
  type: 'direct-first-replay'
  targetDeviceId: string
  replay: LanDirectFirstReplay
}

export type LanDirectFirstBaselineMessage = {
  type: 'direct-first-baseline'
  targetDeviceId: string
  baseline: LanDirectFirstBaseline
}

const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const CHANGE_ID_PATTERN = /^chg_[A-Za-z0-9_-]{20,96}$/
const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/
const MAX_TEXT_LENGTH = 8_000
const MAX_TEXT_RETENTION_MS = 21_600_000
const CLOCK_SKEW_MS = 300_000
export const MAX_DIRECT_REPAIR_RANGE = 256

function validReplayEnvelope(value: unknown): value is DirectChangeEnvelope {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<DirectChangeEnvelope>
  if (input.version !== 1) return false
  if (typeof input.changeId !== 'string' || !CHANGE_ID_PATTERN.test(input.changeId)) return false
  if (typeof input.authorDeviceId !== 'string' || !DEVICE_ID_PATTERN.test(input.authorDeviceId)) return false
  if (!Number.isSafeInteger(input.authorSequence) || (input.authorSequence ?? 0) <= 0) return false
  if (typeof input.itemId !== 'string' || !ITEM_ID_PATTERN.test(input.itemId)) return false
  if (input.operation !== 'upsert' && input.operation !== 'delete') return false
  if (!Number.isSafeInteger(input.createdAt) || (input.createdAt ?? 0) <= 0) return false
  if (input.operation === 'delete') return input.text === undefined
  if (typeof input.text !== 'string') return false

  if (input.text.length === 0) {
    const derivedExpiresAt = Number(input.expiresAt ?? Number(input.createdAt) + MAX_TEXT_RETENTION_MS)
    return Number.isSafeInteger(derivedExpiresAt)
      && derivedExpiresAt > Number(input.createdAt)
      && derivedExpiresAt - Number(input.createdAt) <= MAX_TEXT_RETENTION_MS
      && derivedExpiresAt <= Date.now() + CLOCK_SKEW_MS
  }

  return input.text.length <= MAX_TEXT_LENGTH && input.text.trim().length > 0
}

export function validLanDirectFirstGapRequest(value: unknown): value is LanDirectFirstGapRequest {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<LanDirectFirstGapRequest>
  if (input.version !== 1 || input.type !== 'gap-request') return false
  if (typeof input.authorDeviceId !== 'string' || !DEVICE_ID_PATTERN.test(input.authorDeviceId)) return false
  if (!Number.isSafeInteger(input.afterSequence) || (input.afterSequence ?? -1) < 0) return false
  if (!Number.isSafeInteger(input.throughSequence) || (input.throughSequence ?? 0) <= 0) return false
  const range = (input.throughSequence ?? 0) - (input.afterSequence ?? 0)
  if (range <= 0) return false
  // Un receptor sin historial puede pedir un baseline lejano con after=0.
  // Los repairs normales siguen acotados a 256 cambios.
  return input.afterSequence === 0 || range <= MAX_DIRECT_REPAIR_RANGE
}

export function validLanDirectFirstReplay(value: unknown): value is LanDirectFirstReplay {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<LanDirectFirstReplay>
  if (input.version !== 1 || input.type !== 'replay-change') return false
  if (!Number.isSafeInteger(input.throughSequence) || (input.throughSequence ?? 0) <= 0) return false
  if (!validReplayEnvelope(input.change)) return false
  return (input.throughSequence ?? 0) >= input.change.authorSequence
    && (input.throughSequence ?? 0) - input.change.authorSequence < MAX_DIRECT_REPAIR_RANGE
}

export function validLanDirectFirstBaseline(value: unknown): value is LanDirectFirstBaseline {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<LanDirectFirstBaseline>
  return input.version === 1
    && input.type === 'baseline'
    && typeof input.authorDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(input.authorDeviceId)
    && Number.isSafeInteger(input.throughSequence)
    && Number(input.throughSequence) > 0
}

export function validLanDirectFirstGapRequestMessage(value: unknown): value is LanDirectFirstGapRequestMessage {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<LanDirectFirstGapRequestMessage>
  return input.type === 'direct-first-gap-request'
    && typeof input.targetDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(input.targetDeviceId)
    && validLanDirectFirstGapRequest(input.request)
    && input.request.authorDeviceId === input.targetDeviceId
}

export function validLanDirectFirstReplayMessage(value: unknown): value is LanDirectFirstReplayMessage {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<LanDirectFirstReplayMessage>
  return input.type === 'direct-first-replay'
    && typeof input.targetDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(input.targetDeviceId)
    && validLanDirectFirstReplay(input.replay)
}

export function validLanDirectFirstBaselineMessage(value: unknown): value is LanDirectFirstBaselineMessage {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<LanDirectFirstBaselineMessage>
  return input.type === 'direct-first-baseline'
    && typeof input.targetDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(input.targetDeviceId)
    && validLanDirectFirstBaseline(input.baseline)
    && input.baseline.authorDeviceId !== input.targetDeviceId
}
