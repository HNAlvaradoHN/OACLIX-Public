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
  const prep: LanDirectFirstPrepMeta = {
    version: 1,
    changeId: 'chg_abcdefghijklmnopqrstuv',
    authorDeviceId: localDeviceId,
    authorSequence: 7,
    createdAt: now,
  }

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
    now: () => now,
    createItemId: () => itemId,
  }

  return {
    dependencies,
    events,
    getSentChange: () => sentChange,
    getPreparedDestinations: () => preparedDestinations,
  }
}

test('General Directo prepara checkpoint para un único destino antes de enviar', async () => {
  const state = harness()
  const item = await deliverGeneralTextDirectlyToDevice(roomId, targetDeviceId, 'hola', state.dependencies)

  assert.deepEqual(state.getPreparedDestinations(), [targetDeviceId])
  assert.deepEqual(state.events, ['local-device', 'person', 'checkpoint', `send:${targetDeviceId}`])
  assert.equal(item.sequence, 7)
  assert.equal(item.directOnly, true)

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
})

test('General Directo falla si la ruta cambia después del checkpoint sin hacer broadcast', async () => {
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
})

test('General Directo rechaza enviarse al propio dispositivo antes de crear contenido', async () => {
  const state = harness()

  await assert.rejects(
    deliverGeneralTextDirectlyToDevice(roomId, localDeviceId, 'hola', state.dependencies),
    /otro dispositivo/,
  )
  assert.deepEqual(state.events, ['local-device'])
})
