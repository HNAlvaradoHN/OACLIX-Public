import assert from 'node:assert/strict'
import test from 'node:test'
import { linkRealtimeResetTargets, selectLinkDestination } from '../worker/data/deviceLinkStore.ts'

test('un dispositivo independiente que genera código puede unirse a un grupo ya activo', () => {
  assert.equal(
    selectLinkDestination(
      { deviceCount: 1, sharedCount: 0 },
      { deviceCount: 2, sharedCount: 0 },
    ),
    'target',
  )
})

test('un dispositivo independiente que consume código puede unirse a un grupo ya activo', () => {
  assert.equal(
    selectLinkDestination(
      { deviceCount: 2, sharedCount: 0 },
      { deviceCount: 1, sharedCount: 0 },
    ),
    'source',
  )
})

test('dos dispositivos independientes conservan el grupo del que generó el código', () => {
  assert.equal(
    selectLinkDestination(
      { deviceCount: 1, sharedCount: 0 },
      { deviceCount: 1, sharedCount: 0 },
    ),
    'source',
  )
})

test('dos grupos ya activos no se fusionan silenciosamente', () => {
  assert.equal(
    selectLinkDestination(
      { deviceCount: 2, sharedCount: 0 },
      { deviceCount: 2, sharedCount: 0 },
    ),
    null,
  )

  assert.equal(
    selectLinkDestination(
      { deviceCount: 1, sharedCount: 1 },
      { deviceCount: 2, sharedCount: 0 },
    ),
    null,
  )
})


test('vincular reinicia las sesiones realtime previas de ambos dispositivos', () => {
  assert.deepEqual(
    linkRealtimeResetTargets(
      { personId: 'per_source1234567890', deviceId: 'dev_source1234567890' },
      { personId: 'per_target1234567890', deviceId: 'dev_target1234567890' },
    ),
    [
      { roomId: 'gen_source1234567890', deviceId: 'dev_source1234567890' },
      { roomId: 'gen_target1234567890', deviceId: 'dev_target1234567890' },
    ],
  )
})
