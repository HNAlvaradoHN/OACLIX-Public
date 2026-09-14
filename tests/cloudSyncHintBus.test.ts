import assert from 'node:assert/strict'
import test from 'node:test'
import {
  publishCloudConnectivity,
  publishCloudSyncHint,
  subscribeCloudConnectivity,
  subscribeCloudSyncHints,
} from '../src/realtime/cloudSyncHintBus.ts'

test('cloud sync hints notify active subscribers and stop after unsubscribe', () => {
  const roomId = `room_hint_${Date.now()}`
  let calls = 0
  const unsubscribe = subscribeCloudSyncHints(roomId, () => { calls += 1 })

  publishCloudSyncHint(roomId)
  assert.equal(calls, 1)

  unsubscribe()
  publishCloudSyncHint(roomId)
  assert.equal(calls, 1)
})

test('cloud connectivity replays current state and suppresses duplicate publications', () => {
  const roomId = `room_connectivity_${Date.now()}`
  const observed: string[] = []
  const unsubscribe = subscribeCloudConnectivity(roomId, (status) => observed.push(status))

  assert.deepEqual(observed, ['checking'])
  publishCloudConnectivity(roomId, 'offline')
  publishCloudConnectivity(roomId, 'offline')
  publishCloudConnectivity(roomId, 'checking')
  publishCloudConnectivity(roomId, 'online')

  assert.deepEqual(observed, ['checking', 'offline', 'checking', 'online'])
  unsubscribe()
})

test('a later connectivity subscriber receives the latest stable bus value immediately', () => {
  const roomId = `room_replay_${Date.now()}`
  publishCloudConnectivity(roomId, 'online')

  const observed: string[] = []
  const unsubscribe = subscribeCloudConnectivity(roomId, (status) => observed.push(status))
  assert.deepEqual(observed, ['online'])
  unsubscribe()
})
