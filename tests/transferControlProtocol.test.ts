import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TRANSFER_REQUEST_MAX_CLOCK_SKEW_MS,
  TRANSFER_REQUEST_MAX_TTL_MS,
  transferControlRequestIsLive,
  validTransferControlForRoute,
} from '../src/shared/transferControlProtocol.ts'
import { parseTransferControlInput } from '../worker/realtime/transferControlProtocol.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const requestId = 'req_0123456789abcdef01234567'
const createdAt = 1_800_000_000_000

const request = {
  version: 1 as const,
  type: 'transfer-request' as const,
  requestId,
  senderDeviceId,
  receiverDeviceId,
  contentKind: 'image' as const,
  byteSize: 25 * 1024 * 1024,
  createdAt,
  expiresAt: createdAt + TRANSFER_REQUEST_MAX_TTL_MS,
}

test('acepta una solicitud de control dirigida sin contenido', () => {
  assert.equal(validTransferControlForRoute(request, senderDeviceId, receiverDeviceId), true)
  assert.deepEqual(parseTransferControlInput({
    type: 'transfer-control',
    targetDeviceId: receiverDeviceId,
    message: request,
  }, senderDeviceId), {
    type: 'transfer-control',
    targetDeviceId: receiverDeviceId,
    message: request,
  })
})

test('rechaza identidad invertida, autoenvío y metadatos usados para tunelar payload', () => {
  assert.equal(validTransferControlForRoute(request, receiverDeviceId, senderDeviceId), false)
  assert.equal(parseTransferControlInput({
    type: 'transfer-control',
    targetDeviceId: senderDeviceId,
    message: { ...request, receiverDeviceId: senderDeviceId },
  }, senderDeviceId), null)
  assert.equal(parseTransferControlInput({
    type: 'transfer-control',
    targetDeviceId: receiverDeviceId,
    message: { ...request, payload: 'data:image/png;base64,AAAA' },
  }, senderDeviceId), null)
  assert.equal(parseTransferControlInput({
    type: 'transfer-control',
    targetDeviceId: receiverDeviceId,
    message: request,
    payload: 'extra',
  }, senderDeviceId), null)
})

test('limita vigencia, reloj y tamaño lógico de la solicitud', () => {
  assert.equal(validTransferControlForRoute({
    ...request,
    expiresAt: request.createdAt + TRANSFER_REQUEST_MAX_TTL_MS + 1,
  }, senderDeviceId, receiverDeviceId), false)
  assert.equal(validTransferControlForRoute({ ...request, byteSize: -1 }, senderDeviceId, receiverDeviceId), false)

  assert.equal(transferControlRequestIsLive(request, createdAt), true)
  assert.equal(transferControlRequestIsLive({ ...request, expiresAt: createdAt }, createdAt), false)
  assert.equal(transferControlRequestIsLive({
    ...request,
    createdAt: createdAt + TRANSFER_REQUEST_MAX_CLOCK_SKEW_MS + 1,
    expiresAt: createdAt + TRANSFER_REQUEST_MAX_CLOCK_SKEW_MS + 1 + TRANSFER_REQUEST_MAX_TTL_MS,
  }, createdAt), false)
})

test('solo el receptor decide y la decisión vuelve al emisor original', () => {
  const decision = {
    version: 1 as const,
    type: 'transfer-decision' as const,
    requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'accepted' as const,
    decidedAt: createdAt + 1_000,
  }

  assert.equal(validTransferControlForRoute(decision, receiverDeviceId, senderDeviceId), true)
  assert.equal(validTransferControlForRoute(decision, senderDeviceId, receiverDeviceId), false)
  assert.deepEqual(parseTransferControlInput({
    type: 'transfer-control',
    targetDeviceId: senderDeviceId,
    message: decision,
  }, receiverDeviceId)?.message, decision)
})

test('cualquiera de los dos extremos puede cancelar, pero no un tercero', () => {
  const senderCancel = {
    version: 1 as const,
    type: 'transfer-cancel' as const,
    requestId,
    senderDeviceId,
    receiverDeviceId,
    cancelledByDeviceId: senderDeviceId,
    cancelledAt: createdAt + 2_000,
  }
  const receiverCancel = { ...senderCancel, cancelledByDeviceId: receiverDeviceId }

  assert.equal(validTransferControlForRoute(senderCancel, senderDeviceId, receiverDeviceId), true)
  assert.equal(validTransferControlForRoute(receiverCancel, receiverDeviceId, senderDeviceId), true)
  assert.equal(validTransferControlForRoute({
    ...senderCancel,
    cancelledByDeviceId: 'dev_cccccccccccccccc',
  }, senderDeviceId, receiverDeviceId), false)
})
