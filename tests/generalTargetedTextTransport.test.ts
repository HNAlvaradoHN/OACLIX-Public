import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourcePath = new URL('../src/transport/generalTargetedTextTransport.ts', import.meta.url)

test('General vuelve a autorizar y decide una sola ruta justo al enviar', async () => {
  const source = await readFile(sourcePath, 'utf8')

  assert.match(source, /requireAuthorizedLinkedDevice\(roomId, remoteDeviceId\)/)
  assert.match(source, /getDeviceRouteStatus\(roomId, remoteDeviceId\)/)
  assert.match(source, /route === 'direct'/)
  assert.match(source, /route === 'cloud'/)
  assert.doesNotMatch(source, /catch[\s\S]{0,200}sendDeviceRelayTransfer/)
})

test('General instala el ACK antes del envío en Directo y Nube', async () => {
  const source = await readFile(sourcePath, 'utf8')

  const directWaiter = source.indexOf('subscribeLanLocalClipboardTransferAcks')
  const directSend = source.indexOf('sender.sendLocalClipboardTransfer')
  const cloudWaiter = source.indexOf('subscribeDeviceRelayAcks')
  const cloudSend = source.indexOf('sendDeviceRelayTransfer')

  assert.ok(directWaiter >= 0 && directWaiter < directSend)
  assert.ok(cloudWaiter >= 0 && cloudWaiter < cloudSend)
  assert.match(source, /ack\.status === 'stored'/)
})
