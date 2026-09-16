import {
  subscribeTransferRouteIntent,
  type TransferRouteIntent,
} from '../realtime/transferRouteIntent.ts'
import { buildTransferManifestFromBlob, type TransferManifest } from './transferManifest.ts'
import { createTransferJournal, type TransferJournal } from './transferJournal.ts'
import {
  openTransferChunkSource,
  type TransferChunkSource,
  type TransferSourceReference,
} from './transferChunkSource.ts'
import { saveTransferOperationState } from './transferStateStore.ts'

const ROUTE_INTENT_CLOCK_SKEW_MS = 60_000

export type PersistTransferOperation = (
  manifest: TransferManifest,
  journal: TransferJournal,
  now: number,
  sourceRef: TransferSourceReference | null,
) => Promise<unknown>

export type PreparedSenderTransferOperation = {
  intent: TransferRouteIntent
  manifest: TransferManifest
  journal: TransferJournal
  sourceRef: TransferSourceReference | null
}

export type TransferSourceResolver = (
  intent: TransferRouteIntent,
) => TransferChunkSource | null | Promise<TransferChunkSource | null>

export type TransferEngineRouteHandlers = {
  onPrepared?(operation: PreparedSenderTransferOperation): void
  onUnavailable?(intent: TransferRouteIntent): void
  onError?(intent: TransferRouteIntent, error: unknown): void
}

function validIntentClock(intent: TransferRouteIntent, now: number) {
  return Number.isSafeInteger(now)
    && now > 0
    && intent.requestExpiresAt > now
    && intent.requestCreatedAt <= now + ROUTE_INTENT_CLOCK_SKEW_MS
    && intent.decisionAt <= now + ROUTE_INTENT_CLOCK_SKEW_MS
    && intent.acceptedAt <= now + ROUTE_INTENT_CLOCK_SKEW_MS
}

export async function prepareSenderTransferOperation(
  intent: TransferRouteIntent,
  source: TransferChunkSource,
  now = Date.now(),
  persist: PersistTransferOperation = saveTransferOperationState,
): Promise<PreparedSenderTransferOperation> {
  if (!validIntentClock(intent, now)) throw new Error('Route Intent vencido o inválido')
  if (source.contentKind !== intent.contentKind || source.byteSize !== intent.byteSize) {
    throw new Error('La fuente no coincide con la solicitud aceptada')
  }

  const blob = await openTransferChunkSource(source)
  if (blob.size !== intent.byteSize) throw new Error('La fuente cambió antes de preparar la transferencia')

  const manifest = await buildTransferManifestFromBlob(blob, {
    requestId: intent.requestId,
    senderDeviceId: intent.senderDeviceId,
    receiverDeviceId: intent.receiverDeviceId,
    contentKind: intent.contentKind,
    createdAt: now,
  })
  const journal = createTransferJournal(manifest, 'sender', now)
  const sourceRef = source.reference ? { ...source.reference } : null

  await persist(manifest, journal, now, sourceRef)
  return {
    intent: { ...intent },
    manifest,
    journal,
    sourceRef,
  }
}

export function connectRouteIntentToTransferEngine(
  roomId: string,
  resolveSource: TransferSourceResolver,
  handlers: TransferEngineRouteHandlers = {},
  persist: PersistTransferOperation = saveTransferOperationState,
) {
  return subscribeTransferRouteIntent(roomId, (intent) => {
    void Promise.resolve(resolveSource(intent))
      .then((source) => {
        if (!source) {
          handlers.onUnavailable?.(intent)
          return null
        }
        return prepareSenderTransferOperation(intent, source, Date.now(), persist)
      })
      .then((operation) => {
        if (operation) handlers.onPrepared?.(operation)
      })
      .catch((error) => handlers.onError?.(intent, error))
  })
}
