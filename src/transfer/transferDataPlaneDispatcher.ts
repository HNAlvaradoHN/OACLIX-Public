import { executeLocalDirectImageTransfer } from './localDirectImageAdapter.ts'
import { executeLocalDirectTextTransfer } from './localDirectTextAdapter.ts'
import type { TransferJournal } from './transferJournal.ts'
import type { PreparedSenderTransferOperation } from './transferOperationCoordinator.ts'
import type { TransferRouteSelection } from './transferRouteManager.ts'

export type TransferDataPlaneExecutionResult = {
  selection: TransferRouteSelection
  journal: TransferJournal
}

type LocalDirectAdapter = (
  roomId: string,
  operation: PreparedSenderTransferOperation,
  selection: TransferRouteSelection,
) => Promise<TransferDataPlaneExecutionResult>

export type TransferDataPlaneDispatcherDependencies = {
  executeText: LocalDirectAdapter
  executeImage: LocalDirectAdapter
}

const defaultDependencies: TransferDataPlaneDispatcherDependencies = {
  executeText: executeLocalDirectTextTransfer,
  executeImage: executeLocalDirectImageTransfer,
}

function validSelectedAt(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

function selectionMatchesOperation(
  selection: TransferRouteSelection,
  operation: PreparedSenderTransferOperation,
) {
  const manifest = operation.manifest
  return selection.version === 1
    && selection.type === 'transfer-route-selection'
    && selection.requestId === manifest.requestId
    && selection.transferId === manifest.transferId
    && selection.senderDeviceId === manifest.senderDeviceId
    && selection.receiverDeviceId === manifest.receiverDeviceId
    && selection.contentKind === manifest.contentKind
    && validSelectedAt(selection.selectedAt)
}

export async function dispatchPreparedTransferDataPlane(
  roomId: string,
  operation: PreparedSenderTransferOperation,
  selection: TransferRouteSelection,
  dependencies: Partial<TransferDataPlaneDispatcherDependencies> = {},
): Promise<TransferDataPlaneExecutionResult> {
  if (typeof roomId !== 'string' || roomId.length === 0) throw new Error('Sala inválida')
  if (!selectionMatchesOperation(selection, operation)) {
    throw new Error('La selección de ruta no coincide con la operación preparada')
  }
  if (selection.status !== 'selected' || selection.route !== 'local-direct') {
    throw new Error('La transferencia no tiene una ruta de datos seleccionada')
  }

  const deps = { ...defaultDependencies, ...dependencies }
  if (selection.contentKind === 'text') {
    return deps.executeText(roomId, operation, selection)
  }
  if (selection.contentKind === 'image') {
    return deps.executeImage(roomId, operation, selection)
  }

  throw new Error('No existe adaptador de data plane para este tipo de contenido')
}

export function createTransferDataPlaneHandoff(
  roomId: string,
  dependencies: Partial<TransferDataPlaneDispatcherDependencies> = {},
) {
  return async (
    operation: PreparedSenderTransferOperation,
    selection: TransferRouteSelection,
  ) => {
    await dispatchPreparedTransferDataPlane(roomId, operation, selection, dependencies)
  }
}
