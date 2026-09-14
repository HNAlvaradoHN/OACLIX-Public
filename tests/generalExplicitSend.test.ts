import assert from 'node:assert/strict'
import test from 'node:test'
import type { DeviceRouteStatus } from '../src/realtime/lanStatus.ts'
import {
  sendGeneralTextExplicitly,
  type GeneralExplicitSendDependencies,
} from '../src/transport/generalExplicitSend.ts'

const roomId = 'room_abcdefghijklmnop'
const targetDeviceId = 'dev_abcdefghijklmnop'

function harness(routeStatus: DeviceRouteStatus) {
  const calls: string[] = []
  const dependencies: GeneralExplicitSendDependencies = {
    getRouteStatus: (room, deviceId) => {
      calls.push(`route:${room}:${deviceId}`)
      return routeStatus
    },
    requireAuthorizedTarget: async (room, deviceId) => {
      calls.push(`authorize:${room}:${deviceId}`)
    },
    sendDirect: async (room, deviceId, text) => {
      calls.push(`direct:${room}:${deviceId}:${text}`)
    },
    sendCloud: async (room, deviceId, text) => {
      calls.push(`cloud:${room}:${deviceId}:${text}`)
    },
  }
  return { calls, dependencies }
}

test('General explícito autoriza y entrega únicamente por Directo al destino elegido', async () => {
  const { calls, dependencies } = harness('direct')
  const result = await sendGeneralTextExplicitly(roomId, targetDeviceId, 'hola', dependencies)

  assert.deepEqual(result, { targetDeviceId, route: 'direct', textLength: 4 })
  assert.deepEqual(calls, [
    `authorize:${roomId}:${targetDeviceId}`,
    `route:${roomId}:${targetDeviceId}`,
    `direct:${roomId}:${targetDeviceId}:hola`,
  ])
})

test('General explícito usa Nube solo cuando esa es la ruta del destino elegido', async () => {
  const { calls, dependencies } = harness('cloud')
  const result = await sendGeneralTextExplicitly(roomId, targetDeviceId, 'hola', dependencies)

  assert.deepEqual(result, { targetDeviceId, route: 'cloud', textLength: 4 })
  assert.equal(calls.filter((call) => call.startsWith('cloud:')).length, 1)
  assert.equal(calls.filter((call) => call.startsWith('direct:')).length, 0)
})

test('General explícito no hace fallback cuando el destino está offline', async () => {
  const { calls, dependencies } = harness('offline')

  await assert.rejects(
    sendGeneralTextExplicitly(roomId, targetDeviceId, 'hola', dependencies),
    /offline/,
  )
  assert.equal(calls.filter((call) => call.startsWith('direct:') || call.startsWith('cloud:')).length, 0)
})

test('General explícito no intenta ruta si el destino no está autorizado', async () => {
  const { calls, dependencies } = harness('direct')
  dependencies.requireAuthorizedTarget = async () => {
    calls.push('authorize:rejected')
    throw new Error('Destino no autorizado')
  }

  await assert.rejects(
    sendGeneralTextExplicitly(roomId, targetDeviceId, 'hola', dependencies),
    /no autorizado/,
  )
  assert.deepEqual(calls, ['authorize:rejected'])
})

test('General explícito rechaza texto vacío o mayor de 8.000 antes de tocar transporte', async () => {
  const { calls, dependencies } = harness('direct')

  await assert.rejects(sendGeneralTextExplicitly(roomId, targetDeviceId, '   ', dependencies), /inválido/)
  await assert.rejects(sendGeneralTextExplicitly(roomId, targetDeviceId, 'x'.repeat(8_001), dependencies), /inválido/)
  assert.deepEqual(calls, [])
})
