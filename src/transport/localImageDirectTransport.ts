import {
  storeReceivedLocalImageBlob,
  type LocalImageClipboardSnapshot,
} from '../data/localImageClipboard'
import {
  createLocalImageDirectTransfer,
  createLocalImageDirectTransferAck,
  getLocalImageDirectSender,
  subscribeLanLocalImageDirectTransferAcks,
  subscribeLanLocalImageDirectTransfers,
} from '../realtime/localImageDirectTransfer'
import {
  publishLocalImageReceipt,
  subscribeLocalImageReceipts,
} from './localImageReceiptBus'
import { requireAuthorizedDirectDevice } from './localClipboardDirectTransport'

const DIRECT_IMAGE_ACK_TIMEOUT_MS = 90_000

type ReceiptListener = (item: LocalImageClipboardSnapshot) => void
const receiverSubscriptionsByRoom = new Map<string, () => void>()

function ensureReceiver(roomId: string) {
  if (receiverSubscriptionsByRoom.has(roomId)) return

  const unsubscribe = subscribeLanLocalImageDirectTransfers(roomId, ({ transfer, blob }, remoteDeviceId) => {
    const sender = getLocalImageDirectSender(roomId)
    if (!sender) return

    void storeReceivedLocalImageBlob(
      transfer.item,
      blob,
      remoteDeviceId,
      'direct',
    ).then((stored) => {
      sender.sendLocalImageDirectAck(
        remoteDeviceId,
        createLocalImageDirectTransferAck(transfer, stored ? 'stored' : 'expired'),
      )
      if (stored) publishLocalImageReceipt(roomId, stored)
    }).catch(() => {
      sender.sendLocalImageDirectAck(
        remoteDeviceId,
        createLocalImageDirectTransferAck(transfer, 'rejected'),
      )
    })
  })

  receiverSubscriptionsByRoom.set(roomId, unsubscribe)
}

export async function sendLocalImageDirect(
  roomId: string,
  remoteDeviceId: string,
  item: LocalImageClipboardSnapshot,
) {
  if (item.expiresAt <= Date.now()) throw new Error('Esta imagen ya venció')
  if (item.blob.size !== item.byteSize || item.blob.type !== item.mimeType) {
    throw new Error('La imagen local ya no coincide con sus datos guardados')
  }

  const localDeviceId = await requireAuthorizedDirectDevice(roomId, remoteDeviceId)
  const sender = getLocalImageDirectSender(roomId)
  if (!sender || !sender.getValidatedPeerIds().includes(remoteDeviceId)) {
    throw new Error('Ese dispositivo no está disponible por Directo local')
  }

  const transfer = createLocalImageDirectTransfer(item, localDeviceId, remoteDeviceId)
  ensureReceiver(roomId)

  return new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: number | null = null

    const complete = (callback: () => void) => {
      if (settled) return
      settled = true
      if (timer != null) window.clearTimeout(timer)
      unsubscribe()
      callback()
    }

    const unsubscribe = subscribeLanLocalImageDirectTransferAcks(roomId, (ack, ackRemoteDeviceId) => {
      if (
        ackRemoteDeviceId !== remoteDeviceId
        || ack.transferId !== transfer.transferId
        || ack.itemId !== transfer.item.id
      ) return

      if (ack.status === 'stored') {
        complete(resolve)
      } else if (ack.status === 'expired') {
        complete(() => reject(new Error('La imagen venció antes de guardarse en el otro dispositivo')))
      } else {
        complete(() => reject(new Error('El otro dispositivo rechazó la imagen')))
      }
    })

    timer = window.setTimeout(() => {
      complete(() => reject(new Error('No se recibió confirmación de la imagen')))
    }, DIRECT_IMAGE_ACK_TIMEOUT_MS)

    void sender.sendLocalImageDirect(remoteDeviceId, transfer, item.blob)
      .then((sent) => {
        if (!sent) complete(() => reject(new Error('La ruta Directo local cambió durante el envío')))
      })
      .catch(() => {
        complete(() => reject(new Error('No se pudo enviar la imagen por Directo local')))
      })
  })
}

export function subscribeLocalImageDirectReceipts(
  roomId: string,
  listener: ReceiptListener,
) {
  ensureReceiver(roomId)
  return subscribeLocalImageReceipts(roomId, listener)
}
