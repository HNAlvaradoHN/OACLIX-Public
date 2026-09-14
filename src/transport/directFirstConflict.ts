import type { DirectOperation } from './directFirstProtocol'

export type DirectItemRevision = {
  logicalClock: number
  authorDeviceId: string
  changeId: string
  operation: DirectOperation
}

export type DirectConflictDecision = 'incoming' | 'current' | 'same'

const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const CHANGE_ID_PATTERN = /^chg_[A-Za-z0-9_-]{20,96}$/

function assertRevision(revision: DirectItemRevision) {
  if (!Number.isSafeInteger(revision.logicalClock) || revision.logicalClock <= 0) {
    throw new Error('Reloj lógico inválido')
  }
  if (!DEVICE_ID_PATTERN.test(revision.authorDeviceId)) throw new Error('Autor inválido')
  if (!CHANGE_ID_PATTERN.test(revision.changeId)) throw new Error('changeId inválido')
  if (revision.operation !== 'upsert' && revision.operation !== 'delete') throw new Error('Operación inválida')
}

function compareText(left: string, right: string) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * Orden total determinista, independiente del reloj de pared.
 *
 * 1. Un reloj lógico mayor gana.
 * 2. Si dos cambios concurrentes tienen el mismo reloj, delete gana sobre upsert.
 * 3. Si la operación también empata, authorDeviceId y changeId rompen el empate.
 *
 * La prioridad de delete en empate evita que un upsert concurrente con el mismo
 * reloj lógico pueda resucitar un item que otro dispositivo eliminó.
 */
export function compareDirectItemRevisions(current: DirectItemRevision, incoming: DirectItemRevision) {
  assertRevision(current)
  assertRevision(incoming)

  if (current.changeId === incoming.changeId) return 0
  if (current.logicalClock !== incoming.logicalClock) {
    return current.logicalClock < incoming.logicalClock ? -1 : 1
  }

  if (current.operation !== incoming.operation) {
    return current.operation === 'delete' ? 1 : -1
  }

  const authorOrder = compareText(current.authorDeviceId, incoming.authorDeviceId)
  if (authorOrder !== 0) return authorOrder
  return compareText(current.changeId, incoming.changeId)
}

export function chooseDirectItemRevision(
  current: DirectItemRevision | null,
  incoming: DirectItemRevision,
): DirectConflictDecision {
  assertRevision(incoming)
  if (!current) return 'incoming'

  const comparison = compareDirectItemRevisions(current, incoming)
  if (comparison === 0) return 'same'
  return comparison < 0 ? 'incoming' : 'current'
}

/**
 * Lamport-style local advance. A sender increments its local logical clock before
 * creating a change. When observing a remote change, it advances beyond both its
 * own clock and the remote clock. This does not depend on Date.now().
 */
export function nextDirectLogicalClock(localClock: number, observedRemoteClock = 0) {
  if (!Number.isSafeInteger(localClock) || localClock < 0) throw new Error('Reloj local inválido')
  if (!Number.isSafeInteger(observedRemoteClock) || observedRemoteClock < 0) {
    throw new Error('Reloj remoto inválido')
  }
  const next = Math.max(localClock, observedRemoteClock) + 1
  if (!Number.isSafeInteger(next)) throw new Error('Reloj lógico agotado')
  return next
}
