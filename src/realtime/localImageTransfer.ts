import {
  validImageBase64,
  type LocalImageTransferItem,
} from '../shared/localImageTransferCore.ts'

export {
  CLOUD_IMAGE_MAX_BYTES,
  LOCAL_IMAGE_RETENTION_MS,
  createLocalImageTransferAck,
  validImageBase64,
  validLocalImageTransfer,
  validLocalImageTransferAck,
} from '../shared/localImageTransferCore.ts'

export type {
  LocalImageTransfer,
  LocalImageTransferAck,
  LocalImageTransferItem,
} from '../shared/localImageTransferCore.ts'

export function decodeImageTransferBytes(item: LocalImageTransferItem) {
  if (!validImageBase64(item.base64Data, item.byteSize)) throw new Error('Imagen remota inválida')
  const binary = atob(item.base64Data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
