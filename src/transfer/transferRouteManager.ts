import { getDeviceAvailabilityState } from '../realtime/deviceAvailability.ts'
import type { TransferContentKind } from '../shared/transferControlProtocol.ts'
import { validTransferJournal } from './transferJournal.ts'
import { validTransferManifestShape } from './transferManifest.ts'
import type { PreparedSenderTransferOperation } from './transferOperationCoordinator.ts'

export type TransferRouteKind = 'local-direct'
export type TransferRouteSelectionStatus = 'selected' | 'unavailable'

export type TransferRouteSelection = {
  version: 1
  type: 'transfer-route-selection'
  requestId: string
  transferId: string
  senderDeviceId: string
  receiverDeviceId: string
  contentKind: TransferContentKind
  status: TransferRouteSelectionStatus
  route: TransferRouteKind | null
  selectedAt: number
}

export type PreparedTransferRouteManager = {
  acceptPreparedSenderOperation(
    operation: PreparedSenderTransferOperation,
  ): TransferRouteSelection | Promise<TransferRouteSelection>
}

export type TransferRouteAvailability = {
  localDirect: boolean
}

export type TransferRouteAvailabilityResolver = (
  roomId: string,
  operation: PreparedSenderTransferOperation,
) => TransferRouteAvailability | Promise<TransferRouteAvailability>

function assertPreparedOperation(operation: PreparedSenderTransferOperation) {
  const { intent, manifest, journal } = operation
  if (!validTransferManifestShape(manifest) || !validTransferJournal(journal, manifest)) {
    throw new Error('Operación preparada inválida')
  }
  if (journal.role !== 'sender' || journal.status !== 'prepared') {
    throw new Error('El Route Manager solo acepta operaciones sender preparadas')
  }
  if (
    manifest.requestId !== intent.requestId
    || manifest.senderDeviceId !== intent.senderDeviceId
    || manifest.receiverDeviceId !== intent.receiverDeviceId
    || manifest.contentKind !== intent.contentKind
    || manifest.byteSize !== intent.byteSize
  ) {
    throw new Error('La operación preparada no coincide con su Route Intent')
  }
}

function validSelectedAt(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

export function currentTransferRouteAvailability(
  roomId: string,
  operation: PreparedSenderTransferOperation,
): TransferRouteAvailability {
  const state = getDeviceAvailabilityState(roomId, operation.intent.receiverDeviceId)
  const kindSupportsExistingDirectRoute = operation.manifest.contentKind === 'text'
    || operation.manifest.contentKind === 'image'
  return {
    localDirect: kindSupportsExistingDirectRoute && state.dataChannel === 'available',
  }
}

export async function selectPreparedTransferRoute(
  roomId: string,
  operation: PreparedSenderTransferOperation,
  now = Date.now(),
  resolveAvailability: TransferRouteAvailabilityResolver = currentTransferRouteAvailability,
): Promise<TransferRouteSelection> {
  if (typeof roomId !== 'string' || roomId.length === 0) throw new Error('Sala inválida')
  if (!validSelectedAt(now)) throw new Error('Reloj inválido para selección de ruta')
  assertPreparedOperation(operation)

  const availability = await resolveAvailability(roomId, operation)
  const localDirect = availability?.localDirect === true
  const selected = localDirect

  return {
    version: 1,
    type: 'transfer-route-selection',
    requestId: operation.manifest.requestId,
    transferId: operation.manifest.transferId,
    senderDeviceId: operation.manifest.senderDeviceId,
    receiverDeviceId: operation.manifest.receiverDeviceId,
    contentKind: operation.manifest.contentKind,
    status: selected ? 'selected' : 'unavailable',
    route: selected ? 'local-direct' : null,
    selectedAt: now,
  }
}

export function createPreparedTransferRouteManager(
  roomId: string,
  resolveAvailability: TransferRouteAvailabilityResolver = currentTransferRouteAvailability,
): PreparedTransferRouteManager {
  return {
    acceptPreparedSenderOperation(operation) {
      return selectPreparedTransferRoute(roomId, operation, Date.now(), resolveAvailability)
    },
  }
}
