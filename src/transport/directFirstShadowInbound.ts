import type {
  LanClipboardContentChange,
} from '../realtime/lanClipboardBus'
import type { LanDirectFirstPrepAck } from '../realtime/lanDirectFirstPrep'
import type {
  LanDirectFirstBaseline,
  LanDirectFirstGapRequest,
  LanDirectFirstReplay,
} from '../realtime/lanDirectFirstRepair'
import type {
  DirectFirstBaselineApplyResult,
  DirectFirstIncomingResult,
  DirectFirstPrepCoordinator,
} from './directFirstPrepCoordinator'
import { directFirstContentExpiresAt } from './directFirstPersistentState.ts'
import { createDirectAck, type DirectChangeEnvelope } from './directFirstProtocol.ts'

export type DirectFirstInboundCoordinatorLoader = (
  roomId: string,
  localDeviceId: string,
) => Promise<DirectFirstPrepCoordinator>

export type DirectFirstShadowInboundResult = DirectFirstIncomingResult & {
  changeId: string
  authorDeviceId: string
  acks: LanDirectFirstPrepAck[]
  repairRequest: LanDirectFirstGapRequest | null
}

export type DirectFirstShadowBaselineResult = DirectFirstBaselineApplyResult & {
  authorDeviceId: string
  acks: LanDirectFirstPrepAck[]
  repairRequest: LanDirectFirstGapRequest | null
}

/**
 * Receptor persistente direct-first.
 *
 * Ledger/replay/gaps se guardan antes del ACK. Los cambios direct-only solo
 * pueden exponerse al producto desde `committed`, es decir, después de quedar
 * contiguos y durables. Los cambios cloud-shadow conservan la ruta previa.
 */
export class DirectFirstShadowInbound {
  private readonly coordinators = new Map<string, Promise<DirectFirstPrepCoordinator>>()
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly loadCoordinator: DirectFirstInboundCoordinatorLoader

  constructor(loadCoordinator: DirectFirstInboundCoordinatorLoader) {
    this.loadCoordinator = loadCoordinator
  }

  receiveUpsert(
    roomId: string,
    localDeviceId: string,
    change: LanClipboardContentChange,
    remoteDeviceId?: string,
  ): Promise<DirectFirstShadowInboundResult | null> {
    if (change.type !== 'upsert' || !change.directFirstPrep) return Promise.resolve(null)

    const metadata = change.directFirstPrep
    if (metadata.authorDeviceId !== change.item.authorDeviceId) return Promise.resolve(null)
    if (remoteDeviceId && metadata.authorDeviceId !== remoteDeviceId) return Promise.resolve(null)
    if (metadata.authorDeviceId === localDeviceId) return Promise.resolve(null)

    return this.receiveEnvelope(roomId, localDeviceId, {
      version: 1,
      changeId: metadata.changeId,
      authorDeviceId: metadata.authorDeviceId,
      authorSequence: metadata.authorSequence,
      itemId: change.item.id,
      operation: 'upsert',
      text: change.item.text,
      createdAt: metadata.createdAt,
      expiresAt: change.item.expiresAt,
      ...(change.directOnly ? {
        directOnly: true as const,
        authorPersonId: change.item.authorPersonId,
      } : {}),
    })
  }

  receiveDelete(
    roomId: string,
    localDeviceId: string,
    remoteDeviceId: string,
    change: LanClipboardContentChange,
  ): Promise<DirectFirstShadowInboundResult | null> {
    if (change.type !== 'delete' || !change.directFirstPrep) return Promise.resolve(null)

    const metadata = change.directFirstPrep
    if (metadata.authorDeviceId !== remoteDeviceId) return Promise.resolve(null)
    if (metadata.authorDeviceId === localDeviceId) return Promise.resolve(null)

    return this.receiveEnvelope(roomId, localDeviceId, {
      version: 1,
      changeId: metadata.changeId,
      authorDeviceId: metadata.authorDeviceId,
      authorSequence: metadata.authorSequence,
      itemId: change.itemId,
      operation: 'delete',
      createdAt: metadata.createdAt,
      ...(change.directOnly ? { directOnly: true as const } : {}),
    })
  }

  receiveReplay(
    roomId: string,
    localDeviceId: string,
    remoteDeviceId: string,
    replay: LanDirectFirstReplay,
  ): Promise<DirectFirstShadowInboundResult | null> {
    if (replay.change.authorDeviceId !== remoteDeviceId) return Promise.resolve(null)
    if (replay.change.authorDeviceId === localDeviceId) return Promise.resolve(null)
    return this.receiveEnvelope(
      roomId,
      localDeviceId,
      replay.change,
      replay.change.authorSequence === replay.throughSequence,
    )
  }

  receiveBaseline(
    roomId: string,
    localDeviceId: string,
    remoteDeviceId: string,
    baseline: LanDirectFirstBaseline,
  ): Promise<DirectFirstShadowBaselineResult | null> {
    if (baseline.authorDeviceId !== remoteDeviceId) return Promise.resolve(null)
    if (baseline.authorDeviceId === localDeviceId) return Promise.resolve(null)

    return this.runExclusive(async () => {
      const key = this.coordinatorKey(roomId, localDeviceId)
      const coordinator = await this.coordinator(roomId, localDeviceId)
      try {
        const result = coordinator.receiveBaseline(baseline.authorDeviceId, baseline.throughSequence)
        if (result.accepted) await coordinator.persist()
        const acks = result.committed.map((committed) => createDirectAck(committed))
        return {
          ...result,
          authorDeviceId: baseline.authorDeviceId,
          acks,
          repairRequest: coordinator.pendingGapRequest(baseline.authorDeviceId),
        }
      } catch (error) {
        this.coordinators.delete(key)
        throw error
      }
    })
  }

  pendingRepairRequest(
    roomId: string,
    localDeviceId: string,
    remoteDeviceId: string,
  ): Promise<LanDirectFirstGapRequest | null> {
    if (remoteDeviceId === localDeviceId) return Promise.resolve(null)
    return this.runExclusive(async () => {
      const coordinator = await this.coordinator(roomId, localDeviceId)
      return coordinator.pendingGapRequest(remoteDeviceId)
    })
  }

  private receiveEnvelope(
    roomId: string,
    localDeviceId: string,
    envelope: DirectChangeEnvelope,
    emitRepairRequest = true,
  ): Promise<DirectFirstShadowInboundResult> {
    return this.runExclusive(async () => {
      const key = this.coordinatorKey(roomId, localDeviceId)
      const coordinator = await this.coordinator(roomId, localDeviceId)
      try {
        const result = coordinator.receive(envelope)
        if (result.decision === 'next' || result.decision === 'gap') await coordinator.persist()

        const durableChanges = result.decision === 'duplicate'
          ? [envelope]
          : result.committed
        const acks = durableChanges.map((committed) => createDirectAck(committed))
        const repairRequest = emitRepairRequest
          ? coordinator.pendingGapRequest(envelope.authorDeviceId)
          : null
        const now = Date.now()
        const productCommitted = result.productCommitted.filter((change) => {
          if (change.operation === 'upsert' && change.text === '') return false
          const expiresAt = directFirstContentExpiresAt(change)
          return expiresAt === null || expiresAt > now
        })

        return {
          ...result,
          productCommitted,
          changeId: envelope.changeId,
          authorDeviceId: envelope.authorDeviceId,
          acks,
          repairRequest,
        }
      } catch (error) {
        this.coordinators.delete(key)
        throw error
      }
    })
  }

  private coordinatorKey(roomId: string, localDeviceId: string) {
    return `${roomId}:${localDeviceId}`
  }

  private coordinator(roomId: string, localDeviceId: string) {
    const key = this.coordinatorKey(roomId, localDeviceId)
    let coordinator = this.coordinators.get(key)
    if (!coordinator) {
      coordinator = this.loadCoordinator(roomId, localDeviceId)
      this.coordinators.set(key, coordinator)
    }
    return coordinator
  }

  private runExclusive<T>(work: () => Promise<T>) {
    const result = this.mutationQueue.then(work, work)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}
