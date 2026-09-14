import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decideGeneralExplicitDestination,
  requireGeneralExplicitDestination,
} from '../src/transport/generalExplicitDestination.ts'

const targetDeviceId = 'dev_abcdefghijklmnop'

test('General elige Directo para el destino explícito cuando la ruta está validada', () => {
  assert.deepEqual(
    decideGeneralExplicitDestination(targetDeviceId, 'direct'),
    { targetDeviceId, route: 'direct' },
  )
})

test('General elige Nube para el mismo destino cuando Directo no está disponible pero Nube sí', () => {
  assert.deepEqual(
    decideGeneralExplicitDestination(targetDeviceId, 'cloud'),
    { targetDeviceId, route: 'cloud' },
  )
})

test('General no convierte offline/checking en fallback ni broadcast implícito', () => {
  assert.deepEqual(
    decideGeneralExplicitDestination(targetDeviceId, 'offline'),
    { targetDeviceId, route: null, reason: 'offline' },
  )
  assert.deepEqual(
    decideGeneralExplicitDestination(targetDeviceId, 'checking'),
    { targetDeviceId, route: null, reason: 'checking' },
  )
})

test('General exige un único deviceId explícito antes de crear un plan enviable', () => {
  assert.throws(
    () => decideGeneralExplicitDestination('person_or_room', 'direct'),
    /Destino de General inválido/,
  )
  assert.throws(
    () => requireGeneralExplicitDestination(decideGeneralExplicitDestination(targetDeviceId, 'offline')),
    /offline/,
  )
})
