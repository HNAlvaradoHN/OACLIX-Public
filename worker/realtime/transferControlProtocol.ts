import {
  TRANSFER_CONTROL_MAX_SERIALIZED_LENGTH,
  validTransferControlForRoute,
  type TransferControlMessage,
} from '../../src/shared/transferControlProtocol.ts'

export type TransferControlInput = {
  type: 'transfer-control'
  targetDeviceId: string
  message: TransferControlMessage
}

const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyEnvelopeKeys(value: Record<string, unknown>) {
  const keys = Object.keys(value).sort()
  return keys.length === 3
    && keys[0] === 'message'
    && keys[1] === 'targetDeviceId'
    && keys[2] === 'type'
}

export function parseTransferControlInput(value: unknown, currentDeviceId: string): TransferControlInput | null {
  if (!isRecord(value) || !hasOnlyEnvelopeKeys(value)) return null
  if (value.type !== 'transfer-control') return null
  if (typeof value.targetDeviceId !== 'string' || !DEVICE_ID_PATTERN.test(value.targetDeviceId)) return null
  if (!DEVICE_ID_PATTERN.test(currentDeviceId) || value.targetDeviceId === currentDeviceId) return null

  const serialized = JSON.stringify(value.message)
  if (serialized.length === 0 || serialized.length > TRANSFER_CONTROL_MAX_SERIALIZED_LENGTH) return null
  if (!validTransferControlForRoute(value.message, currentDeviceId, value.targetDeviceId)) return null

  return {
    type: 'transfer-control',
    targetDeviceId: value.targetDeviceId,
    message: value.message,
  }
}
