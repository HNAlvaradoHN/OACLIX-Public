import { storeReceivedLocalClipboardText } from '../data/localClipboard'
import { sendDeviceRelayAck } from '../realtime/deviceRelayBus'
import {
  createLocalClipboardTransferAck,
  type LocalClipboardTransfer,
} from '../realtime/localClipboardTransfer'
import { publishLocalClipboardReceipt } from './localClipboardReceiptBus'

export async function receiveLocalClipboardRelayTransfer(
  roomId: string,
  transfer: LocalClipboardTransfer,
  remoteDeviceId: string,
) {
  try {
    const stored = await storeReceivedLocalClipboardText(transfer.item, remoteDeviceId)
    const ack = createLocalClipboardTransferAck(transfer, stored ? 'stored' : 'expired')
    if (stored) publishLocalClipboardReceipt(roomId, stored)
    sendDeviceRelayAck(roomId, remoteDeviceId, ack)
    return stored
  } catch (error) {
    sendDeviceRelayAck(
      roomId,
      remoteDeviceId,
      createLocalClipboardTransferAck(transfer, 'rejected'),
    )
    throw error
  }
}
