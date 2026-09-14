export type SequencedChange = { sequence: number }

function assertCursor(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
}

export function selectChangesAfterCursor<T extends SequencedChange>(changes: T[], cursor: number): T[] {
  assertCursor(cursor, 'cursor')
  return changes.filter((change) => Number.isSafeInteger(change.sequence) && change.sequence > cursor)
}

export function keepCursorMonotonic(currentCursor: number, candidateCursor: number): number {
  assertCursor(currentCursor, 'currentCursor')
  assertCursor(candidateCursor, 'candidateCursor')
  return Math.max(currentCursor, candidateCursor)
}
