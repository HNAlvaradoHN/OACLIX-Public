import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('RealtimeSignalClient usa un envelope de control separado del payload legado', async () => {
  const source = await read('src/realtime/signalClient.ts')

  assert.match(source, /sendTransferControlMessage\(targetDeviceId: string, message: TransferControlMessage\)/)
  assert.match(source, /validTransferControlForRoute\(message, this\.readyDeviceId, targetDeviceId\)/)
  assert.match(source, /JSON\.stringify\(\{ type: 'transfer-control', targetDeviceId, message \}\)/)
  assert.match(source, /publishTransferControl\(this\.roomId, message\.message, message\.fromDeviceId\)/)
})

test('RealtimeHub valida transfer-control y conserva el relay viejo durante migración', async () => {
  const source = await read('worker/realtime/realtimeHub.ts')

  assert.match(source, /const control = parseTransferControlInput\(parsed, current\.deviceId\)/)
  assert.match(source, /type: 'transfer-control',[\s\S]*?fromDeviceId: current\.deviceId,[\s\S]*?message: control\.message/)
  assert.match(source, /const relay = parseDeviceRelayInput\(parsed, current\.deviceId\)/)
})

test('solo transfer-request puede quedar pendiente y se entrega al reconectar', async () => {
  const source = await read('worker/realtime/realtimeHub.ts')

  assert.match(source, /control\.message\.type === 'transfer-request'/)
  assert.match(source, /transferControlRequestIsLive\(control\.message, Date\.now\(\)\)/)
  assert.match(source, /await this\.queuePendingTransferRequest\(current, control\.message\)/)
  assert.match(source, /await this\.deliverPendingTransferRequests\(server, personId, deviceId\)/)
  assert.match(source, /PENDING_TRANSFER_STORAGE_KEY/)
  assert.match(source, /this\.ctx\.storage\.setAlarm\(nextExpiry\)/)
  assert.match(source, /this\.ctx\.storage\.deleteAlarm\(\)/)
})

test('resolver o desvincular limpia solicitudes pendientes con aislamiento', async () => {
  const source = await read('worker/realtime/realtimeHub.ts')

  assert.match(source, /await this\.resolvePendingTransferRequest\(current\.personId, control\.message, Date\.now\(\)\)/)
  assert.match(source, /removePendingTransferRequest\([\s\S]*?pending,[\s\S]*?personId,/)
  assert.match(source, /removePendingTransferRequestsForDevice\(pending, deviceId, now\)/)
})
