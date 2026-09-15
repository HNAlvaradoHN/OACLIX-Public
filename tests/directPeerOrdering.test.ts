import assert from 'node:assert/strict'
import test from 'node:test'

import { localDeviceInitiatesDirect } from '../src/realtime/directPeerOrdering.ts'

test('Direct initiator ordering is stable across web and native ASCII device IDs', () => {
  const upper = 'dev_Aaaaaaaaaaaaaaaa'
  const lower = 'dev_aaaaaaaaaaaaaaaa'
  assert.equal(localDeviceInitiatesDirect(upper, lower), true)
  assert.equal(localDeviceInitiatesDirect(lower, upper), false)
  assert.equal(localDeviceInitiatesDirect(upper, upper), false)
})

test('Direct initiator ordering is complementary for distinct device IDs', () => {
  const pairs = [
    ['dev_0aaaaaaaaaaaaaaa', 'dev_Aaaaaaaaaaaaaaaa'],
    ['dev_Zaaaaaaaaaaaaaaa', 'dev_aaaaaaaaaaaaaaaa'],
    ['dev_-aaaaaaaaaaaaaaa', 'dev_0aaaaaaaaaaaaaaa'],
    ['dev__aaaaaaaaaaaaaaa', 'dev_aaaaaaaaaaaaaaaa'],
  ] as const
  for (const [left, right] of pairs) {
    assert.notEqual(
      localDeviceInitiatesDirect(left, right),
      localDeviceInitiatesDirect(right, left),
    )
  }
})
