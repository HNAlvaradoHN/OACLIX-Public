import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HEARTBEAT_INITIAL_IDLE_MS,
  HEARTBEAT_RESPONSE_TIMEOUT_MS,
  HEARTBEAT_STABLE_IDLE_MS,
  heartbeatDailyRequestEquivalent,
  heartbeatIdleDelay,
} from '../src/realtime/heartbeatPolicy.ts'

test('heartbeat uses a short warm-up probe and a sparse stable watchdog', () => {
  assert.equal(heartbeatIdleDelay('warming'), HEARTBEAT_INITIAL_IDLE_MS)
  assert.equal(heartbeatIdleDelay('stable'), HEARTBEAT_STABLE_IDLE_MS)
  assert.ok(HEARTBEAT_INITIAL_IDLE_MS < HEARTBEAT_STABLE_IDLE_MS)
  assert.ok(HEARTBEAT_RESPONSE_TIMEOUT_MS < HEARTBEAT_INITIAL_IDLE_MS)
})

test('stable two-device watchdog stays far below one percent of DO request allowance', () => {
  const equivalent = heartbeatDailyRequestEquivalent(2)
  assert.equal(equivalent, 144)
  assert.ok(equivalent / 100_000 < 0.002)
})

test('invalid heartbeat cost inputs do not invent usage', () => {
  assert.equal(heartbeatDailyRequestEquivalent(0), 0)
  assert.equal(heartbeatDailyRequestEquivalent(-1), 0)
  assert.equal(heartbeatDailyRequestEquivalent(2, 0), 0)
})
