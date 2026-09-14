import { storeReceivedLocalImage } from '../data/localImageClipboard'
import { sendDeviceImageRelayAck } from '../realtime/deviceRelayBus'
import {
  createLocalImageTransferAck,
  type LocalImageTransfer,
} from '../realtime/localImageTransfer'
import { publishLocalImageReceipt } from './localImageReceiptBus'

export async function receiveLocalImageRelayTransfer(
  roomId: string,
  transfer: LocalImageTransfer,
  remoteDeviceId: string,
) {
  try {
    const stored = await storeReceivedLocalImage(transfer.item, remoteDeviceId)
    const ack = createLocalImageTransferAck(transfer, stored ? 'stored' : 'expired')
    if (stored) publishLocalImageReceipt(roomId, stored)
    sendDeviceImageRelayAck(roomId, remoteDeviceId, ack)
    return stored
  } catch (error) {
    sendDeviceImageRelayAck(
      roomId,
      remoteDeviceId,
      createLocalImageTransferAck(transfer, 'rejected'),
    )
    throw error
  }
}
