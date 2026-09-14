import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DirectApplyLedger,
  DirectDeliveryTracker,
  ackMatchesChange,
  classifyAuthorSequence,
  createDirectAck,
  validDirectChangeEnvelope,
  type DirectChangeEnvelope,
} from '../src/transport/directFirstProtocol.ts'

const baseChange: DirectChangeEnvelope = {
  version: 1,
  changeId: 'chg_abcdefghijklmnopqrstuvwx',
  authorDeviceId: 'dev_abcdefghijklmnop',
  authorSequence: 1,
  itemId: 'itm_0123456789abcdef0123456789abcdef',
  operation: 'upsert',
  text: 'hola',
  createdAt: 1_700_000_000_000,
}

const remoteA = 'dev_qrstuvwxyzabcdef'
const remoteB = 'dev_1234567890abcdef'

test('clasifica secuencia siguiente, duplicada, obsoleta y con hueco', () => {
  assert.equal(classifyAuthorSequence(0, 1), 'next')
  assert.equal(classifyAuthorSequence(4, 4), 'duplicate')
  assert.equal(classifyAuthorSequence(4, 3), 'stale')
  assert.equal(classifyAuthorSequence(4, 6), 'gap')
})

test('ledger hace idempotente el mismo changeId', () => {
  const ledger = new DirectApplyLedger()
  assert.equal(ledger.commit(baseChange), true)
  assert.equal(ledger.inspect(baseChange), 'duplicate')
  assert.equal(ledger.commit(baseChange), false)
  assert.equal(ledger.lastApplied(baseChange.authorDeviceId), 1)
})

test('ledger rechaza huecos y acepta el siguiente cambio del autor', () => {
  const ledger = new DirectApplyLedger()
  ledger.commit(baseChange)

  const gap = { ...baseChange, changeId: 'chg_gapabcdefghijklmnopqrstu', authorSequence: 3 }
  assert.equal(ledger.inspect(gap), 'gap')
  assert.throws(() => ledger.commit(gap), /hueco/)

  const next = { ...baseChange, changeId: 'chg_nextabcdefghijklmnopqrst', authorSequence: 2 }
  assert.equal(ledger.commit(next), true)
  assert.equal(ledger.lastApplied(baseChange.authorDeviceId), 2)
})

test('ACK identifica exactamente el cambio aplicado', () => {
  const ack = createDirectAck(baseChange)
  assert.deepEqual(ack, {
    version: 1,
    type: 'ack',
    changeId: baseChange.changeId,
    authorDeviceId: baseChange.authorDeviceId,
    authorSequence: 1,
  })
  assert.equal(ackMatchesChange(baseChange, ack), true)
  assert.equal(ackMatchesChange(baseChange, { ...ack, authorSequence: 2 }), false)
})

test('tracker no considera entregado hasta recibir ACK exacto', () => {
  const tracker = new DirectDeliveryTracker(baseChange, [remoteA])
  const ack = createDirectAck(baseChange)

  assert.equal(tracker.isComplete(), false)
  assert.equal(tracker.statusFor(remoteA), 'pending')
  assert.equal(tracker.acknowledge(remoteA, { ...ack, changeId: 'chg_zzzzzzzzzzzzzzzzzzzzzzzz' }), false)
  assert.equal(tracker.statusFor(remoteA), 'pending')
  assert.equal(tracker.acknowledge(remoteA, ack), true)
  assert.equal(tracker.statusFor(remoteA), 'delivered')
  assert.equal(tracker.isComplete(), true)
})

test('ACK perdido permite reenvío sin duplicar aplicación', () => {
  const receiverLedger = new DirectApplyLedger()
  const tracker = new DirectDeliveryTracker(baseChange, [remoteA])

  assert.equal(receiverLedger.commit(baseChange), true)
  assert.equal(tracker.statusFor(remoteA), 'pending')

  // El primer ACK se pierde. El emisor reenvía exactamente el mismo changeId.
  assert.equal(receiverLedger.commit(baseChange), false)
  assert.equal(receiverLedger.lastApplied(baseChange.authorDeviceId), 1)

  const repeatedAck = createDirectAck(baseChange)
  assert.equal(tracker.acknowledge(remoteA, repeatedAck), true)
  assert.equal(tracker.isComplete(), true)
})

test('emisor que cierra después de send conserva destinos pendientes al restaurar', () => {
  const tracker = new DirectDeliveryTracker(baseChange, [remoteA, remoteB])
  const ack = createDirectAck(baseChange)
  assert.equal(tracker.acknowledge(remoteA, ack), true)

  const persistedSnapshot = tracker.snapshot()
  const restored = DirectDeliveryTracker.restore(persistedSnapshot)

  assert.equal(restored.statusFor(remoteA), 'delivered')
  assert.equal(restored.statusFor(remoteB), 'pending')
  assert.deepEqual(restored.pendingDeviceIds(), [remoteB])
  assert.equal(restored.isComplete(), false)
  assert.equal(restored.acknowledge(remoteB, ack), true)
  assert.equal(restored.isComplete(), true)
})

test('restore de entrega rechaza checkpoints ambiguos o corruptos', () => {
  const tracker = new DirectDeliveryTracker(baseChange, [remoteA])
  const snapshot = tracker.snapshot()

  assert.throws(() => DirectDeliveryTracker.restore({
    ...snapshot,
    pendingDeviceIds: [remoteA],
    deliveredDeviceIds: [remoteA],
  }), /duplicados/)

  assert.throws(() => DirectDeliveryTracker.restore({
    ...snapshot,
    pendingDeviceIds: ['dev_corto'],
  }), /Destino/)
})

test('receptor que aplicó y cerró antes de ACK restaura idempotencia', () => {
  const persistedLedger = new DirectApplyLedger()
  assert.equal(persistedLedger.commit(baseChange), true)
  const persistedSnapshot = persistedLedger.snapshot()

  const restoredLedger = DirectApplyLedger.restore(persistedSnapshot)
  assert.equal(restoredLedger.inspect(baseChange), 'duplicate')
  assert.equal(restoredLedger.commit(baseChange), false)
  assert.equal(restoredLedger.lastApplied(baseChange.authorDeviceId), 1)
  assert.deepEqual(restoredLedger.snapshot(), persistedSnapshot)
})

test('restore rechaza checkpoints corruptos', () => {
  assert.throws(() => DirectApplyLedger.restore({
    version: 1,
    appliedChangeIds: ['mal'],
    lastSequenceByAuthor: [],
  }), /changeId/)

  assert.throws(() => DirectApplyLedger.restore({
    version: 1,
    appliedChangeIds: [],
    lastSequenceByAuthor: [['dev_abcdefghijklmnop', -1]],
  }), /secuencia/)
})

test('entrega multidestino conserva pendientes individuales', () => {
  const tracker = new DirectDeliveryTracker(baseChange, [remoteA, remoteB])
  const ack = createDirectAck(baseChange)

  assert.equal(tracker.acknowledge(remoteA, ack), true)
  assert.equal(tracker.isComplete(), false)
  assert.deepEqual(tracker.pendingDeviceIds(), [remoteB])
  assert.equal(tracker.statusFor(remoteA), 'delivered')
  assert.equal(tracker.statusFor(remoteB), 'pending')

  assert.equal(tracker.acknowledge(remoteB, ack), true)
  assert.equal(tracker.isComplete(), true)
})

test('tracker rechaza autor como destino y no acepta ACK de destino desconocido', () => {
  assert.throws(() => new DirectDeliveryTracker(baseChange, []), /destino/)
  assert.throws(() => new DirectDeliveryTracker(baseChange, [baseChange.authorDeviceId]), /autor/)

  const tracker = new DirectDeliveryTracker(baseChange, [remoteA])
  assert.equal(tracker.acknowledge(remoteB, createDirectAck(baseChange)), false)
  assert.equal(tracker.isComplete(), false)
})

test('valida forma mínima y evita contenido en delete', () => {
  assert.equal(validDirectChangeEnvelope(baseChange), true)
  assert.equal(validDirectChangeEnvelope({ ...baseChange, operation: 'delete', text: undefined }), true)
  assert.equal(validDirectChangeEnvelope({ ...baseChange, operation: 'delete', text: 'no debe viajar' }), false)
  assert.equal(validDirectChangeEnvelope({ ...baseChange, authorSequence: 0 }), false)
})
