import type { LocalImageClipboardSnapshot } from '../data/localImageClipboard.ts'
import {
  createLocalImageTransferChunkSource,
  loadLocalImageTransferItem,
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

type LoadImageItem = (
  reference: TransferSourceReference,
  now: number,
) => Promise<LocalImageClipboardSnapshot | null>

type SendImage = (
  roomId: string,
  receiverDeviceId: string,
  item: LocalImageClipboardSnapshot,
) => Promise<void>

export type LocalDirectImageAdapterDependencies = {
  loadImageItem: LoadImageItem
  sendImage: SendImage
  deleteState(transferId: string): Promise<void>
  now(): number
}

export type LocalDirectImageTransferResult = {
  selection: TransferRouteSelection
  journal: TransferJournal
}

async function sendImageViaExistingDirectTransport(
  roomId: string,
  receiverDeviceId: string,
  item: LocalImageClipboardSnapshot,
) {
  const { sendLocalImageDirect } = await import('../transport/localImageDirectTransport.ts')
  return sendLocalImageDirect(roomId, receiverDeviceId, item)
}

const defaultDependencies: LocalDirectImageAdapterDependencies = {
  loadImageItem: loadLocalImageTransferItem,
  sendImage: sendImageViaExistingDirectTransport,
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

async function verifyImageSourceIntegrity(
  operation: PreparedSenderTransferOperation,
  item: LocalImageClipboardSnapshot,
) {
  if (item.blob.size !== item.byteSize || item.blob.type !== item.mimeType) {
    throw new Error('La fuente de imagen local ya no es válida')
  }

  const source = createLocalImageTransferChunkSource(item)
  if (source.byteSize !== operation.manifest.byteSize) {
    throw new Error('La fuente de imagen ya no coincide con el manifest')
  }

  const blob = await openTransferChunkSource(source)
  for (const descriptor of operation.manifest.chunks) {
    const start = descriptor.index * operation.manifest.chunkSize
    const end = start + descriptor.byteLength
    const bytes = await blob.slice(start, end).arrayBuffer()
    if (!(await verifyTransferChunk(operation.manifest, descriptor.index, bytes))) {
      throw new Error('Falló la integridad de la imagen antes del envío Directo')
    }
  }
}

export async function executeLocalDirectImageTransfer(
  roomId: string,
  operation: PreparedSenderTransferOperation,
  selection: TransferRouteSelection,
  dependencies: Partial<LocalDirectImageAdapterDependencies> = {},
): Promise<LocalDirectImageTransferResult> {
  const deps = { ...defaultDependencies, ...dependencies }
  const startedAt = deps.now()
  const sourceRef = operation.sourceRef
  if (typeof roomId !== 'string' || roomId.length === 0) throw new Error('Sala inválida')
  if (!Number.isSafeInteger(startedAt) || startedAt <= 0) throw new Error('Reloj inválido')
  if (!selectionMatchesOperation(selection, operation)) {
    throw new Error('La selección de ruta no coincide con la operación preparada')
  }
  if (
    operation.manifest.contentKind !== 'image'
    || sourceRef?.provider !== 'local-image'
    || !validTransferJournal(operation.journal, operation.manifest)
    || operation.journal.role !== 'sender'
    || operation.journal.status !== 'prepared'
  ) {
    throw new Error('La operación no es un envío local de imagen preparado')
  }
  if (!(await verifyTransferManifest(operation.manifest))) {
    throw new Error('Manifest de transferencia inválido')
  }

  const item = await deps.loadImageItem(sourceRef, startedAt)
  if (!item || item.id !== sourceRef.itemId || item.expiresAt <= startedAt) {
    throw new Error('La imagen local ya no está disponible')
  }

  await verifyImageSourceIntegrity(operation, item)
  await deps.sendImage(roomId, operation.manifest.receiverDeviceId, item)

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
