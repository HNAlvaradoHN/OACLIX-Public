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

test('RealtimeHub valida transfer-control antes de reenviarlo y conserva el relay viejo durante migración', async () => {
  const source = await read('worker/realtime/realtimeHub.ts')

  assert.match(source, /const control = parseTransferControlInput\(parsed, current\.deviceId\)/)
  assert.match(source, /type: 'transfer-control',[\s\S]*?fromDeviceId: current\.deviceId,[\s\S]*?message: control\.message/)
  assert.match(source, /const relay = parseDeviceRelayInput\(parsed, current\.deviceId\)/)
})
