import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('el envío local usa un destino explícito y no una difusión general', async () => {
  const [transportSource, managerSource] = await Promise.all([
    readFile(new URL('../src/transport/localClipboardDirectTransport.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/realtime/lanPeerManager.ts', import.meta.url), 'utf8'),
  ])

  assert.match(transportSource, /sender\.sendLocalClipboardTransfer\(remoteDeviceId, transfer\)/)
  assert.match(
    managerSource,
    /sendLocalClipboardTransfer\(remoteDeviceId: string, transfer: LocalClipboardTransfer\)[\s\S]*?const peer = this\.peers\.get\(remoteDeviceId\)[\s\S]*?peer\.channel\.send\(/,
  )
  assert.doesNotMatch(transportSource, /broadcastClipboardChange|cloudClipboardBoundary|createClipboardText|deleteClipboardText/)
})

test('el roster conocido se comparte entre Vinculados y Enviar para no bloquear el modo offline', async () => {
  const [transportSource, authorizationSource, linkingSource, panelSource] = await Promise.all([
    readFile(new URL('../src/transport/localClipboardDirectTransport.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/transport/linkedDeviceAuthorization.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/identity/deviceLinking.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/LocalClipboardSharePanel.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(linkingSource, /let knownLinkedDevices: LinkedDevicesSnapshot \| null = null/)
  assert.match(linkingSource, /export function getKnownLinkedDevices\(\)/)
  assert.match(
    linkingSource,
    /export async function listLinkedDevices\(options: ListLinkedDevicesOptions = \{\}\)[\s\S]*?postSigned[\s\S]*?options[\s\S]*?knownLinkedDevices = cloneLinkedDevices\(result\)/,
  )
  assert.match(authorizationSource, /const knownRoster = await knownAuthorizedShareRoster\(\)/)
  assert.match(authorizationSource, /if \(knownRoster\) return publishAuthorizedRoster\(roomId, knownRoster\)\.devices/)
  assert.match(authorizationSource, /publishKnownLinkedDeviceIds\(roomId, roster\.devices\.map/)
  assert.match(transportSource, /return loadLinkedShareDevices\(roomId\)/)
  assert.match(panelSource, /loadLocalClipboardShareDevices\(identity\.generalRoomId\)/)
})

test('la revalidación cloud tiene timeout y solo una caída de red puede reutilizar el roster conocido', async () => {
  const authorizationSource = await readFile(new URL('../src/transport/linkedDeviceAuthorization.ts', import.meta.url), 'utf8')

  assert.match(authorizationSource, /const ROSTER_REFRESH_TIMEOUT_MS = 4_000/)
  assert.match(authorizationSource, /listLinkedDevices\(\{ timeoutMs: ROSTER_REFRESH_TIMEOUT_MS \}\)/)
  assert.match(
    authorizationSource,
    /if \(getCloudConnectivityStatus\(roomId\) === 'online'\) \{[\s\S]*?roster = await refreshAuthorizedShareRoster\(\)[\s\S]*?catch \(error\) \{[\s\S]*?if \(!isNetworkUnavailable\(error\)\) throw new Error\('No se pudo verificar el dispositivo de destino'\)[\s\S]*?roster = knownRoster/,
  )
  assert.match(
    authorizationSource,
    /return error instanceof TypeError[\s\S]*?error\.message === 'La conexión tardó demasiado en responder'/,
  )
})

test('el destino exige roster autorizado y un DataChannel validado', async () => {
  const [transportSource, authorizationSource] = await Promise.all([
    readFile(new URL('../src/transport/localClipboardDirectTransport.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/transport/linkedDeviceAuthorization.ts', import.meta.url), 'utf8'),
  ])

  assert.match(
    authorizationSource,
    /!roster \|\| roster\.localDeviceId !== localDeviceId \|\| !roster\.deviceIds\.has\(remoteDeviceId\)/,
  )
  assert.match(
    transportSource,
    /!sender \|\| !sender\.getValidatedPeerIds\(\)\.includes\(remoteDeviceId\)/,
  )
})

test('el receptor persiste primero y solo después confirma el almacenamiento', async () => {
  const transportSource = await readFile(new URL('../src/transport/localClipboardDirectTransport.ts', import.meta.url), 'utf8')

  assert.match(
    transportSource,
    /storeReceivedLocalClipboardText\(transfer\.item, remoteDeviceId\)[\s\S]*?\.then\(\(stored\) => \{[\s\S]*?createLocalClipboardTransferAck\(transfer, stored \? 'stored' : 'expired'\)[\s\S]*?sendLocalClipboardTransferAck\(remoteDeviceId, ack\)/,
  )
})

test('el DataChannel valida origen y destino antes de publicar transferencia o ACK', async () => {
  const managerSource = await readFile(new URL('../src/realtime/lanPeerManager.ts', import.meta.url), 'utf8')

  assert.match(
    managerSource,
    /message\.transfer\.senderDeviceId !== remoteDeviceId[\s\S]*?message\.transfer\.receiverDeviceId !== this\.ownDeviceId[\s\S]*?publishLanLocalClipboardTransfer/,
  )
  assert.match(
    managerSource,
    /message\.ack\.senderDeviceId !== this\.ownDeviceId[\s\S]*?message\.ack\.receiverDeviceId !== remoteDeviceId[\s\S]*?publishLanLocalClipboardTransferAck/,
  )
})
