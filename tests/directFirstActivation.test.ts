import assert from 'node:assert/strict'
import test from 'node:test'
import { selectAllDirectDestinations } from '../src/transport/directFirstActivation.ts'

const local = 'dev_abcdefghijklmnop'
const tablet = 'dev_qrstuvwxyzabcdef'
const pc = 'dev_1234567890abcdef'

test('activa direct-first solo cuando todos los dispositivos remotos vinculados están directos', () => {
  assert.deepEqual(
    selectAllDirectDestinations(local, [local, tablet], [tablet]),
    [tablet],
  )

  assert.equal(
    selectAllDirectDestinations(local, [local, tablet, pc], [tablet]),
    null,
  )

  assert.equal(
    selectAllDirectDestinations(local, [local, tablet], []),
    null,
  )
})

test('rechaza peers directos que no pertenecen al roster vinculado actual', () => {
  assert.equal(
    selectAllDirectDestinations(local, [local, tablet], [tablet, pc]),
    null,
  )
})
