import assert from 'node:assert/strict'
import test from 'node:test'
import { DirectFirstCloudCopyGate } from '../src/transport/directFirstCloudCopyGate.ts'
import { decideDirectFirstCoverage } from '../src/transport/directFirstCoverage.ts'

const a = 'dev_abcdefghijklmnop'
const b = 'dev_qrstuvwxyzabcdef'
const c = 'dev_ghijklmnopqrstuv'

function coverage(directDeviceIds: string[], cloudAvailable = true, cloudFallbackAllowed = true) {
  return decideDirectFirstCoverage({
    requiredDeviceIds: [a, b, c],
    directDeviceIds,
    cloudAvailable,
    cloudFallbackAllowed,
  })
}

test('all-direct demuestra cero escrituras de contenido cloud', async () => {
  const gate = new DirectFirstCloudCopyGate()
  let writes = 0

  const created = await gate.ensureRequiredCloudCopy(coverage([a, b, c]), async () => { writes += 1 })
  assert.equal(created, false)
  assert.equal(writes, 0)
  assert.equal(gate.hasCommittedCloudCopy(), false)
})

test('mixed crea una sola copia cloud aunque cubra varios destinos', async () => {
  const gate = new DirectFirstCloudCopyGate()
  let writes = 0
  const mixed = coverage([a])
  assert.equal(mixed.mode, 'mixed')
  assert.deepEqual(mixed.cloudDeviceIds, [b, c])

  assert.equal(await gate.ensureRequiredCloudCopy(mixed, async () => { writes += 1 }), true)
  assert.equal(await gate.ensureRequiredCloudCopy(mixed, async () => { writes += 1 }), false)
  assert.equal(writes, 1)
})

test('transición all-direct a mixed crea como máximo una copia cloud', async () => {
  const gate = new DirectFirstCloudCopyGate()
  let writes = 0
  const persist = async () => { writes += 1 }

  await gate.ensureRequiredCloudCopy(coverage([a, b, c]), persist)
  await gate.ensureRequiredCloudCopy(coverage([a, b]), persist)
  await gate.ensureRequiredCloudCopy(coverage([]), persist)
  assert.equal(writes, 1)
})

test('fallo de persistencia no marca copia como confirmada y permite reintento', async () => {
  const gate = new DirectFirstCloudCopyGate()
  let attempts = 0
  const mixed = coverage([a, b])

  await assert.rejects(
    gate.ensureRequiredCloudCopy(mixed, async () => {
      attempts += 1
      throw new Error('cloud temporalmente caído')
    }),
    /temporalmente/,
  )
  assert.equal(gate.hasCommittedCloudCopy(), false)

  await gate.ensureRequiredCloudCopy(mixed, async () => { attempts += 1 })
  assert.equal(attempts, 2)
  assert.equal(gate.hasCommittedCloudCopy(), true)
})

test('unavailable falla cerrado sin intentar persistir contenido', async () => {
  const gate = new DirectFirstCloudCopyGate()
  let writes = 0
  const unavailable = coverage([a], false, false)

  await assert.rejects(
    gate.ensureRequiredCloudCopy(unavailable, async () => { writes += 1 }),
    /incompleta/,
  )
  assert.equal(writes, 0)
})

test('snapshot evita doble persistencia después de reinicio preparatorio', async () => {
  const gate = new DirectFirstCloudCopyGate()
  let writes = 0
  const mixed = coverage([a, b])
  await gate.ensureRequiredCloudCopy(mixed, async () => { writes += 1 })

  const restored = DirectFirstCloudCopyGate.restore(gate.snapshot())
  await restored.ensureRequiredCloudCopy(mixed, async () => { writes += 1 })
  assert.equal(writes, 1)
})
