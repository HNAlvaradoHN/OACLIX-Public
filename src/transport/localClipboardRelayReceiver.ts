import { storeReceivedLocalClipboardText } from '../data/localClipboard'
import { sendDeviceRelayAck } from '../realtime/deviceRelayBus'
import {
  clipboardTransferSurface,
  createLocalClipboardTransferAck,
  type LocalClipboardTransfer,
} from '../realtime/localClipboardTransfer'
import { receiveGeneralTargetedText } from './generalTargetedReceiver'
import { publishLocalClipboardReceipt } from './localClipboardReceiptBus'

export async function receiveLocalClipboardRelayTransfer(
  roomId: string,
  transfer: LocalClipboardTransfer,
  remoteDeviceId: string,
) {
  try {
    if (clipboardTransferSurface(transfer) === 'general') {
      const stored = await receiveGeneralTargetedText(roomId, transfer, remoteDeviceId, 'cloud')
      const ack = createLocalClipboardTransferAck(transfer, stored ? 'stored' : 'expired')
      sendDeviceRelayAck(roomId, remoteDeviceId, ack)
      return stored
    }

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
