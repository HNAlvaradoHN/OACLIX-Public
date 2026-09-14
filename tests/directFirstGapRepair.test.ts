import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DirectGapBuffer,
  DirectReplayLog,
  createDirectGapRequest,
  validDirectGapRequest,
} from '../src/transport/directFirstGapRepair.ts'
import type { DirectChangeEnvelope } from '../src/transport/directFirstProtocol.ts'

const author = 'dev_abcdefghijklmnop'

function change(sequence: number): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: `chg_${String(sequence).padStart(20, 'a')}`,
    authorDeviceId: author,
    authorSequence: sequence,
    itemId: 'itm_0123456789abcdef0123456789abcdef',
    operation: 'upsert',
    text: `texto-${sequence}`,
    createdAt: 1_700_000_000_000 + sequence,
  }
}

test('crea solicitud exacta para el rango faltante', () => {
  const request = createDirectGapRequest(author, 4, 8)
  assert.deepEqual(request, {
    version: 1,
    type: 'gap-request',
    authorDeviceId: author,
    afterSequence: 4,
    throughSequence: 7,
  })
  assert.equal(validDirectGapRequest(request), true)
  assert.throws(() => createDirectGapRequest(author, 4, 5), /hueco/)
})

test('replay devuelve cambios faltantes en orden sin usar cloud', () => {
  const log = new DirectReplayLog(author)
  for (let sequence = 1; sequence <= 5; sequence += 1) log.remember(change(sequence))

  const replay = log.replay(createDirectGapRequest(author, 1, 5))
  assert.deepEqual(replay?.map((entry) => entry.authorSequence), [2, 3, 4])
})

test('replay devuelve null si ya no conserva una pieza del rango', () => {
  const log = new DirectReplayLog(author, 2)
  log.remember(change(1))
  log.remember(change(2))
  log.remember(change(3))

  assert.equal(log.replay(createDirectGapRequest(author, 0, 3)), null)
})

test('replay conserva capacidad y cambios después de restaurar snapshot', () => {
  const log = new DirectReplayLog(author, 3)
  log.remember(change(1))
  log.remember(change(2))
  const restored = DirectReplayLog.restore(log.snapshot())
  restored.remember(change(3))
  restored.remember(change(4))

  assert.deepEqual(restored.snapshot().changes.map((entry) => entry.authorSequence), [2, 3, 4])
  assert.deepEqual(
    restored.replay(createDirectGapRequest(author, 1, 4))?.map((entry) => entry.authorSequence),
    [2, 3],
  )
})

test('buffer retiene cambio adelantado y lo libera cuando llega el faltante', () => {
  const buffer = new DirectGapBuffer()
  buffer.buffer(change(3))
  assert.deepEqual(buffer.takeContiguous(author, 1), [])

  buffer.buffer(change(2))
  assert.deepEqual(buffer.takeContiguous(author, 1).map((entry) => entry.authorSequence), [2, 3])
})

test('buffer restaurado mantiene cambios adelantados pendientes', () => {
  const buffer = new DirectGapBuffer(4)
  buffer.buffer(change(4))
  buffer.buffer(change(3))

  const restored = DirectGapBuffer.restore(buffer.snapshot())
  restored.buffer(change(2))
  assert.deepEqual(restored.takeContiguous(author, 1).map((entry) => entry.authorSequence), [2, 3, 4])
  assert.deepEqual(restored.snapshot().changes, [])
})

test('buffer separa autores y protege reutilización ambigua de secuencia', () => {
  const buffer = new DirectGapBuffer()
  const first = change(2)
  buffer.buffer(first)
  assert.throws(() => buffer.buffer({
    ...first,
    changeId: 'chg_zzzzzzzzzzzzzzzzzzzzzzzz',
  }), /reutilizada/)
})

test('replay rechaza solicitudes para otro autor', () => {
  const log = new DirectReplayLog(author)
  log.remember(change(1))
  log.remember(change(2))
  const otherAuthor = 'dev_qrstuvwxyzabcdef'
  const request = createDirectGapRequest(otherAuthor, 0, 2)
  assert.throws(() => log.replay(request), /otro autor/)
})
