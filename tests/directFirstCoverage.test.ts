import assert from 'node:assert/strict'
import test from 'node:test'
import { decideDirectFirstCoverage } from '../src/transport/directFirstCoverage.ts'

const a = 'dev_abcdefghijklmnop'
const b = 'dev_qrstuvwxyzabcdef'
const c = 'dev_1234567890abcdef'

test('all-direct no necesita copia cloud aunque exista nube', () => {
  const decision = decideDirectFirstCoverage({
    requiredDeviceIds: [a, b],
    directDeviceIds: [a, b],
    cloudAvailable: true,
    cloudFallbackAllowed: true,
  })

  assert.equal(decision.mode, 'all-direct')
  assert.deepEqual(decision.directDeviceIds, [a, b])
  assert.deepEqual(decision.cloudDeviceIds, [])
  assert.deepEqual(decision.missingDeviceIds, [])
})

test('mixed usa nube solo para los destinos sin directo', () => {
  const decision = decideDirectFirstCoverage({
    requiredDeviceIds: [a, b, c],
    directDeviceIds: [a, b],
    cloudAvailable: true,
    cloudFallbackAllowed: true,
  })

  assert.equal(decision.mode, 'mixed')
  assert.deepEqual(decision.directDeviceIds, [a, b])
  assert.deepEqual(decision.cloudDeviceIds, [c])
})

test('cloud-only cubre todos los destinos cuando no hay directo', () => {
  const decision = decideDirectFirstCoverage({
    requiredDeviceIds: [a, b],
    directDeviceIds: [],
    cloudAvailable: true,
    cloudFallbackAllowed: true,
  })

  assert.equal(decision.mode, 'cloud-only')
  assert.deepEqual(decision.cloudDeviceIds, [a, b])
})

test('archivo sin fallback cloud queda unavailable si falta un directo', () => {
  const decision = decideDirectFirstCoverage({
    requiredDeviceIds: [a, b],
    directDeviceIds: [a],
    cloudAvailable: true,
    cloudFallbackAllowed: false,
  })

  assert.equal(decision.mode, 'unavailable')
  assert.deepEqual(decision.directDeviceIds, [a])
  assert.deepEqual(decision.missingDeviceIds, [b])
})

test('aparición de tercer destino impide conservar una decisión all-direct vieja', () => {
  const before = decideDirectFirstCoverage({
    requiredDeviceIds: [a, b],
    directDeviceIds: [a, b],
    cloudAvailable: true,
    cloudFallbackAllowed: true,
  })
  const after = decideDirectFirstCoverage({
    requiredDeviceIds: [a, b, c],
    directDeviceIds: [a, b],
    cloudAvailable: true,
    cloudFallbackAllowed: true,
  })

  assert.equal(before.mode, 'all-direct')
  assert.equal(after.mode, 'mixed')
  assert.deepEqual(after.cloudDeviceIds, [c])
})

test('deduplica destinos requeridos antes de decidir cobertura', () => {
  const decision = decideDirectFirstCoverage({
    requiredDeviceIds: [a, a, b],
    directDeviceIds: [a, b],
    cloudAvailable: false,
    cloudFallbackAllowed: false,
  })

  assert.equal(decision.mode, 'all-direct')
  assert.deepEqual(decision.requiredDeviceIds, [a, b])
})
