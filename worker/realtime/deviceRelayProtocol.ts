import {
  validLocalImageTransfer,
  validLocalImageTransferAck,
  type LocalImageTransfer,
  type LocalImageTransferAck,
} from '../../src/shared/localImageTransferCore.ts'

type RelayTransferItem = {
  id: string
  text: string
  createdAt: number
  expiresAt: number
}

export type DeviceRelayTransfer = {
  version: 1
  type: 'local-clipboard-transfer'
  transferId: string
  senderDeviceId: string
  receiverDeviceId: string
  item: RelayTransferItem
}

export type DeviceRelayAck = {
  version: 1
  type: 'local-clipboard-transfer-ack'
  transferId: string
  senderDeviceId: string
  receiverDeviceId: string
  itemId: string
  status: 'stored' | 'expired' | 'rejected'
}

export type DeviceRelayInput =
  | { type: 'device-transfer'; targetDeviceId: string; transfer: DeviceRelayTransfer }
  | { type: 'device-transfer-ack'; targetDeviceId: string; ack: DeviceRelayAck }
  | { type: 'device-image-transfer'; targetDeviceId: string; transfer: LocalImageTransfer }
  | { type: 'device-image-transfer-ack'; targetDeviceId: string; ack: LocalImageTransferAck }

const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const TRANSFER_ID_PATTERN = /^xfr_[a-f0-9]{24}$/
const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/
const MAX_TEXT_LENGTH = 8_000
const MAX_RETENTION_MS = 21_600_000

function validItem(value: unknown): value is RelayTransferItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<RelayTransferItem>
  return typeof item.id === 'string'
    && ITEM_ID_PATTERN.test(item.id)
    && typeof item.text === 'string'
    && item.text.length > 0
    && item.text.length <= MAX_TEXT_LENGTH
    && item.text.trim().length > 0
    && Number.isSafeInteger(item.createdAt)
    && Number.isSafeInteger(item.expiresAt)
    && Number(item.expiresAt) > Number(item.createdAt)
    && Number(item.expiresAt) - Number(item.createdAt) <= MAX_RETENTION_MS
}

export function validDeviceRelayTransfer(value: unknown, senderDeviceId: string, targetDeviceId: string): value is DeviceRelayTransfer {
  if (!value || typeof value !== 'object') return false
  const transfer = value as Partial<DeviceRelayTransfer>
  return transfer.version === 1
    && transfer.type === 'local-clipboard-transfer'
    && typeof transfer.transferId === 'string'
    && TRANSFER_ID_PATTERN.test(transfer.transferId)
    && transfer.senderDeviceId === senderDeviceId
    && transfer.receiverDeviceId === targetDeviceId
    && senderDeviceId !== targetDeviceId
    && validItem(transfer.item)
}

export function validDeviceRelayAck(value: unknown, currentDeviceId: string, targetDeviceId: string): value is DeviceRelayAck {
  if (!value || typeof value !== 'object') return false
  const ack = value as Partial<DeviceRelayAck>
  return ack.version === 1
    && ack.type === 'local-clipboard-transfer-ack'
    && typeof ack.transferId === 'string'
    && TRANSFER_ID_PATTERN.test(ack.transferId)
    && ack.senderDeviceId === targetDeviceId
    && ack.receiverDeviceId === currentDeviceId
    && targetDeviceId !== currentDeviceId
    && typeof ack.itemId === 'string'
    && ITEM_ID_PATTERN.test(ack.itemId)
    && (ack.status === 'stored' || ack.status === 'expired' || ack.status === 'rejected')
}

function validDeviceImageRelayTransfer(value: unknown, senderDeviceId: string, targetDeviceId: string): value is LocalImageTransfer {
  return validLocalImageTransfer(value)
    && value.senderDeviceId === senderDeviceId
    && value.receiverDeviceId === targetDeviceId
    && senderDeviceId !== targetDeviceId
}

function validDeviceImageRelayAck(value: unknown, currentDeviceId: string, targetDeviceId: string): value is LocalImageTransferAck {
  return validLocalImageTransferAck(value)
    && value.senderDeviceId === targetDeviceId
    && value.receiverDeviceId === currentDeviceId
    && targetDeviceId !== currentDeviceId
}

export function parseDeviceRelayInput(value: unknown, currentDeviceId: string): DeviceRelayInput | null {
  if (!value || typeof value !== 'object') return null
  const input = value as { type?: unknown; targetDeviceId?: unknown; transfer?: unknown; ack?: unknown }
  if (typeof input.targetDeviceId !== 'string' || !DEVICE_ID_PATTERN.test(input.targetDeviceId)) return null
  if (input.targetDeviceId === currentDeviceId) return null

  if (input.type === 'device-transfer' && validDeviceRelayTransfer(input.transfer, currentDeviceId, input.targetDeviceId)) {
    return { type: 'device-transfer', targetDeviceId: input.targetDeviceId, transfer: input.transfer }
  }
  if (input.type === 'device-transfer-ack' && validDeviceRelayAck(input.ack, currentDeviceId, input.targetDeviceId)) {
    return { type: 'device-transfer-ack', targetDeviceId: input.targetDeviceId, ack: input.ack }
  }
  if (input.type === 'device-image-transfer' && validDeviceImageRelayTransfer(input.transfer, currentDeviceId, input.targetDeviceId)) {
    return { type: 'device-image-transfer', targetDeviceId: input.targetDeviceId, transfer: input.transfer }
  }
  if (input.type === 'device-image-transfer-ack' && validDeviceImageRelayAck(input.ack, currentDeviceId, input.targetDeviceId)) {
    return { type: 'device-image-transfer-ack', targetDeviceId: input.targetDeviceId, ack: input.ack }
  }
  return null
}
