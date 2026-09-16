import assert from 'node:assert/strict'
import test from 'node:test'
import { createAutomaticTrustedTransferDecision } from '../src/realtime/transferAcceptancePolicy.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const now = 1_800_000_000_000
const request = {
  version: 1 as const,
  type: 'transfer-request' as const,
  requestId: 'req_200000000000000000000001',
  senderDeviceId,
  receiverDeviceId,
  contentKind: 'file' as const,
  byteSize: 1024,
  createdAt: now,
  expiresAt: now + 60_000,
}

test('un dispositivo propio ya confiable autoacepta sin intervención del receptor', () => {
  assert.deepEqual(createAutomaticTrustedTransferDecision(request, {
    localDeviceId: receiverDeviceId,
    remoteDeviceId: senderDeviceId,
    trustedSameIdentity: true,
    decidedAt: now + 500,
  }), {
    version: 1,
    type: 'transfer-decision',
    requestId: request.requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'accepted',
    decidedAt: now + 500,
  })
})

test('un peer no confiable o con identidad invertida nunca se autoacepta', () => {
  assert.equal(createAutomaticTrustedTransferDecision(request, {
    localDeviceId: receiverDeviceId,
    remoteDeviceId: senderDeviceId,
    trustedSameIdentity: false,
    decidedAt: now + 500,
  }), null)

  assert.equal(createAutomaticTrustedTransferDecision(request, {
    localDeviceId: senderDeviceId,
    remoteDeviceId: receiverDeviceId,
    trustedSameIdentity: true,
    decidedAt: now + 500,
  }), null)
})
