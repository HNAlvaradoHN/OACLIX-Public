export const HEARTBEAT_INITIAL_IDLE_MS = 15_000
export const HEARTBEAT_STABLE_IDLE_MS = 60_000
export const HEARTBEAT_RESPONSE_TIMEOUT_MS = 4_000

export type HeartbeatPhase = 'warming' | 'stable'

export function heartbeatIdleDelay(phase: HeartbeatPhase) {
  return phase === 'stable' ? HEARTBEAT_STABLE_IDLE_MS : HEARTBEAT_INITIAL_IDLE_MS
}

export function heartbeatDailyRequestEquivalent(deviceCount: number, idleMs = HEARTBEAT_STABLE_IDLE_MS) {
  if (!Number.isFinite(deviceCount) || deviceCount <= 0 || !Number.isFinite(idleMs) || idleMs <= 0) return 0
  const incomingMessagesPerDay = deviceCount * (86_400_000 / idleMs)
  return incomingMessagesPerDay / 20
}
