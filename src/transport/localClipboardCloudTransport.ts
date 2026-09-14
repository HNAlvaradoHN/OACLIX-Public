import type { TransferableLocalClipboardText } from '../data/localClipboard'
import {
  sendDeviceRelayTransfer,
  subscribeDeviceRelayAcks,
} from '../realtime/deviceRelayBus'
import { getDeviceRouteStatus } from '../realtime/lanStatus'
import { createLocalClipboardTransfer } from '../realtime/localClipboardTransfer'
import { requireAuthorizedLinkedDevice } from './linkedDeviceAuthorization'

const CLOUD_TRANSFER_ACK_TIMEOUT_MS = 8_000

export async function sendLocalClipboardTextCloud(
  roomId: string,
  remoteDeviceId: string,
  item: TransferableLocalClipboardText,
) {
  if (item.expiresAt <= Date.now()) throw new Error('Este texto ya venció')
  if (getDeviceRouteStatus(roomId, remoteDeviceId) !== 'cloud') {
    throw new Error('Ese dispositivo no está disponible por Nube')
  }

  const localDeviceId = await requireAuthorizedLinkedDevice(roomId, remoteDeviceId)
  const transfer = createLocalClipboardTransfer(item, localDeviceId, remoteDeviceId)

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

    const unsubscribe = subscribeDeviceRelayAcks(roomId, (ack, ackRemoteDeviceId) => {
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

    timer = window.setTimeout(() => {
      complete(() => reject(new Error('No se recibió confirmación del otro dispositivo por Nube')))
    }, CLOUD_TRANSFER_ACK_TIMEOUT_MS)

    if (!sendDeviceRelayTransfer(roomId, remoteDeviceId, transfer)) {
      complete(() => reject(new Error('La ruta Nube no está disponible en este momento')))
    }
  })
}
