import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyDirectSequence } from '../src/transport/directCursorPolicy.ts'

test('accepts only the next contiguous sequence', () => {
  assert.equal(classifyDirectSequence(0, 1), 'contiguous')
  assert.equal(classifyDirectSequence(41, 42), 'contiguous')
})

test('treats current and older sequences as stale', () => {
  assert.equal(classifyDirectSequence(42, 42), 'stale')
  assert.equal(classifyDirectSequence(42, 1), 'stale')
})

test('treats future holes as gaps', () => {
  assert.equal(classifyDirectSequence(0, 2), 'gap')
  assert.equal(classifyDirectSequence(42, 44), 'gap')
})

test('fails closed for invalid cursor or sequence values', () => {
  assert.equal(classifyDirectSequence(-1, 1), 'gap')
  assert.equal(classifyDirectSequence(Number.NaN, 1), 'gap')
  assert.equal(classifyDirectSequence(0, 0), 'gap')
  assert.equal(classifyDirectSequence(0, -1), 'gap')
  assert.equal(classifyDirectSequence(0, Number.NaN), 'gap')
  assert.equal(classifyDirectSequence(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1), 'gap')
})
