import type { TransferableLocalClipboardText } from '../data/localClipboard.ts'
import {
  createLocalTextTransferChunkSource,
  loadLocalTextTransferItem,
} from '../data/transferSourceProviders.ts'
import {
  completeTransferJournal,
  markTransferChunkCompleted,
  validTransferJournal,
  type TransferJournal,
} from './transferJournal.ts'
import {
  openTransferChunkSource,
  type TransferSourceReference,
} from './transferChunkSource.ts'
import {
  verifyTransferChunk,
  verifyTransferManifest,
} from './transferManifest.ts'
import type { PreparedSenderTransferOperation } from './transferOperationCoordinator.ts'
import type { TransferRouteSelection } from './transferRouteManager.ts'
import { deleteTransferOperationState } from './transferStateStore.ts'

type LoadTextItem = (
  reference: TransferSourceReference,
  now: number,
) => Promise<TransferableLocalClipboardText | null>

type SendText = (
  roomId: string,
  receiverDeviceId: string,
  item: TransferableLocalClipboardText,
) => Promise<void>

export type LocalDirectTextAdapterDependencies = {
  loadTextItem: LoadTextItem
  sendText: SendText
  deleteState(transferId: string): Promise<void>
  now(): number
}

export type LocalDirectTextTransferResult = {
  selection: TransferRouteSelection
  journal: TransferJournal
}

async function sendTextViaExistingDirectTransport(
  roomId: string,
  receiverDeviceId: string,
  item: TransferableLocalClipboardText,
) {
  const { sendLocalClipboardTextDirect } = await import('../transport/localClipboardDirectTransport.ts')
  return sendLocalClipboardTextDirect(roomId, receiverDeviceId, item)
}

const defaultDependencies: LocalDirectTextAdapterDependencies = {
  loadTextItem: loadLocalTextTransferItem,
  sendText: sendTextViaExistingDirectTransport,
  deleteState: deleteTransferOperationState,
  now: Date.now,
}

function selectionMatchesOperation(
  selection: TransferRouteSelection,
  operation: PreparedSenderTransferOperation,
) {
  const manifest = operation.manifest
  return selection.version === 1
    && selection.type === 'transfer-route-selection'
    && selection.status === 'selected'
    && selection.route === 'local-direct'
    && selection.requestId === manifest.requestId
    && selection.transferId === manifest.transferId
    && selection.senderDeviceId === manifest.senderDeviceId
    && selection.receiverDeviceId === manifest.receiverDeviceId
    && selection.contentKind === manifest.contentKind
    && Number.isSafeInteger(selection.selectedAt)
    && selection.selectedAt > 0
}

async function verifyTextSourceIntegrity(
  operation: PreparedSenderTransferOperation,
  item: TransferableLocalClipboardText,
) {
  const source = createLocalTextTransferChunkSource(item)
  if (source.byteSize !== operation.manifest.byteSize) {
    throw new Error('La fuente de texto ya no coincide con el manifest')
  }

  const blob = await openTransferChunkSource(source)
  for (const descriptor of operation.manifest.chunks) {
    const start = descriptor.index * operation.manifest.chunkSize
    const end = start + descriptor.byteLength
    const bytes = await blob.slice(start, end).arrayBuffer()
    if (!(await verifyTransferChunk(operation.manifest, descriptor.index, bytes))) {
      throw new Error('Falló la integridad del texto antes del envío Directo')
    }
  }
}

export async function executeLocalDirectTextTransfer(
  roomId: string,
  operation: PreparedSenderTransferOperation,
  selection: TransferRouteSelection,
  dependencies: Partial<LocalDirectTextAdapterDependencies> = {},
): Promise<LocalDirectTextTransferResult> {
  const deps = { ...defaultDependencies, ...dependencies }
  const startedAt = deps.now()
  const sourceRef = operation.sourceRef
  if (typeof roomId !== 'string' || roomId.length === 0) throw new Error('Sala inválida')
  if (!Number.isSafeInteger(startedAt) || startedAt <= 0) throw new Error('Reloj inválido')
  if (!selectionMatchesOperation(selection, operation)) {
    throw new Error('La selección de ruta no coincide con la operación preparada')
  }
  if (
    operation.manifest.contentKind !== 'text'
    || sourceRef?.provider !== 'local-text'
    || !validTransferJournal(operation.journal, operation.manifest)
    || operation.journal.role !== 'sender'
    || operation.journal.status !== 'prepared'
  ) {
    throw new Error('La operación no es un envío local de texto preparado')
  }
  if (!(await verifyTransferManifest(operation.manifest))) {
    throw new Error('Manifest de transferencia inválido')
  }

  const item = await deps.loadTextItem(sourceRef, startedAt)
  if (!item || item.id !== sourceRef.itemId || item.expiresAt <= startedAt) {
    throw new Error('El texto local ya no está disponible')
  }

  await verifyTextSourceIntegrity(operation, item)
  await deps.sendText(roomId, operation.manifest.receiverDeviceId, item)

  let journal = operation.journal
  for (const descriptor of operation.manifest.chunks) {
    journal = markTransferChunkCompleted(journal, operation.manifest, descriptor.index, deps.now())
  }
  journal = completeTransferJournal(journal, operation.manifest, deps.now())
  await deps.deleteState(operation.manifest.transferId)

  return {
    selection: { ...selection },
    journal,
  }
}
