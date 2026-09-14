export type AcceptedRealtimeNegotiation = {
  sessionId: string
  negotiationId: string
  generation: number
}

export type RealtimeSignalDecision = 'accept' | 'stale-session' | 'older-generation' | 'conflicting-generation'

export function classifyRealtimeSignal(
  currentSessionId: string | null,
  incomingSessionId: string,
  currentNegotiation: AcceptedRealtimeNegotiation | null,
  incomingNegotiationId: string,
  incomingGeneration: number,
): RealtimeSignalDecision {
  if (!currentSessionId || currentSessionId !== incomingSessionId) return 'stale-session'
  if (!currentNegotiation || currentNegotiation.sessionId !== currentSessionId) return 'accept'
  if (incomingGeneration < currentNegotiation.generation) return 'older-generation'
  if (
    incomingGeneration === currentNegotiation.generation
    && incomingNegotiationId !== currentNegotiation.negotiationId
  ) return 'conflicting-generation'
  return 'accept'
}

export function nextAcceptedRealtimeNegotiation(
  currentSessionId: string,
  currentNegotiation: AcceptedRealtimeNegotiation | null,
  negotiationId: string,
  generation: number,
): AcceptedRealtimeNegotiation {
  if (
    !currentNegotiation
    || currentNegotiation.sessionId !== currentSessionId
    || generation > currentNegotiation.generation
  ) {
    return { sessionId: currentSessionId, negotiationId, generation }
  }
  return currentNegotiation
}

export function shouldScheduleRealtimeReconnect(input: {
  started: boolean
  visible: boolean
  reconnectPending: boolean
}) {
  return input.started && input.visible && !input.reconnectPending
}
