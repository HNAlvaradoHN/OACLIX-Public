export type DirectCursorDecision = 'contiguous' | 'stale' | 'gap'

export function classifyDirectSequence(cursor: number, sequence: number): DirectCursorDecision {
  if (!Number.isSafeInteger(cursor) || cursor < 0) return 'gap'
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return 'gap'
  if (sequence <= cursor) return 'stale'
  if (sequence === cursor + 1) return 'contiguous'
  return 'gap'
}
