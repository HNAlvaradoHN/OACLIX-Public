import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('SignalClient autoacepta solo después de validar el frame autenticado de control', async () => {
  const source = await readFile(new URL('../src/realtime/signalClient.ts', import.meta.url), 'utf8')
  assert.match(
    source,
    /validTransferControlForRoute\(message\.message, message\.fromDeviceId, this\.readyDeviceId\)[\s\S]*?publishTransferControl\(this\.roomId, message\.message, message\.fromDeviceId\)[\s\S]*?message\.message\.type === 'transfer-request'[\s\S]*?createAutomaticTrustedTransferDecision[\s\S]*?trustedSameIdentity: true[\s\S]*?sendTransferControl\(this\.roomId, message\.fromDeviceId, decision\)/,
  )
})
