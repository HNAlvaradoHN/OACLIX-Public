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

test('legacy web image relay protocol keeps its existing cap and local retention', () => {
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

test('worker legacy relay only accepts a targeted linked-image envelope with matching sender and receiver', () => {
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

test('legacy web image relay remains isolated from the active Android Share Sheet', async () => {
  const [worker, webReceiver, shareReceiver] = await Promise.all([
    read('worker/realtime/realtimeHub.ts'),
    read('src/transport/localImageRelayReceiver.ts'),
    read('android/app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
  ])

  assert.match(worker, /const MAX_MESSAGE_LENGTH = 14_100_000/)
  assert.match(worker, /type: 'device-image-transfer'/)
  assert.match(worker, /target\.attachment\.personId !== current\.personId/)

  const storeIndex = webReceiver.indexOf('storeReceivedLocalImage')
  const ackIndex = webReceiver.indexOf('sendDeviceImageRelayAck')
  assert.ok(storeIndex >= 0 && ackIndex >= 0 && storeIndex < ackIndex)

  assert.match(shareReceiver, /SharedContentMode\.Image -> sharedImageUri != null && destination == NativeShareDestination\.LocalClipboard/)
  assert.doesNotMatch(shareReceiver, /NativeImageDeviceShareTransport|NativeImageDeviceRelayReceiver|ImageCloudCopyPreparer|device-image-transfer|· Nube/)
})

test('Android foreground lifecycle owns one metadata-only realtime session for direct text', async () => {
  const [controller, application, gate, manifest, mainActivity] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/share/NativeDirectTextSessionController.kt'),
    read('android/app/src/main/java/app/oaclix/android/OaclixApplication.kt'),
    read('android/app/src/main/java/app/oaclix/android/share/NativeForegroundReceiverGate.kt'),
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/java/app/oaclix/android/MainActivity.kt'),
  ])

  assert.match(controller, /Executors\.newSingleThreadScheduledExecutor\(\)/)\n  assert.match(controller, /private fun scheduleReconnect\\(\\)/)
  assert.match(controller, /client\.newWebSocket\(request, listenerFor\(createdSession\)\)/)
  assert.match(controller, /NativeDirectSignalProtocol\.isOutboundSignalFrame\(frame\)/)
  assert.match(controller, /session\.peer\.handlePresence\(message\)/)
  assert.match(controller, /"signal" -> session\.peer\.handleSignal\(message\)/)
  assert.doesNotMatch(controller, /device-transfer|device-image-transfer/)

  assert.match(manifest, /android:name="\.OaclixApplication"/)
  assert.match(application, /Application\.ActivityLifecycleCallbacks/)
  assert.match(application, /NativeDirectTextSessionController\(/)
  assert.match(application, /onFirstSurfaceStarted = directTextController::start/)
  assert.match(application, /onLastSurfaceStopped = directTextController::stop/)
  assert.match(application, /LocalClipboardHistory\(this\)\.saveReceived/)
  assert.match(application, /OaclixClipboardBridge\.copy\(this, transfer\.text\)/)
  assert.match(application, /NativeTextReceiptBus\.publishStored\(\)/)
  assert.match(application, /AckStatus\.Stored/)
  assert.match(application, /override fun onActivityStarted[\s\S]*receiverGate\.surfaceStarted\(\)/)
  assert.match(application, /override fun onActivityStopped[\s\S]*receiverGate\.surfaceStopped\(\)/)
  assert.doesNotMatch(application, /NativeImageRelayForegroundController|NativeImageDeviceRelayReceiver/)

  assert.match(gate, /startedSurfaces/)
  assert.match(gate, /if \(startedSurfaces != 0 \|\| !active\) return/)
  assert.match(mainActivity, /NativeTextReceiptBus/)
  assert.match(mainActivity, /R\.string\.text_received/)
})

test('legacy PWA image relay keeps received images local to its web surface', async () => {
  const [composer, shelf, signal] = await Promise.all([
    read('src/components/ClipboardComposer.tsx'),
    read('src/components/LocalImageClipboardShelf.tsx'),
    read('src/realtime/signalClient.ts'),
  ])

  assert.match(composer, /textareaId === 'local-text'/)
  assert.match(composer, /<LocalImageClipboardShelf onShare=\{onShareImage\} \/>/)
  assert.match(shelf, /readLocalImages\(\)/)
  assert.match(shelf, /subscribeAllLocalImageReceipts/)
  assert.match(shelf, /deleteLocalImage/)
  assert.match(shelf, /URL\.revokeObjectURL/)
  assert.match(signal, /receiveLocalImageRelayTransfer/)
  assert.match(signal, /sendDeviceImageTransferAck/)
})
