import assert from 'node:assert/strict'
import test from 'node:test'
import type { LanClipboardContentChange } from '../src/realtime/lanClipboardBus.ts'
import type { LanDirectFirstPrepMeta } from '../src/realtime/lanDirectFirstPrep.ts'
import {
  deliverGeneralTextDirectlyToDevice,
  type GeneralExplicitDirectDeliveryDependencies,
} from '../src/transport/generalExplicitDirectDelivery.ts'

const roomId = 'room_abcdefghijklmnop'
const localDeviceId = 'dev_abcdefghijklmnop'
const targetDeviceId = 'dev_qrstuvwxyzabcdef'
const personId = 'per_abcdefghijklmnop'
const itemId = 'itm_abcdefghijklmnop'
const now = 1_700_000_000_000

function harness() {
  const events: string[] = []
  let sentChange: LanClipboardContentChange | null = null
  let preparedDestinations: string[] = []
  let ackCancelled = false
  let resolveAck: () => void = () => undefined
  let rejectAck: (error: Error) => void = () => undefined
  const prep: LanDirectFirstPrepMeta = {
    version: 1,
    changeId: 'chg_abcdefghijklmnopqrstuv',
    authorDeviceId: localDeviceId,
    authorSequence: 7,
    createdAt: now,
  }

  const ackPromise = new Promise<void>((resolve, reject) => {
    resolveAck = resolve
    rejectAck = reject
  })

  const dependencies: GeneralExplicitDirectDeliveryDependencies = {
    getLocalDeviceId: async () => {
      events.push('local-device')
      return localDeviceId
    },
    getPersonId: async () => {
      events.push('person')
      return personId
    },
    prepareUpsert: async (_room, _item, destinations) => {
      preparedDestinations = Array.from(destinations)
      events.push('checkpoint')
      return prep
    },
    sendToPeer: (deviceId, change) => {
      events.push(`send:${deviceId}`)
      sentChange = change
      return true
    },
    createAckWaiter: (_room, deviceId, ackPrep) => {
      events.push(`wait-ack:${deviceId}:${ackPrep.changeId}`)
      return {
        promise: ackPromise.then(() => {
          events.push('ack')
        }),
        cancel: () => {
          ackCancelled = true
          events.push('ack-cancelled')
        },
      }
    },
    now: () => now,
    createItemId: () => itemId,
  }

  return {
    dependencies,
    events,
    resolveAck,
    rejectAck,
    getSentChange: () => sentChange,
    getPreparedDestinations: () => preparedDestinations,
    wasAckCancelled: () => ackCancelled,
  }
}

test('General Directo prepara checkpoint para un único destino y confirma ACK antes de éxito', async () => {
  const state = harness()
  const delivery = deliverGeneralTextDirectlyToDevice(roomId, targetDeviceId, 'hola', state.dependencies)

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(state.getPreparedDestinations(), [targetDeviceId])
  assert.deepEqual(state.events, [
    'local-device',
    'person',
    'checkpoint',
    `wait-ack:${targetDeviceId}:chg_abcdefghijklmnopqrstuv`,
    `send:${targetDeviceId}`,
  ])

  state.resolveAck()
  const item = await delivery
  assert.equal(item.sequence, 7)
  assert.equal(item.directOnly, true)
  assert.equal(state.events.at(-1), 'ack')

  const change = state.getSentChange()
  assert.ok(change)
  assert.equal(change.type, 'upsert')
  if (change.type !== 'upsert') return
  assert.equal(change.directOnly, true)
  assert.equal(change.directFirstPrep?.authorSequence, 7)
  assert.equal(change.item.id, itemId)
  assert.equal(change.item.expiresAt, now + 21_600_000)
})

test('General Directo no envía si el checkpoint no pudo persistirse', async () => {
  const state = harness()
  state.dependencies.prepareUpsert = async () => {
    state.events.push('checkpoint-failed')
    return null
  }

  await assert.rejects(
    deliverGeneralTextDirectlyToDevice(roomId, targetDeviceId, 'hola', state.dependencies),
    /preparar/,
  )
  assert.equal(state.events.some((event) => event.startsWith('send:')), false)
  assert.equal(state.events.some((event) => event.startsWith('wait-ack:')), false)
})

test('General Directo cancela espera de ACK si la ruta cambia después del checkpoint', async () => {
  const state = harness()
  state.dependencies.sendToPeer = (deviceId) => {
    state.events.push(`send-failed:${deviceId}`)
    return false
  }

  await assert.rejects(
    deliverGeneralTextDirectlyToDevice(roomId, targetDeviceId, 'hola', state.dependencies),
    /ruta Directo cambió/,
  )
  assert.deepEqual(state.getPreparedDestinations(), [targetDeviceId])
  assert.equal(state.events.includes(`send-failed:${targetDeviceId}`), true)
  assert.equal(state.wasAckCancelled(), true)
})

test('General Directo no reporta éxito si el receptor no confirma almacenamiento', async () => {
  const state = harness()
  const delivery = deliverGeneralTextDirectlyToDevice(roomId, targetDeviceId, 'hola', state.dependencies)

  await new Promise((resolve) => setTimeout(resolve, 0))
  state.rejectAck(new Error('sin ACK'))

  await assert.rejects(delivery, /sin ACK/)
  assert.equal(state.events.includes(`send:${targetDeviceId}`), true)
  assert.equal(state.events.includes('ack'), false)
})

test('General Directo rechaza enviarse al propio dispositivo antes de crear contenido', async () => {
  const state = harness()

  await assert.rejects(
    deliverGeneralTextDirectlyToDevice(roomId, localDeviceId, 'hola', state.dependencies),
    /otro dispositivo/,
  )
  assert.deepEqual(state.events, ['local-device'])
})
