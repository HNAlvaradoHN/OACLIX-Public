import {
  storeReceivedLocalClipboardText,
  type LocalClipboardTextSnapshot,
  type TransferableLocalClipboardText,
} from '../data/localClipboard'
import type { LinkedDeviceSnapshot } from '../identity/deviceLinking'
import {
  createLocalClipboardTransfer,
  createLocalClipboardTransferAck,
  getLocalClipboardDirectSender,
  subscribeLanLocalClipboardTransferAcks,
  subscribeLanLocalClipboardTransfers,
} from '../realtime/localClipboardTransfer'
import {
  publishLocalClipboardReceipt,
  subscribeLocalClipboardReceipts,
} from './localClipboardReceiptBus'
import {
  loadLinkedShareDevices,
  requireAuthorizedLinkedDevice,
} from './linkedDeviceAuthorization'

const DIRECT_TRANSFER_ACK_TIMEOUT_MS = 8_000

type ReceiptListener = (item: LocalClipboardTextSnapshot) => void

const receiverSubscriptionsByRoom = new Map<string, () => void>()

function ensureReceiver(roomId: string) {
  if (receiverSubscriptionsByRoom.has(roomId)) return

  const unsubscribe = subscribeLanLocalClipboardTransfers(roomId, (transfer, remoteDeviceId) => {
    const sender = getLocalClipboardDirectSender(roomId)
    if (!sender) return

    void storeReceivedLocalClipboardText(transfer.item, remoteDeviceId)
      .then((stored) => {
        const ack = createLocalClipboardTransferAck(transfer, stored ? 'stored' : 'expired')
        sender.sendLocalClipboardTransferAck(remoteDeviceId, ack)
        if (stored) publishLocalClipboardReceipt(roomId, stored)
      })
      .catch(() => {
        sender.sendLocalClipboardTransferAck(
          remoteDeviceId,
          createLocalClipboardTransferAck(transfer, 'rejected'),
        )
      })
  })

  receiverSubscriptionsByRoom.set(roomId, unsubscribe)
}

export function loadLocalClipboardShareDevices(roomId: string): Promise<LinkedDeviceSnapshot[]> {
  return loadLinkedShareDevices(roomId)
}

export function requireAuthorizedDirectDevice(
  roomId: string,
  remoteDeviceId: string,
) {
  return requireAuthorizedLinkedDevice(roomId, remoteDeviceId)
}

async function requireAuthorizedDirectTarget(
  roomId: string,
  remoteDeviceId: string,
) {
  const localDeviceId = await requireAuthorizedLinkedDevice(roomId, remoteDeviceId)
  const sender = getLocalClipboardDirectSender(roomId)
  if (!sender || !sender.getValidatedPeerIds().includes(remoteDeviceId)) {
    throw new Error('Ese dispositivo no está disponible por Directo local')
  }
  return { localDeviceId, sender }
}

export async function sendLocalClipboardTextDirect(
  roomId: string,
  remoteDeviceId: string,
  item: TransferableLocalClipboardText,
) {
  if (item.expiresAt <= Date.now()) throw new Error('Este texto ya venció')
  const { localDeviceId, sender } = await requireAuthorizedDirectTarget(roomId, remoteDeviceId)
  const transfer = createLocalClipboardTransfer(item, localDeviceId, remoteDeviceId)
  ensureReceiver(roomId)

  return new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: number | null = null

    const unsubscribe = subscribeLanLocalClipboardTransferAcks(roomId, (ack, ackRemoteDeviceId) => {
      if (
        ackRemoteDeviceId !== remoteDeviceId
        || ack.transferId !== transfer.transferId
        || ack.itemId !== transfer.item.id
      ) return

      if (ack.status === 'stored') {
        complete(resolve)
      } else if (ack.status === 'expired') {
        complete(() => reject(new Error('El texto venció antes de guardarse en el otro dispositivo')))
      } else {
        complete(() => reject(new Error('El otro dispositivo rechazó el texto')))
      }
    })

    const complete = (callback: () => void) => {
      if (settled) return
      settled = true
      if (timer != null) window.clearTimeout(timer)
      unsubscribe()
      callback()
    }

    timer = window.setTimeout(() => {
      complete(() => reject(new Error('No se recibió confirmación del otro dispositivo')))
    }, DIRECT_TRANSFER_ACK_TIMEOUT_MS)

    if (!sender.sendLocalClipboardTransfer(remoteDeviceId, transfer)) {
      complete(() => reject(new Error('La ruta Directo local cambió antes del envío')))
    }
  })
}

export function subscribeLocalClipboardDirectReceipts(
  roomId: string,
  listener: ReceiptListener,
) {
  ensureReceiver(roomId)
  return subscribeLocalClipboardReceipts(roomId, listener)
}
