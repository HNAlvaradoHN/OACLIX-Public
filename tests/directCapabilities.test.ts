import assert from 'node:assert/strict'
import test from 'node:test'

import {
  localDirectCapabilities,
  resolveRemoteDirectCapabilities,
  validDirectCapabilities,
} from '../src/realtime/directCapabilities.ts'

test('advertises room core and image Direct independently', () => {
  assert.deepEqual(localDirectCapabilities(), ['room-core', 'image-direct'])
})

test('legacy peer without capability field preserves current PWA interoperability', () => {
  const resolved = resolveRemoteDirectCapabilities(undefined)
  assert.equal(resolved.has('room-core'), true)
  assert.equal(resolved.has('image-direct'), true)
})

test('image-only peer cannot be mistaken for text/general Direct', () => {
  const resolved = resolveRemoteDirectCapabilities(['image-direct'])
  assert.equal(resolved.has('image-direct'), true)
  assert.equal(resolved.has('room-core'), false)
})

test('rejects unknown, duplicate, empty, or malformed capability declarations', () => {
  assert.equal(validDirectCapabilities(['room-core', 'unknown']), false)
  assert.equal(validDirectCapabilities(['image-direct', 'image-direct']), false)
  assert.equal(validDirectCapabilities([]), false)
  assert.equal(validDirectCapabilities('image-direct'), false)
})
