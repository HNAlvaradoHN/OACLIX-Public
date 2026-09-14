import type { DirectChangeEnvelope } from './directFirstProtocol'

export type DirectGapRequest = {
  version: 1
  type: 'gap-request'
  authorDeviceId: string
  afterSequence: number
  throughSequence: number
}

export type DirectReplayLogSnapshot = {
  version: 1
  authorDeviceId: string
  maxEntries: number
  changes: DirectChangeEnvelope[]
}

export type DirectGapBufferSnapshot = {
  version: 1
  maxBufferedPerAuthor: number
  changes: DirectChangeEnvelope[]
}

const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const CHANGE_ID_PATTERN = /^chg_[A-Za-z0-9_-]{20,96}$/
const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/

function assertSequence(value: number, label: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${label} inválida`)
}

function validReplayChange(value: unknown): value is DirectChangeEnvelope {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<DirectChangeEnvelope>
  if (input.version !== 1) return false
  if (typeof input.changeId !== 'string' || !CHANGE_ID_PATTERN.test(input.changeId)) return false
  if (typeof input.authorDeviceId !== 'string' || !DEVICE_ID_PATTERN.test(input.authorDeviceId)) return false
  if (!Number.isSafeInteger(input.authorSequence) || (input.authorSequence ?? 0) <= 0) return false
  if (typeof input.itemId !== 'string' || !ITEM_ID_PATTERN.test(input.itemId)) return false
  if (input.operation !== 'upsert' && input.operation !== 'delete') return false
  if (!Number.isSafeInteger(input.createdAt) || (input.createdAt ?? 0) <= 0) return false
  if (input.operation === 'upsert') return typeof input.text === 'string'
  return input.text === undefined
}

export function createDirectGapRequest(
  authorDeviceId: string,
  lastAppliedSequence: number,
  observedSequence: number,
): DirectGapRequest {
  if (!DEVICE_ID_PATTERN.test(authorDeviceId)) throw new Error('Autor inválido')
  assertSequence(lastAppliedSequence, 'Secuencia aplicada', true)
  assertSequence(observedSequence, 'Secuencia observada')
  if (observedSequence <= lastAppliedSequence + 1) throw new Error('No existe hueco que reparar')

  return {
    version: 1,
    type: 'gap-request',
    authorDeviceId,
    afterSequence: lastAppliedSequence,
    throughSequence: observedSequence - 1,
  }
}

export function validDirectGapRequest(value: unknown): value is DirectGapRequest {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<DirectGapRequest>
  if (input.version !== 1 || input.type !== 'gap-request') return false
  if (typeof input.authorDeviceId !== 'string' || !DEVICE_ID_PATTERN.test(input.authorDeviceId)) return false
  if (!Number.isSafeInteger(input.afterSequence) || (input.afterSequence ?? -1) < 0) return false
  if (!Number.isSafeInteger(input.throughSequence) || (input.throughSequence ?? 0) <= 0) return false
  return (input.throughSequence ?? 0) > (input.afterSequence ?? 0)
}

export class DirectReplayLog {
  private readonly changesBySequence = new Map<number, DirectChangeEnvelope>()
  private readonly authorDeviceId: string
  private readonly maxEntries: number

  constructor(authorDeviceId: string, maxEntries = 256) {
    if (!DEVICE_ID_PATTERN.test(authorDeviceId)) throw new Error('Autor inválido')
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new Error('Capacidad inválida')
    this.authorDeviceId = authorDeviceId
    this.maxEntries = maxEntries
  }

  static restore(snapshot: DirectReplayLogSnapshot) {
    if (snapshot.version !== 1) throw new Error('Versión de replay no compatible')
    const log = new DirectReplayLog(snapshot.authorDeviceId, snapshot.maxEntries)
    for (const change of snapshot.changes) log.remember(change)
    return log
  }

  remember(change: DirectChangeEnvelope) {
    if (!validReplayChange(change)) throw new Error('Cambio directo inválido')
    if (change.authorDeviceId !== this.authorDeviceId) throw new Error('Cambio pertenece a otro autor')

    const existing = this.changesBySequence.get(change.authorSequence)
    if (existing && existing.changeId !== change.changeId) {
      throw new Error('Secuencia de autor reutilizada con otro changeId')
    }
    this.changesBySequence.set(change.authorSequence, change)

    if (this.changesBySequence.size > this.maxEntries) {
      const ordered = Array.from(this.changesBySequence.keys()).sort((a, b) => a - b)
      while (ordered.length > this.maxEntries) {
        const oldest = ordered.shift()
        if (oldest != null) this.changesBySequence.delete(oldest)
      }
    }
  }

  replay(request: DirectGapRequest) {
    if (!validDirectGapRequest(request)) throw new Error('Solicitud de gap inválida')
    if (request.authorDeviceId !== this.authorDeviceId) throw new Error('Solicitud pertenece a otro autor')

    const changes: DirectChangeEnvelope[] = []
    for (let sequence = request.afterSequence + 1; sequence <= request.throughSequence; sequence += 1) {
      const change = this.changesBySequence.get(sequence)
      if (!change) return null
      changes.push(change)
    }
    return changes
  }

  snapshot(): DirectReplayLogSnapshot {
    return {
      version: 1,
      authorDeviceId: this.authorDeviceId,
      maxEntries: this.maxEntries,
      changes: Array.from(this.changesBySequence.values()).sort((a, b) => a.authorSequence - b.authorSequence),
    }
  }
}

export class DirectGapBuffer {
  private readonly bufferedByAuthor = new Map<string, Map<number, DirectChangeEnvelope>>()
  private readonly maxBufferedPerAuthor: number

  constructor(maxBufferedPerAuthor = 64) {
    if (!Number.isSafeInteger(maxBufferedPerAuthor) || maxBufferedPerAuthor <= 0) throw new Error('Capacidad inválida')
    this.maxBufferedPerAuthor = maxBufferedPerAuthor
  }

  static restore(snapshot: DirectGapBufferSnapshot) {
    if (snapshot.version !== 1) throw new Error('Versión de buffer no compatible')
    const buffer = new DirectGapBuffer(snapshot.maxBufferedPerAuthor)
    for (const change of snapshot.changes) buffer.buffer(change)
    return buffer
  }

  buffer(change: DirectChangeEnvelope) {
    if (!validReplayChange(change)) throw new Error('Cambio directo inválido')
    let buffered = this.bufferedByAuthor.get(change.authorDeviceId)
    if (!buffered) {
      buffered = new Map()
      this.bufferedByAuthor.set(change.authorDeviceId, buffered)
    }

    const existing = buffered.get(change.authorSequence)
    if (existing && existing.changeId !== change.changeId) {
      throw new Error('Secuencia bufferizada reutilizada con otro changeId')
    }
    buffered.set(change.authorSequence, change)
    if (buffered.size > this.maxBufferedPerAuthor) throw new Error('Buffer de gap excedido')
  }

  takeContiguous(authorDeviceId: string, lastAppliedSequence: number) {
    if (!DEVICE_ID_PATTERN.test(authorDeviceId)) throw new Error('Autor inválido')
    assertSequence(lastAppliedSequence, 'Secuencia aplicada', true)

    const buffered = this.bufferedByAuthor.get(authorDeviceId)
    if (!buffered) return []

    const ready: DirectChangeEnvelope[] = []
    let nextSequence = lastAppliedSequence + 1
    while (true) {
      const change = buffered.get(nextSequence)
      if (!change) break
      buffered.delete(nextSequence)
      ready.push(change)
      nextSequence += 1
    }
    if (buffered.size === 0) this.bufferedByAuthor.delete(authorDeviceId)
    return ready
  }

  snapshot(): DirectGapBufferSnapshot {
    const changes = Array.from(this.bufferedByAuthor.values())
      .flatMap((buffered) => Array.from(buffered.values()))
      .sort((a, b) => a.authorDeviceId.localeCompare(b.authorDeviceId) || a.authorSequence - b.authorSequence)
    return {
      version: 1,
      maxBufferedPerAuthor: this.maxBufferedPerAuthor,
      changes,
    }
  }
}
