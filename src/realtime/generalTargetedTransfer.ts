export type GeneralTargetedTransferItem = {
  id: string
  text: string
  createdAt: number
  expiresAt: number
}

export type GeneralTargetedTransfer = {
  version: 1
  type: 'general-targeted-transfer'
  transferId: string
  senderPersonId: string
  senderDeviceId: string
  receiverDeviceId: string
  item: GeneralTargetedTransferItem
}

export type GeneralTargetedTransferAck = {
  version: 1
  type: 'general-targeted-transfer-ack'
  transferId: string
  senderDeviceId: string
  receiverDeviceId: string
  itemId: string
  status: 'stored' | 'expired' | 'rejected'
}

const TRANSFER_ID_PATTERN = /^gtr_[a-f0-9]{24}$/
const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/
const PERSON_ID_PATTERN = /^per_[A-Za-z0-9_-]{16,64}$/
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const MAX_TEXT_LENGTH = 8_000
const MAX_RETENTION_MS = 21_600_000

function randomTransferId() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `gtr_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

function validItem(value: unknown): value is GeneralTargetedTransferItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<GeneralTargetedTransferItem>
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

export function createGeneralTargetedTransfer(
  item: GeneralTargetedTransferItem,
  senderPersonId: string,
  senderDeviceId: string,
  receiverDeviceId: string,
  transferId = randomTransferId(),
): GeneralTargetedTransfer {
  const transfer: GeneralTargetedTransfer = {
    version: 1,
    type: 'general-targeted-transfer',
    transferId,
    senderPersonId,
    senderDeviceId,
    receiverDeviceId,
    item: {
      id: item.id,
      text: item.text,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
    },
  }
  if (!validGeneralTargetedTransfer(transfer)) throw new Error('Transferencia dirigida de General inválida')
  return transfer
}

export function createGeneralTargetedTransferAck(
  transfer: GeneralTargetedTransfer,
  status: GeneralTargetedTransferAck['status'],
): GeneralTargetedTransferAck {
  return {
    version: 1,
    type: 'general-targeted-transfer-ack',
    transferId: transfer.transferId,
    senderDeviceId: transfer.senderDeviceId,
    receiverDeviceId: transfer.receiverDeviceId,
    itemId: transfer.item.id,
    status,
  }
}

export function validGeneralTargetedTransfer(value: unknown): value is GeneralTargetedTransfer {
  if (!value || typeof value !== 'object') return false
  const transfer = value as Partial<GeneralTargetedTransfer>
  return transfer.version === 1
    && transfer.type === 'general-targeted-transfer'
    && typeof transfer.transferId === 'string'
    && TRANSFER_ID_PATTERN.test(transfer.transferId)
    && typeof transfer.senderPersonId === 'string'
    && PERSON_ID_PATTERN.test(transfer.senderPersonId)
    && typeof transfer.senderDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(transfer.senderDeviceId)
    && typeof transfer.receiverDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(transfer.receiverDeviceId)
    && transfer.senderDeviceId !== transfer.receiverDeviceId
    && validItem(transfer.item)
}

export function validGeneralTargetedTransferAck(value: unknown): value is GeneralTargetedTransferAck {
  if (!value || typeof value !== 'object') return false
  const ack = value as Partial<GeneralTargetedTransferAck>
  return ack.version === 1
    && ack.type === 'general-targeted-transfer-ack'
    && typeof ack.transferId === 'string'
    && TRANSFER_ID_PATTERN.test(ack.transferId)
    && typeof ack.senderDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(ack.senderDeviceId)
    && typeof ack.receiverDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(ack.receiverDeviceId)
    && ack.senderDeviceId !== ack.receiverDeviceId
    && typeof ack.itemId === 'string'
    && ITEM_ID_PATTERN.test(ack.itemId)
    && (ack.status === 'stored' || ack.status === 'expired' || ack.status === 'rejected')
}
