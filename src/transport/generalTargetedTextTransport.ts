import { sendDeviceRelayTransfer, subscribeDeviceRelayAcks } from '../realtime/deviceRelayBus'
import { getDeviceRouteStatus } from '../realtime/lanStatus'
import {
  createGeneralClipboardTransfer,
  getLocalClipboardDirectSender,
  subscribeLanLocalClipboardTransferAcks,
  type LocalClipboardTransferAck,
  type LocalClipboardTransferItem,
} from '../realtime/localClipboardTransfer'
import { requireAuthorizedLinkedDevice } from './linkedDeviceAuthorization'

const GENERAL_RETENTION_MS = 21_600_000
const DELIVERY_ACK_TIMEOUT_MS = 8_000

type Delivery = 'direct' | 'cloud'
type AckSubscribe = (listener: (ack: LocalClipboardTransferAck, remoteDeviceId: string) => void) => () => void

type AckWaiter = {
  promise: Promise<void>
  cancel: () => void
}

function randomItemId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `itm_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

function createAckWaiter(
  remoteDeviceId: string,
  transferId: string,
  itemId: string,
  subscribe: AckSubscribe,
  timeoutMs = DELIVERY_ACK_TIMEOUT_MS,
): AckWaiter {
  let unsubscribe: () => void = () => undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  let settled = false

  const cleanup = () => {
    unsubscribe()
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const promise = new Promise<void>((resolve, reject) => {
    unsubscribe = subscribe((ack, ackRemoteDeviceId) => {
      if (
        ackRemoteDeviceId !== remoteDeviceId
        || ack.transferId !== transferId
        || ack.itemId !== itemId
      ) return
      if (settled) return
      settled = true
      cleanup()
      if (ack.status === 'stored') resolve()
      else if (ack.status === 'expired') reject(new Error('El texto venció antes de guardarse en el dispositivo elegido'))
      else reject(new Error('El dispositivo elegido rechazó el texto'))
    })

    timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('El dispositivo elegido no confirmó que guardó el texto'))
    }, timeoutMs)
  })

  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      cleanup()
    },
  }
}

function createGeneralItem(text: string, now = Date.now()): LocalClipboardTransferItem {
  if (text.trim().length === 0) throw new Error('Escribe o pega un texto primero')
  if (text.length > 8_000) throw new Error('El texto supera el límite de 8.000 caracteres')
  return {
    id: randomItemId(),
    text,
    createdAt: now,
    expiresAt: now + GENERAL_RETENTION_MS,
  }
}

export async function sendGeneralTargetedText(
  roomId: string,
  remoteDeviceId: string,
  text: string,
): Promise<{ delivery: Delivery; item: LocalClipboardTransferItem }> {
  const localDeviceId = await requireAuthorizedLinkedDevice(roomId, remoteDeviceId)
  const route = getDeviceRouteStatus(roomId, remoteDeviceId)
  const item = createGeneralItem(text)
  const transfer = createGeneralClipboardTransfer(item, localDeviceId, remoteDeviceId)

  if (route === 'direct') {
    const sender = getLocalClipboardDirectSender(roomId)
    if (!sender || !sender.getValidatedPeerIds().includes(remoteDeviceId)) {
      throw new Error('La ruta Directo cambió antes del envío')
    }
    const waiter = createAckWaiter(
      remoteDeviceId,
      transfer.transferId,
      transfer.item.id,
      (listener) => subscribeLanLocalClipboardTransferAcks(roomId, listener),
    )
    if (!sender.sendLocalClipboardTransfer(remoteDeviceId, transfer)) {
      waiter.cancel()
      throw new Error('La ruta Directo cambió antes del envío')
    }
    await waiter.promise
    return { delivery: 'direct', item }
  }

  if (route === 'cloud') {
    const waiter = createAckWaiter(
      remoteDeviceId,
      transfer.transferId,
      transfer.item.id,
      (listener) => subscribeDeviceRelayAcks(roomId, listener),
    )
    if (!sendDeviceRelayTransfer(roomId, remoteDeviceId, transfer)) {
      waiter.cancel()
      throw new Error('La ruta Nube cambió antes del envío')
    }
    await waiter.promise
    return { delivery: 'cloud', item }
  }

  if (route === 'checking') throw new Error('La conexión del dispositivo todavía se está comprobando')
  throw new Error('El dispositivo elegido está offline')
}
