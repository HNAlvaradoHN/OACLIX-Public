import { nextDirectLogicalClock } from './directFirstConflict.ts'
import {
  createDirectGapRequest,
  DirectGapBuffer,
  DirectReplayLog,
  type DirectGapRequest,
} from './directFirstGapRepair.ts'
import {
  DirectApplyLedger,
  DirectDeliveryTracker,
  validDirectChangeEnvelope,
  type DirectAck,
  type DirectChangeEnvelope,
  type DirectDeliveryTrackerSnapshot,
  type DirectSequenceDecision,
} from './directFirstProtocol.ts'
import type { DirectFirstPersistentState } from './directFirstPersistentState.ts'
import {
  canCompactDirectTombstone,
  directTombstoneRetainUntil,
  validDirectOnlyExpiration,
} from './directFirstTombstonePolicy.ts'

export type DirectFirstPrepStateStore = {
  read(roomId: string, localDeviceId: string): Promise<DirectFirstPersistentState | null>
  write(snapshot: DirectFirstPersistentState): Promise<void>
}

export type DirectFirstIncomingResult = {
  decision: DirectSequenceDecision
  /** Todo cambio que quedó contiguo/durable; se usa para ACK exacto. */
  committed: DirectChangeEnvelope[]
  /** Subconjunto que puede aplicarse al producto sin resucitar un item borrado. */
  productCommitted: DirectChangeEnvelope[]
}

export type DirectFirstBaselineApplyResult = {
  accepted: boolean
  committed: DirectChangeEnvelope[]
  productCommitted: DirectChangeEnvelope[]
}

export type DirectFirstPendingCloudFallback = {
  change: DirectChangeEnvelope
  pendingDeviceIds: string[]
}

export type DirectFirstDeleteFallbackSeed = {
  text: string
  createdAt: number
  expiresAt: number
}

const DIRECT_REPAIR_CHUNK_SIZE = 256
const DIRECT_ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/

/**
 * Coordinador persistente de direct-first.
 *
 * No envía DataChannel ni llama D1/R2. Mantiene el estado durable de entrega,
 * replay, gaps, tombstones y progreso cloud que consume el transporte productivo.
 */
export class DirectFirstPrepCoordinator {
  private readonly roomId: string
  private readonly localDeviceId: string
  private readonly store: DirectFirstPrepStateStore
  private logicalClock: number
  private readonly ledger: DirectApplyLedger
  private readonly deliveries = new Map<string, DirectDeliveryTracker>()
  private readonly replayLogs = new Map<string, DirectReplayLog>()
  private readonly cloudFallbackSeeds = new Map<string, {
    itemId: string
    text: string
    createdAt?: number
    expiresAt?: number
  }>()
  private readonly cloudKnownItemIds = new Set<string>()
  /**
   * Nombre conservado por compatibilidad del checkpoint. Incluye cambios cuya
   * reconciliación cloud ya terminó, incluso si terminaron por expiración sin
   * crear una copia de contenido.
   */
  private readonly cloudCommittedChangeIds = new Set<string>()
  /** Checkpoints antiguos no tenían fecha; nunca inventamos una frontera para podarlos. */
  private readonly legacyDeletedItemIds = new Set<string>()
  /** Tombstones nuevos sí llevan la frontera segura demostrada por política. */
  private readonly tombstoneRetainUntilByItem = new Map<string, number>()
  private readonly gapBuffer: DirectGapBuffer

  private constructor(
    roomId: string,
    localDeviceId: string,
    store: DirectFirstPrepStateStore,
    snapshot: DirectFirstPersistentState | null,
  ) {
    this.roomId = roomId
    this.localDeviceId = localDeviceId
    this.store = store
    this.logicalClock = snapshot?.logicalClock ?? 0
    this.ledger = snapshot ? DirectApplyLedger.restore(snapshot.ledger) : new DirectApplyLedger()
    this.gapBuffer = snapshot ? DirectGapBuffer.restore(snapshot.gapBuffer) : new DirectGapBuffer()

    for (const delivery of snapshot?.deliveries ?? []) {
      this.deliveries.set(delivery.change.changeId, DirectDeliveryTracker.restore(delivery))
    }
    for (const replay of snapshot?.replayLogs ?? []) {
      this.replayLogs.set(replay.authorDeviceId, DirectReplayLog.restore(replay))
    }
    for (const seed of snapshot?.cloudFallbackSeeds ?? []) {
      this.cloudFallbackSeeds.set(seed.changeId, {
        itemId: seed.itemId,
        text: seed.text,
        ...(seed.createdAt !== undefined ? { createdAt: seed.createdAt } : {}),
        ...(seed.expiresAt !== undefined ? { expiresAt: seed.expiresAt } : {}),
      })
    }
    for (const itemId of snapshot?.cloudKnownItemIds ?? []) this.cloudKnownItemIds.add(itemId)
    for (const changeId of snapshot?.cloudCommittedChangeIds ?? []) this.cloudCommittedChangeIds.add(changeId)
    for (const tombstone of snapshot?.tombstones ?? []) {
      this.tombstoneRetainUntilByItem.set(tombstone.itemId, tombstone.retainUntil)
    }
    for (const itemId of snapshot?.deletedItemIds ?? []) {
      if (!this.tombstoneRetainUntilByItem.has(itemId)) this.legacyDeletedItemIds.add(itemId)
    }

    // Un checkpoint cargado ya fue durable. Las entregas completas pueden salir
    // de memoria inmediatamente; replay y tombstones viven en estructuras aparte.
    this.compactCompletedDeliveries()
  }

  static async load(roomId: string, localDeviceId: string, store: DirectFirstPrepStateStore) {
    const snapshot = await store.read(roomId, localDeviceId)
    if (snapshot && (snapshot.roomId !== roomId || snapshot.localDeviceId !== localDeviceId)) {
      throw new Error('Checkpoint direct-first pertenece a otra sala o dispositivo')
    }
    return new DirectFirstPrepCoordinator(roomId, localDeviceId, store, snapshot)
  }

  advanceLogicalClock(observedRemoteClock = 0) {
    this.logicalClock = nextDirectLogicalClock(this.logicalClock, observedRemoteClock)
    return this.logicalClock
  }

  currentLogicalClock() {
    return this.logicalClock
  }

  rememberOutbound(
    change: DirectChangeEnvelope,
    destinationDeviceIds: Iterable<string>,
    options: { deleteFallbackSeed?: DirectFirstDeleteFallbackSeed; cloudCommitted?: boolean } = {},
  ) {
    if (!validDirectChangeEnvelope(change)) throw new Error('Cambio directo inválido')
    if (change.authorDeviceId !== this.localDeviceId) throw new Error('Cambio saliente pertenece a otro autor')
    if (this.deliveries.has(change.changeId)) return false
    if (change.operation === 'upsert' && this.itemDeleted(change.itemId)) {
      throw new Error('Un item eliminado no puede reutilizarse')
    }

    const tracker = new DirectDeliveryTracker(change, destinationDeviceIds)
    this.deliveries.set(change.changeId, tracker)
    this.replayLogFor(change.authorDeviceId).remember(change)

    if (change.operation === 'delete') {
      this.rememberTombstone(change.itemId, change.createdAt)
      if (options.deleteFallbackSeed !== undefined) {
        const seed = options.deleteFallbackSeed
        if (seed.text.length === 0) throw new Error('Semilla de fallback vacía')
        if (!validDirectOnlyExpiration(seed.createdAt, seed.expiresAt)) {
          throw new Error('Semilla de fallback con expiración inválida')
        }
        this.cloudFallbackSeeds.set(change.changeId, {
          itemId: change.itemId,
          text: seed.text,
          createdAt: seed.createdAt,
          expiresAt: seed.expiresAt,
        })
      }
    }

    if (options.cloudCommitted) {
      this.cloudKnownItemIds.add(change.itemId)
      this.cloudCommittedChangeIds.add(change.changeId)
      this.cloudFallbackSeeds.delete(change.changeId)
    }
    return true
  }

  acknowledge(changeId: string, destinationDeviceId: string, ack: DirectAck) {
    const delivery = this.deliveries.get(changeId)
    if (!delivery) return false
    const accepted = delivery.acknowledge(destinationDeviceId, ack)
    if (accepted && delivery.isComplete()) this.cloudFallbackSeeds.delete(changeId)
    return accepted
  }

  cloudFallbackSeed(changeId: string, itemId: string) {
    const seed = this.cloudFallbackSeeds.get(changeId)
    if (!seed || seed.itemId !== itemId) return undefined
    if (seed.createdAt !== undefined && seed.expiresAt !== undefined) {
      return { text: seed.text, createdAt: seed.createdAt, expiresAt: seed.expiresAt }
    }

    // Compatibilidad con checkpoint legacy: solo completamos metadata si el
    // replay durable conserva el upsert exacto que originó esa misma semilla.
    const recovered = this.fallbackSeedForItem(itemId)
    return recovered?.text === seed.text ? recovered : { text: seed.text }
  }

  fallbackSeedForItem(itemId: string): DirectFirstDeleteFallbackSeed | undefined {
    let latest: DirectChangeEnvelope | null = null
    for (const replay of this.replayLogs.values()) {
      for (const change of replay.snapshot().changes) {
        if (
          change.itemId !== itemId
          || change.operation !== 'upsert'
          || change.directOnly !== true
          || typeof change.text !== 'string'
          || change.expiresAt === undefined
        ) continue
        if (!validDirectOnlyExpiration(change.createdAt, change.expiresAt)) continue
        if (!latest || change.createdAt > latest.createdAt) latest = change
      }
    }
    if (!latest || latest.expiresAt === undefined || typeof latest.text !== 'string') return undefined
    return {
      text: latest.text,
      createdAt: latest.createdAt,
      expiresAt: latest.expiresAt,
    }
  }

  releaseCloudFallbackSeed(changeId: string) {
    return this.cloudFallbackSeeds.delete(changeId)
  }

  cloudItemKnown(itemId: string) {
    return this.cloudKnownItemIds.has(itemId)
  }

  cloudChangeCommitted(changeId: string) {
    return this.cloudCommittedChangeIds.has(changeId)
  }

  markCloudItemKnown(itemId: string) {
    this.cloudKnownItemIds.add(itemId)
  }

  markCloudChangeCommitted(changeId: string) {
    const delivery = this.deliveries.get(changeId)
    if (!delivery) throw new Error('Cambio cloud no pertenece al checkpoint saliente')
    this.cloudKnownItemIds.add(delivery.change.itemId)
    this.cloudCommittedChangeIds.add(changeId)
    this.cloudFallbackSeeds.delete(changeId)
  }

  markCloudChangeExpired(changeId: string) {
    const delivery = this.deliveries.get(changeId)
    if (!delivery) throw new Error('Cambio vencido no pertenece al checkpoint saliente')
    const itemId = delivery.change.itemId
    this.cloudCommittedChangeIds.add(changeId)
    this.cloudFallbackSeeds.delete(changeId)

    // Si un delete vence sin copia cloud, cualquier upsert anterior del mismo
    // item también quedó fuera de la ventana de retención. Lo marcamos terminal
    // para que nunca pueda reaparecer después de compactar el tombstone.
    if (delivery.change.operation === 'delete') {
      for (const [otherChangeId, otherDelivery] of this.deliveries) {
        if (
          otherDelivery.change.operation === 'upsert'
          && otherDelivery.change.itemId === itemId
          && otherDelivery.change.directOnly === true
        ) {
          this.cloudCommittedChangeIds.add(otherChangeId)
        }
      }
    }
  }

  /**
   * Todo delete observado en cloud se refleja también en el estado direct-first.
   * Así un replay directo antiguo se confirma para continuidad, pero no vuelve a
   * publicarse al producto después de que el cursor cloud ya eliminó el item.
   *
   * En el dispositivo autor, cualquier delivery de upsert direct-only del mismo
   * item deja de ser trabajo pendiente: cloud ya contiene la transición de delete.
   */
  observeCloudDeletedItems(itemIds: Iterable<string>, observedAt: number) {
    const deletedItemIds = new Set(itemIds)
    for (const itemId of deletedItemIds) {
      if (!DIRECT_ITEM_ID_PATTERN.test(itemId)) throw new Error('itemId cloud inválido')
      this.rememberTombstone(itemId, observedAt)
    }

    let terminalizedUpserts = 0
    for (const [changeId, delivery] of this.deliveries) {
      if (
        delivery.change.operation !== 'upsert'
        || delivery.change.directOnly !== true
        || !deletedItemIds.has(delivery.change.itemId)
      ) continue
      this.deliveries.delete(changeId)
      this.cloudCommittedChangeIds.delete(changeId)
      this.cloudFallbackSeeds.delete(changeId)
      terminalizedUpserts += 1
    }
    return terminalizedUpserts
  }

  pendingCloudFallbackChanges(directDeviceIds: Iterable<string>): DirectFirstPendingCloudFallback[] {
    const direct = new Set(directDeviceIds)
    const pending: DirectFirstPendingCloudFallback[] = []

    for (const delivery of this.deliveries.values()) {
      if (this.cloudCommittedChangeIds.has(delivery.change.changeId)) continue
      if (delivery.change.operation === 'upsert' && this.itemDeleted(delivery.change.itemId)) continue
      const missingDirect = delivery.pendingDeviceIds().filter((deviceId) => !direct.has(deviceId))
      if (missingDirect.length === 0) continue
      pending.push({ change: delivery.change, pendingDeviceIds: missingDirect })
    }

    return pending.sort((left, right) => left.change.authorSequence - right.change.authorSequence)
  }

  receive(change: DirectChangeEnvelope): DirectFirstIncomingResult {
    if (!validDirectChangeEnvelope(change)) throw new Error('Cambio directo inválido')
    if (change.authorDeviceId === this.localDeviceId) throw new Error('Cambio entrante no puede pertenecer al dispositivo local')

    const decision = this.ledger.inspect(change)
    if (decision === 'gap') {
      this.gapBuffer.buffer(change)
      return { decision, committed: [], productCommitted: [] }
    }
    if (decision === 'duplicate' || decision === 'stale') {
      return { decision, committed: [], productCommitted: [] }
    }

    const committed: DirectChangeEnvelope[] = []
    const productCommitted: DirectChangeEnvelope[] = []
    this.commitIncoming(change, committed, productCommitted)
    const buffered = this.gapBuffer.takeContiguous(change.authorDeviceId, this.ledger.lastApplied(change.authorDeviceId))
    for (const next of buffered) this.commitIncoming(next, committed, productCommitted)
    return { decision, committed, productCommitted }
  }

  receiveBaseline(authorDeviceId: string, throughSequence: number): DirectFirstBaselineApplyResult {
    if (authorDeviceId === this.localDeviceId) throw new Error('Baseline no puede pertenecer al dispositivo local')
    const request = this.pendingGapRequest(authorDeviceId)
    if (!request || request.afterSequence !== 0 || request.throughSequence !== throughSequence) {
      return { accepted: false, committed: [], productCommitted: [] }
    }
    if (!this.ledger.establishBaseline(authorDeviceId, throughSequence)) {
      return { accepted: false, committed: [], productCommitted: [] }
    }

    const committed: DirectChangeEnvelope[] = []
    const productCommitted: DirectChangeEnvelope[] = []
    const buffered = this.gapBuffer.takeContiguous(authorDeviceId, throughSequence)
    for (const next of buffered) this.commitIncoming(next, committed, productCommitted)
    return { accepted: true, committed, productCommitted }
  }

  replay(request: DirectGapRequest) {
    const replay = this.replayLogs.get(request.authorDeviceId)
    return replay ? replay.replay(request) : null
  }

  pendingGapRequest(authorDeviceId: string) {
    const lastApplied = this.ledger.lastApplied(authorDeviceId)
    const observedSequence = this.gapBuffer.snapshot().changes
      .filter((change) => change.authorDeviceId === authorDeviceId && change.authorSequence > lastApplied + 1)
      .reduce<number | null>((lowest, change) => (
        lowest == null || change.authorSequence < lowest ? change.authorSequence : lowest
      ), null)

    if (observedSequence == null) return null
    // Un ledger vacío no necesita descargar historia anterior: puede establecer
    // un baseline justo antes del primer cambio observado. Esto permite que un
    // dispositivo recién vinculado empiece a recibir cambios futuros sin subir
    // silenciosamente a nube el contenido direct-only previo a su vínculo.
    const requestedObservedSequence = lastApplied === 0
      ? observedSequence
      : Math.min(observedSequence, lastApplied + DIRECT_REPAIR_CHUNK_SIZE + 1)
    return createDirectGapRequest(authorDeviceId, lastApplied, requestedObservedSequence)
  }

  pendingChangeIds() {
    return Array.from(this.deliveries.values())
      .filter((delivery) => !delivery.isComplete())
      .map((delivery) => delivery.change.changeId)
  }

  deliverySnapshot(changeId: string): DirectDeliveryTrackerSnapshot | null {
    return this.deliveries.get(changeId)?.snapshot() ?? null
  }

  pendingDirectOnlyForDestination(destinationDeviceId: string) {
    return Array.from(this.deliveries.values())
      .filter((delivery) => (
        delivery.change.directOnly === true
        && delivery.statusFor(destinationDeviceId) === 'pending'
        && !this.cloudCommittedChangeIds.has(delivery.change.changeId)
        && !(delivery.change.operation === 'upsert' && this.itemDeleted(delivery.change.itemId))
      ))
      .map((delivery) => delivery.change)
      .sort((left, right) => left.authorSequence - right.authorSequence)
  }

  compactCompletedDeliveries() {
    let removed = 0
    for (const [changeId, delivery] of this.deliveries) {
      if (!delivery.isComplete()) continue
      this.deliveries.delete(changeId)
      this.cloudCommittedChangeIds.delete(changeId)
      this.cloudFallbackSeeds.delete(changeId)
      removed += 1
    }
    return removed
  }

  compactTombstones(now = Date.now()) {
    let removed = 0
    for (const [itemId, retainUntil] of this.tombstoneRetainUntilByItem) {
      if (!canCompactDirectTombstone(retainUntil, now)) continue
      const hasPendingUpsert = Array.from(this.deliveries.values()).some((delivery) => (
        delivery.change.operation === 'upsert'
        && delivery.change.itemId === itemId
        && !delivery.isComplete()
        && !this.cloudCommittedChangeIds.has(delivery.change.changeId)
      ))
      if (hasPendingUpsert) continue
      this.tombstoneRetainUntilByItem.delete(itemId)
      removed += 1
    }
    return removed
  }

  snapshot(savedAt = Date.now()): DirectFirstPersistentState {
    this.compactTombstones(savedAt)
    const activeDeletedItemIds = new Set(this.legacyDeletedItemIds)
    for (const itemId of this.tombstoneRetainUntilByItem.keys()) activeDeletedItemIds.add(itemId)

    return {
      version: 1,
      roomId: this.roomId,
      localDeviceId: this.localDeviceId,
      logicalClock: this.logicalClock,
      ledger: this.ledger.snapshot(),
      deliveries: Array.from(this.deliveries.values()).map((delivery) => delivery.snapshot()),
      replayLogs: Array.from(this.replayLogs.values()).map((replay) => replay.snapshot()),
      gapBuffer: this.gapBuffer.snapshot(),
      cloudFallbackSeeds: Array.from(this.cloudFallbackSeeds.entries()).map(([changeId, seed]) => ({
        changeId,
        itemId: seed.itemId,
        text: seed.text,
        ...(seed.createdAt !== undefined ? { createdAt: seed.createdAt } : {}),
        ...(seed.expiresAt !== undefined ? { expiresAt: seed.expiresAt } : {}),
      })),
      cloudKnownItemIds: Array.from(this.cloudKnownItemIds).sort(),
      cloudCommittedChangeIds: Array.from(this.cloudCommittedChangeIds).sort(),
      deletedItemIds: Array.from(activeDeletedItemIds).sort(),
      tombstones: Array.from(this.tombstoneRetainUntilByItem.entries())
        .map(([itemId, retainUntil]) => ({ itemId, retainUntil }))
        .sort((left, right) => left.itemId.localeCompare(right.itemId)),
      savedAt,
    }
  }

  persist(savedAt = Date.now()) {
    return this.store.write(this.snapshot(savedAt))
  }

  private itemDeleted(itemId: string) {
    return this.legacyDeletedItemIds.has(itemId) || this.tombstoneRetainUntilByItem.has(itemId)
  }

  private rememberTombstone(itemId: string, deleteCreatedAt: number) {
    if (this.legacyDeletedItemIds.has(itemId)) return
    const retainUntil = directTombstoneRetainUntil(deleteCreatedAt)
    const current = this.tombstoneRetainUntilByItem.get(itemId) ?? 0
    if (retainUntil > current) this.tombstoneRetainUntilByItem.set(itemId, retainUntil)
  }

  private replayLogFor(authorDeviceId: string) {
    let replay = this.replayLogs.get(authorDeviceId)
    if (!replay) {
      replay = new DirectReplayLog(authorDeviceId)
      this.replayLogs.set(authorDeviceId, replay)
    }
    return replay
  }

  private commitIncoming(
    change: DirectChangeEnvelope,
    committed: DirectChangeEnvelope[],
    productCommitted: DirectChangeEnvelope[],
  ) {
    if (!this.ledger.commit(change)) return
    this.replayLogFor(change.authorDeviceId).remember(change)
    committed.push(change)

    if (change.operation === 'delete') {
      this.rememberTombstone(change.itemId, change.createdAt)
      productCommitted.push(change)
      return
    }
    if (!this.itemDeleted(change.itemId)) productCommitted.push(change)
  }
}
