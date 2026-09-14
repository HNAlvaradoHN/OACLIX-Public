import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyRealtimeSignal,
  nextAcceptedRealtimeNegotiation,
  shouldScheduleRealtimeReconnect,
} from '../src/realtime/realtimeNegotiationPolicy.ts'

const session = 'session_current_1234'
const oldSession = 'session_old_5678'
const negotiation = { sessionId: session, negotiationId: 'aaaaaaaaaaaaaaaaaaaaaaaa', generation: 7 }

test('rechaza señal perteneciente a una sesión realtime vieja', () => {
  assert.equal(classifyRealtimeSignal(session, oldSession, negotiation, negotiation.negotiationId, 8), 'stale-session')
})

test('rechaza generación vieja dentro de la sesión vigente', () => {
  assert.equal(classifyRealtimeSignal(session, session, negotiation, negotiation.negotiationId, 6), 'older-generation')
})

test('rechaza negociación distinta reutilizando la misma generación', () => {
  assert.equal(classifyRealtimeSignal(session, session, negotiation, 'bbbbbbbbbbbbbbbbbbbbbbbb', 7), 'conflicting-generation')
})

test('acepta la misma negociación y una generación nueva', () => {
  assert.equal(classifyRealtimeSignal(session, session, negotiation, negotiation.negotiationId, 7), 'accept')
  assert.equal(classifyRealtimeSignal(session, session, negotiation, 'cccccccccccccccccccccccc', 8), 'accept')
})

test('una sesión nueva reinicia la negociación aceptada', () => {
  const nextSession = 'session_new_9999'
  const next = nextAcceptedRealtimeNegotiation(nextSession, negotiation, 'dddddddddddddddddddddddd', 1)
  assert.deepEqual(next, {
    sessionId: nextSession,
    negotiationId: 'dddddddddddddddddddddddd',
    generation: 1,
  })
})

test('solo programa reconexión cuando sigue activo, visible y sin timer pendiente', () => {
  assert.equal(shouldScheduleRealtimeReconnect({ started: true, visible: true, reconnectPending: false }), true)
  assert.equal(shouldScheduleRealtimeReconnect({ started: false, visible: true, reconnectPending: false }), false)
  assert.equal(shouldScheduleRealtimeReconnect({ started: true, visible: false, reconnectPending: false }), false)
  assert.equal(shouldScheduleRealtimeReconnect({ started: true, visible: true, reconnectPending: true }), false)
})
