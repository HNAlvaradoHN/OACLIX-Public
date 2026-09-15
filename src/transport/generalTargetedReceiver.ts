import { storeReceivedGeneralTargetedText } from '../data/generalTargetedInbox'
import type { LocalClipboardTransfer } from '../realtime/localClipboardTransfer'
import { publishGeneralTargetedReceipt } from './generalTargetedReceiptBus'

export async function receiveGeneralTargetedText(
  roomId: string,
  transfer: LocalClipboardTransfer,
  remoteDeviceId: string,
  delivery: 'direct' | 'cloud',
) {
  const stored = await storeReceivedGeneralTargetedText(roomId, transfer, remoteDeviceId)
  if (stored) publishGeneralTargetedReceipt(roomId, stored, delivery)
  return stored
}
