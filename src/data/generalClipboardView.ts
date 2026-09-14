import type { ClipboardTextSnapshot } from './clipboardApi'

export function selectRecentGeneralTexts(
  items: ClipboardTextSnapshot[],
  preservedIds: ReadonlySet<string>,
  now: number,
) {
  if (!Number.isFinite(now)) return []
  return items.filter((item) => item.expiresAt > now && !preservedIds.has(item.id))
}
