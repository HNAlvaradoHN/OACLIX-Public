import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  CLOUD_IMAGE_MAX_BYTES,
  LOCAL_IMAGE_RETENTION_MS,
  createLocalImageTransferAck,
  validLocalImageTransfer,
} from '../src/shared/localImageTransferCore.ts'
import { parseDeviceRelayInput } from '../worker/realtime/deviceRelayProtocol.ts'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

function sampleTransfer() {
  const bytes = Buffer.from('oaclix-image')
  return {
    version: 1 as const,
    type: 'local-image-transfer' as const,
    transferId: 'xfr_0123456789abcdef01234567',
    senderDeviceId: 'dev_aaaaaaaaaaaaaaaa',
    receiverDeviceId: 'dev_bbbbbbbbbbbbbbbb',
    item: {
      id: 'itm_0123456789abcdef0123456789abcdef',
      mimeType: 'image/png',
      byteSize: bytes.length,
      base64Data: bytes.toString('base64'),
      createdAt: 1_800_000_000_000,
      expiresAt: 1_800_021_600_000,
    },
  }
}

test('image relay protocol keeps the approved cloud cap and local retention', () => {
  assert.equal(CLOUD_IMAGE_MAX_BYTES, 10 * 1024 * 1024)
  assert.equal(LOCAL_IMAGE_RETENTION_MS, 6 * 60 * 60 * 1000)

  const transfer = sampleTransfer()
  assert.equal(validLocalImageTransfer(transfer), true)
  assert.equal(validLocalImageTransfer({
    ...transfer,
    item: { ...transfer.item, byteSize: CLOUD_IMAGE_MAX_BYTES + 1 },
  }), false)
  assert.equal(validLocalImageTransfer({
    ...transfer,
    item: { ...transfer.item, byteSize: transfer.item.byteSize + 1 },
  }), false)
})

test('worker relay only accepts a targeted linked-image envelope with matching sender and receiver', () => {
  const transfer = sampleTransfer()
  const parsed = parseDeviceRelayInput({
    type: 'device-image-transfer',
    targetDeviceId: transfer.receiverDeviceId,
    transfer,
  }, transfer.senderDeviceId)

  assert.equal(parsed?.type, 'device-image-transfer')
  assert.equal(parsed?.targetDeviceId, transfer.receiverDeviceId)
  assert.equal(parseDeviceRelayInput({
    type: 'device-image-transfer',
    targetDeviceId: 'dev_cccccccccccccccc',
    transfer,
  }, transfer.senderDeviceId), null)

  const ack = createLocalImageTransferAck(transfer, 'stored')
  const parsedAck = parseDeviceRelayInput({
    type: 'device-image-transfer-ack',
    targetDeviceId: transfer.senderDeviceId,
    ack,
  }, transfer.receiverDeviceId)
  assert.equal(parsedAck?.type, 'device-image-transfer-ack')
})

test('relay code stores before acknowledging and never advertises this route as Directo', async () => {
  const [worker, webReceiver, androidSender, androidReceiver, shareReceiver] = await Promise.all([
    read('worker/realtime/realtimeHub.ts'),
    read('src/transport/localImageRelayReceiver.ts'),
    read('android/app/src/main/java/app/oaclix/android/share/NativeImageDeviceShareTransport.kt'),
    read('android/app/src/main/java/app/oaclix/android/share/NativeImageDeviceRelayReceiver.kt'),
    read('android/app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
  ])

  assert.match(worker, /const MAX_MESSAGE_LENGTH = 14_100_000/)
  assert.match(worker, /type: 'device-image-transfer'/)
  assert.match(worker, /target\.attachment\.personId !== current\.personId/)

  const storeIndex = webReceiver.indexOf('storeReceivedLocalImage')
  const ackIndex = webReceiver.indexOf('sendDeviceImageRelayAck')
  assert.ok(storeIndex >= 0 && ackIndex >= 0 && storeIndex < ackIndex)

  assert.match(androidSender, /ImageTransferPolicy\.CLOUD_MAX_IMAGE_BYTES/)
  assert.match(androidSender, /"device-image-transfer"/)
  assert.match(androidSender, /"device-image-transfer-ack"/)
  assert.match(androidReceiver, /createFromBytes\(bytes, mimeType, createdAt\)/)
  assert.match(androidReceiver, /if \(stored\) \{[\s\S]*onStored\(\)/)
  assert.match(shareReceiver, /"\$\{option\.label\} · Nube"/)
  assert.doesNotMatch(shareReceiver, /Imagen enviada por Directo/)
})

test('PWA owns Direct in foreground and connectedDevice service takes over only in Android background', async () => {
  const [controller, application, service, manifest, bridge, shareReceiver, foregroundWebReceiver, option] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/share/NativeImageRelayForegroundController.kt'),
    read('android/app/src/main/java/app/oaclix/android/OaclixApplication.kt'),
    read('android/app/src/main/java/app/oaclix/android/background/BackgroundDirectAvailabilityService.kt'),
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/java/app/oaclix/android/OaclixWebBridge.kt'),
    read('android/app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
    read('src/components/ForegroundLinkedImageReceiver.tsx'),
    read('src/components/AndroidBackgroundReceivingOption.tsx'),
  ])

  assert.match(controller, /NativeImageDeviceRelayReceiver/)
  assert.match(controller, /receiver\?\.stop\(\)/)
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE/)
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_CONNECTED_DEVICE/)
  assert.match(manifest, /android:foregroundServiceType="connectedDevice"/)
  assert.doesNotMatch(manifest, /android:foregroundServiceType="dataSync"/)

  assert.match(application, /BackgroundDirectRuntime\.setMainVisible\(true\)/)
  assert.match(application, /BackgroundDirectAvailabilityService\.ensureStartedIfEnabled\(this\)/)
  assert.match(application, /BackgroundDirectRuntime\.setMainVisible\(false\)/)
  assert.doesNotMatch(application, /NativeImageRelayForegroundController|NativeForegroundReceiverGate/)

  assert.match(service, /FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE/)
  assert.match(service, /startForegroundService/)
  assert.match(service, /START_STICKY/)
  assert.match(service, /!BackgroundDirectRuntime\.mainVisible/)
  assert.match(service, /if \(shouldReceive\) relayController\.start\(\) else relayController\.stop\(\)/)
  assert.match(service, /ACTION_DISABLE/)
  assert.match(service, /BackgroundDirectRuntime\.mainVisible/)

  assert.match(bridge, /isBackgroundDirectEnabled/)
  assert.match(bridge, /setBackgroundDirectEnabled/)
  assert.match(option, /Recepción en segundo plano/)
  assert.match(option, /setBackgroundDirectEnabled/)

  assert.doesNotMatch(shareReceiver, /NativeImageDeviceRelayReceiver|NativeDirectImagePeerManager|PeerConnectionFactory/)
  assert.match(foregroundWebReceiver, /ensureClipboardRoomForegroundReception/)
  assert.match(foregroundWebReceiver, /suspendClipboardRoomForegroundReception/)
  assert.match(foregroundWebReceiver, /document\.visibilityState !== 'visible'/)
})

test('cloud optimization is a separate stable copy and the PWA exposes stored received images locally', async () => {
  const [preparer, spooler, store, composer, shelf, signal] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/imageclipboard/ImageCloudCopyPreparer.kt'),
    read('android/app/src/main/java/app/oaclix/android/imageclipboard/ImageCloudSourceSpooler.kt'),
    read('android/app/src/main/java/app/oaclix/android/imageclipboard/ImageClipboardStore.kt'),
    read('src/components/ClipboardComposer.tsx'),
    read('src/components/LocalImageClipboardShelf.tsx'),
    read('src/realtime/signalClient.ts'),
  ])

  assert.match(preparer, /ImageCloudSourceSpooler\.snapshot/)
  assert.match(preparer, /BitmapFactory\.decodeFile/)
  assert.match(preparer, /PreparedImageCloudCopy\(output\.toByteArray\(\), "image\/webp", optimized = true\)/)
  assert.match(preparer, /GIF mayores de 10 MB/)
  assert.match(spooler, /Reads an incoming content stream exactly once/)
  assert.match(spooler, /CloudImageSourceSnapshot\.OnDisk/)
  assert.match(store, /fun createFromBytes/)
  assert.match(composer, /textareaId === 'local-text'/)
  assert.match(composer, /<LocalImageClipboardShelf onShare=\{onShareImage\} \/>/)
  assert.match(shelf, /readLocalImages\(\)/)
  assert.match(shelf, /subscribeAllLocalImageReceipts/)
  assert.match(shelf, /deleteLocalImage/)
  assert.match(shelf, /URL\.revokeObjectURL/)
  assert.match(signal, /receiveLocalImageRelayTransfer/)
  assert.match(signal, /sendDeviceImageTransferAck/)
})
