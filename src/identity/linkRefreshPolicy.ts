export const LINK_REFRESH_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000, 60_000] as const

export function nextLinkRefreshDelayMs(attempt: number, now: number, expiresAt: number) {
  const remaining = expiresAt - now
  if (!Number.isFinite(remaining) || remaining <= 0) return null

  const normalizedAttempt = Number.isSafeInteger(attempt) && attempt >= 0 ? attempt : 0
  const delay = LINK_REFRESH_DELAYS_MS[Math.min(normalizedAttempt, LINK_REFRESH_DELAYS_MS.length - 1)]
  return Math.min(delay, remaining)
}

export function shouldQueryLinkedDevices(visibilityState: DocumentVisibilityState, now: number, expiresAt: number) {
  return visibilityState === 'visible' && Number.isFinite(now) && Number.isFinite(expiresAt) && now < expiresAt
}

export function hasNewLinkedDevice(baselineCount: number, currentCount: number) {
  if (!Number.isSafeInteger(baselineCount) || baselineCount < 0) return false
  if (!Number.isSafeInteger(currentCount) || currentCount < 0) return false
  return currentCount > baselineCount
}
