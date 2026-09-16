import type {
  TransferControlDecision,
  TransferControlRequest,
} from '../shared/transferControlProtocol.ts'

export type TrustedTransferContext = {
  localDeviceId: string
  remoteDeviceId: string
  trustedSameIdentity: boolean
  decidedAt: number
}

export function createAutomaticTrustedTransferDecision(
  request: TransferControlRequest,
  context: TrustedTransferContext,
): TransferControlDecision | null {
  if (!context.trustedSameIdentity) return null
  if (!Number.isSafeInteger(context.decidedAt) || context.decidedAt <= 0) return null
  if (
    request.senderDeviceId !== context.remoteDeviceId
    || request.receiverDeviceId !== context.localDeviceId
  ) return null

  return {
    version: 1,
    type: 'transfer-decision',
    requestId: request.requestId,
    senderDeviceId: request.senderDeviceId,
    receiverDeviceId: request.receiverDeviceId,
    decision: 'accepted',
    decidedAt: context.decidedAt,
  }
}
