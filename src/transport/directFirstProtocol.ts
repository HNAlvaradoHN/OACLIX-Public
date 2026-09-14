import { validDirectOnlyExpiration } from './directFirstTombstonePolicy.ts'

export type DirectOperation = 'upsert' | 'delete'

export type DirectChangeEnvelope = {
  version: 1
  changeId: string
  authorDeviceId: string
  authorSequence: number
  itemId: string
  operation: DirectOperation
  text?: string
  createdAt: number
  /** Solo los cambios que nacieron sin copia cloud deben reaplicarse como producto desde replay. */
  directOnly?: true
  /** Metadata suficiente para reconstruir un upsert direct-only después de gaps/reinicio. */
  authorPersonId?: string
  expiresAt?: number
}

export type DirectAck = {
  version: 1
  type: 'ack'
  changeId: string
  authorDeviceId: string
  authorSequence: number
}

export type DirectSequenceDecision = 'next' | 'duplicate' | 'gap' | 'stale'
export type DirectDeliveryStatus = 'pending' | 'delivered'

export type DirectDeliveryTrackerSnapshot = {
  version: 1
  change: DirectChangeEnvelope
  pendingDeviceIds: string[]
  deliveredDeviceIds: string[]
}

export type DirectApplyLedgerSnapshot = {
  version: 1
  appliedChangeIds: string[]
  lastSequenceByAuthor: Array<[string, number]>
}

const CHANGE_ID_PATTERN = /^chg_[A-Za-z0-9_-]{20,96}$/
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const PERSON_ID_PATTERN = /^per_[A-Za-z0-9_-]{16,64}$/
const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/

export function classifyAuthorSequence(lastApplied: number, incoming: number): DirectSequenceDecision {
  if (!Number.isSafeInteger(lastApplied) || lastApplied < 0) throw new Error('lastApplied inválido')
  if (!Number.isSafeInteger(incoming) || incoming <= 0) throw new Error('incoming inválido')
  if (incoming === lastApplied + 1) return 'next'
  if (incoming === lastApplied) return 'duplicate'
  if (incoming < lastApplied) return 'stale'
  return 'gap'
}

export function validDirectChangeEnvelope(value: unknown): value is DirectChangeEnvelope {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<DirectChangeEnvelope>
  if (input.version !== 1) return false
  if (typeof input.changeId !== 'string' || !CHANGE_ID_PATTERN.test(input.changeId)) return false
  if (typeof input.authorDeviceId !== 'string' || !DEVICE_ID_PATTERN.test(input.authorDeviceId)) return false
  if (!Number.isSafeInteger(input.authorSequence) || (input.authorSequence ?? 0) <= 0) return false
  if (typeof input.itemId !== 'string' || !ITEM_ID_PATTERN.test(input.itemId)) return false
  if (input.operation !== 'upsert' && input.operation !== 'delete') return false
  if (!Number.isSafeInteger(input.createdAt) || (input.createdAt ?? 0) <= 0) return false
  if (input.directOnly !== undefined && input.directOnly !== true) return false
  if (input.authorPersonId !== undefined && (
    typeof input.authorPersonId !== 'string' || !PERSON_ID_PATTERN.test(input.authorPersonId)
  )) return false
  if (input.expiresAt !== undefined && (
    !Number.isSafeInteger(input.expiresAt) || Number(input.expiresAt) <= Number(input.createdAt)
  )) return false

  if (input.operation === 'upsert') {
    if (typeof input.text !== 'string') return false
    // Los envelopes shadow antiguos siguen siendo válidos sin metadata de producto.
    // Todo upsert direct-only nuevo sí debe llevar ambos campos para poder replayarse a UI.
    if (input.directOnly && (!input.authorPersonId || input.expiresAt === undefined)) return false
    if (input.directOnly && !validDirectOnlyExpiration(Number(input.createdAt), input.expiresAt!)) return false
    return true
  }

  return input.text === undefined
    && input.authorPersonId === undefined
    && input.expiresAt === undefined
}

export function createDirectAck(change: DirectChangeEnvelope): DirectAck {
  return {
    version: 1,
    type: 'ack',
    changeId: change.changeId,
    authorDeviceId: change.authorDeviceId,
    authorSequence: change.authorSequence,
  }
}

export function ackMatchesChange(change: DirectChangeEnvelope, ack: DirectAck) {
  return ack.version === 1
    && ack.type === 'ack'
    && ack.changeId === change.changeId
    && ack.authorDeviceId === change.authorDeviceId
    && ack.authorSequence === change.authorSequence
}

function assertRemoteDeviceId(deviceId: string, authorDeviceId: string) {
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw new Error('Destino directo inválido')
  if (deviceId === authorDeviceId) throw new Error('El autor no puede ser un destino remoto')
}

export class DirectDeliveryTracker {
  readonly change: DirectChangeEnvelope
  private readonly pendingDestinations: Set<string>
  private readonly deliveredDestinations: Set<string>

  constructor(change: DirectChangeEnvelope, destinationDeviceIds: Iterable<string>) {
    this.change = change
    this.pendingDestinations = new Set(destinationDeviceIds)
    this.deliveredDestinations = new Set()
    if (this.pendingDestinations.size === 0) throw new Error('Se requiere al menos un destino directo')
    for (const deviceId of this.pendingDestinations) assertRemoteDeviceId(deviceId, change.authorDeviceId)
  }

  static restore(snapshot: DirectDeliveryTrackerSnapshot) {
    if (snapshot.version !== 1) throw new Error('Versión de entrega no compatible')
    if (!validDirectChangeEnvelope(snapshot.change)) throw new Error('Snapshot contiene cambio inválido')
    if (snapshot.pendingDeviceIds.length === 0 && snapshot.deliveredDeviceIds.length === 0) {
      throw new Error('Snapshot de entrega sin destinos')
    }

    const allDeviceIds = [...snapshot.pendingDeviceIds, ...snapshot.deliveredDeviceIds]
    const uniqueDeviceIds = new Set(allDeviceIds)
    if (uniqueDeviceIds.size !== allDeviceIds.length) throw new Error('Snapshot contiene destinos duplicados')
    for (const deviceId of uniqueDeviceIds) assertRemoteDeviceId(deviceId, snapshot.change.authorDeviceId)

    const tracker = new DirectDeliveryTracker(snapshot.change, uniqueDeviceIds)
    tracker.pendingDestinations.clear()
    for (const deviceId of snapshot.pendingDeviceIds) tracker.pendingDestinations.add(deviceId)
    for (const deviceId of snapshot.deliveredDeviceIds) tracker.deliveredDestinations.add(deviceId)
    return tracker
  }

  acknowledge(destinationDeviceId: string, ack: DirectAck) {
    if (!this.pendingDestinations.has(destinationDeviceId)) return false
    if (!ackMatchesChange(this.change, ack)) return false

    this.pendingDestinations.delete(destinationDeviceId)
    this.deliveredDestinations.add(destinationDeviceId)
    return true
  }

  statusFor(destinationDeviceId: string): DirectDeliveryStatus | null {
    if (this.pendingDestinations.has(destinationDeviceId)) return 'pending'
    if (this.deliveredDestinations.has(destinationDeviceId)) return 'delivered'
    return null
  }

  pendingDeviceIds() {
    return Array.from(this.pendingDestinations)
  }

  isComplete() {
    return this.pendingDestinations.size === 0
  }

  snapshot(): DirectDeliveryTrackerSnapshot {
    return {
      version: 1,
      change: this.change,
      pendingDeviceIds: Array.from(this.pendingDestinations),
      deliveredDeviceIds: Array.from(this.deliveredDestinations),
    }
  }
}

export class DirectApplyLedger {
  private readonly appliedChangeIds = new Set<string>()
  private readonly lastSequenceByAuthor = new Map<string, number>()

  static restore(snapshot: DirectApplyLedgerSnapshot) {
    if (snapshot.version !== 1) throw new Error('Versión de ledger no compatible')
    const ledger = new DirectApplyLedger()

    for (const changeId of snapshot.appliedChangeIds) {
      if (!CHANGE_ID_PATTERN.test(changeId)) throw new Error('Snapshot contiene changeId inválido')
      ledger.appliedChangeIds.add(changeId)
    }

    for (const [authorDeviceId, sequence] of snapshot.lastSequenceByAuthor) {
      if (!DEVICE_ID_PATTERN.test(authorDeviceId)) throw new Error('Snapshot contiene autor inválido')
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Snapshot contiene secuencia inválida')
      ledger.lastSequenceByAuthor.set(authorDeviceId, sequence)
    }

    return ledger
  }

  inspect(change: DirectChangeEnvelope): DirectSequenceDecision {
    if (this.appliedChangeIds.has(change.changeId)) return 'duplicate'
    return classifyAuthorSequence(this.lastSequenceByAuthor.get(change.authorDeviceId) ?? 0, change.authorSequence)
  }

  establishBaseline(authorDeviceId: string, throughSequence: number) {
    if (!DEVICE_ID_PATTERN.test(authorDeviceId)) throw new Error('Autor de baseline inválido')
    if (!Number.isSafeInteger(throughSequence) || throughSequence <= 0) {
      throw new Error('Secuencia de baseline inválida')
    }
    if ((this.lastSequenceByAuthor.get(authorDeviceId) ?? 0) !== 0) return false
    this.lastSequenceByAuthor.set(authorDeviceId, throughSequence)
    return true
  }

  commit(change: DirectChangeEnvelope) {
    const decision = this.inspect(change)
    if (decision === 'gap') throw new Error('No se puede confirmar un cambio con hueco')
    if (decision === 'stale') throw new Error('No se puede confirmar un cambio obsoleto')
    if (decision === 'duplicate') return false

    this.appliedChangeIds.add(change.changeId)
    this.lastSequenceByAuthor.set(change.authorDeviceId, change.authorSequence)
    return true
  }

  snapshot(): DirectApplyLedgerSnapshot {
    return {
      version: 1,
      appliedChangeIds: Array.from(this.appliedChangeIds),
      lastSequenceByAuthor: Array.from(this.lastSequenceByAuthor.entries()),
    }
  }

  lastApplied(authorDeviceId: string) {
    return this.lastSequenceByAuthor.get(authorDeviceId) ?? 0
  }
}
