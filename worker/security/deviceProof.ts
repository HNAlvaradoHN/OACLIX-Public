export type PublicDeviceKey = {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
}

export type DeviceProofEnvelope<TPayload> = {
  version: 1
  publicKey: PublicDeviceKey
  timestamp: number
  nonce: string
  payload: TPayload
  signature: string
}

const encoder = new TextEncoder()
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

export function canonicalPublicKey(key: PublicDeviceKey) {
  return JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y })
}

export function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export function validPublicKey(key: unknown): key is PublicDeviceKey {
  if (!key || typeof key !== 'object') return false
  const candidate = key as Partial<PublicDeviceKey>
  const part = /^[A-Za-z0-9_-]{40,60}$/
  return candidate.kty === 'EC'
    && candidate.crv === 'P-256'
    && typeof candidate.x === 'string'
    && typeof candidate.y === 'string'
    && part.test(candidate.x)
    && part.test(candidate.y)
}

export function validProofMetadata(value: {
  version?: unknown
  publicKey?: unknown
  timestamp?: unknown
  nonce?: unknown
  signature?: unknown
}) {
  return value.version === 1
    && validPublicKey(value.publicKey)
    && Number.isInteger(value.timestamp)
    && Math.abs(Date.now() - Number(value.timestamp)) <= MAX_CLOCK_SKEW_MS
    && typeof value.nonce === 'string'
    && /^[A-Za-z0-9_-]{20,40}$/.test(value.nonce)
    && typeof value.signature === 'string'
    && /^[A-Za-z0-9_-]{80,140}$/.test(value.signature)
}

async function digestText(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return toBase64Url(new Uint8Array(digest))
}

export async function digestPublicKey(key: PublicDeviceKey) {
  return digestText(canonicalPublicKey(key))
}

async function verifySignature(key: PublicDeviceKey, signature: string, message: string) {
  const imported = await crypto.subtle.importKey(
    'jwk',
    { ...key, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )

  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    imported,
    fromBase64Url(signature),
    encoder.encode(message),
  )
}

export async function verifyBootstrapProof(input: {
  publicKey: PublicDeviceKey
  timestamp: number
  nonce: string
  signature: string
}) {
  const digest = await digestPublicKey(input.publicKey)
  const message = `oaclix-bootstrap|1|${input.timestamp}|${input.nonce}|${digest}`
  const verified = await verifySignature(input.publicKey, input.signature, message)
  return { verified, digest }
}

export async function verifyDeviceActionProof<TPayload>(
  envelope: DeviceProofEnvelope<TPayload>,
  action: string,
  normalizedPayload: TPayload,
) {
  const deviceDigest = await digestPublicKey(envelope.publicKey)
  const payloadDigest = await digestText(JSON.stringify(normalizedPayload))
  const message = `oaclix-action|1|${action}|${envelope.timestamp}|${envelope.nonce}|${deviceDigest}|${payloadDigest}`
  const verified = await verifySignature(envelope.publicKey, envelope.signature, message)

  return {
    verified,
    deviceId: `dev_${deviceDigest.slice(0, 24)}`,
    derivedPersonId: `per_${deviceDigest.slice(0, 24)}`,
  }
}
