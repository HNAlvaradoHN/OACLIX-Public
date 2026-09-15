export type DeviceIdentityStatus = 'loading' | 'ready' | 'error'

export interface DeviceIdentitySnapshot {
  personId: string
  deviceId: string
  deviceLabel: string
  authenticated: true
  createdLocally: boolean
  persisted: boolean
  generalRoomId: string | null
}

type PublicDeviceKey = {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
}

type StoredCredential = {
  version: 1
  privateKey: CryptoKey
  publicKey: PublicDeviceKey
  createdAt: number
}

export type SignedDeviceAction<TPayload> = {
  version: 1
  publicKey: PublicDeviceKey
  timestamp: number
  nonce: string
  payload: TPayload
  signature: string
}

type NativeProof = {
  version: 1
  publicKey: PublicDeviceKey
  timestamp: number
  nonce: string
  signature: string
}

type OaclixNativeBridge = {
  getDeviceId(): string
  createBootstrapProof(): string
  signAction(action: string, payloadJson: string): string
}

declare global {
  interface Window {
    OaclixNative?: OaclixNativeBridge
  }
}

export class DeviceIdentityApiError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'DeviceIdentityApiError'
    this.statusCode = statusCode
  }
}

const DATABASE_NAME = 'oaclix-identity'
const STORE_NAME = 'credentials'
const RECORD_KEY = 'primary-device'
const DEVICE_LABEL = 'Este dispositivo'
const encoder = new TextEncoder()

function nativeBridge() {
  return window.OaclixNative ?? null
}

function parseNativeProof(raw: string): NativeProof {
  const value = JSON.parse(raw) as Partial<NativeProof>
  const key = value.publicKey
  if (
    value.version !== 1 ||
    !key ||
    key.kty !== 'EC' ||
    key.crv !== 'P-256' ||
    typeof key.x !== 'string' ||
    typeof key.y !== 'string' ||
    typeof value.timestamp !== 'number' ||
    typeof value.nonce !== 'string' ||
    typeof value.signature !== 'string'
  ) {
    throw new Error('Android devolvió una prueba de identidad inválida')
  }
  return value as NativeProof
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function canonicalPublicKey(key: PublicDeviceKey) {
  return JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y })
}

async function digestText(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return toBase64Url(new Uint8Array(digest))
}

async function publicKeyDigest(key: PublicDeviceKey) {
  return digestText(canonicalPublicKey(key))
}

function randomNonce() {
  const value = new Uint8Array(18)
  crypto.getRandomValues(value)
  return toBase64Url(value)
}

function openIdentityDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no disponible'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la identidad local'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function readCredential() {
  const database = await openIdentityDatabase()
  try {
    return await new Promise<StoredCredential | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY)
      request.onerror = () => reject(request.error ?? new Error('No se pudo leer la identidad local'))
      request.onsuccess = () => resolve(request.result as StoredCredential | undefined)
    })
  } finally {
    database.close()
  }
}

async function writeCredential(credential: StoredCredential) {
  const database = await openIdentityDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar la identidad local'))
      transaction.oncomplete = () => resolve()
      transaction.objectStore(STORE_NAME).put(credential, RECORD_KEY)
    })
  } finally {
    database.close()
  }
}

async function createCredential(): Promise<StoredCredential> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  ) as CryptoKeyPair

  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey)
  if (exported.kty !== 'EC' || exported.crv !== 'P-256' || !exported.x || !exported.y) {
    throw new Error('La clave pública generada no es válida')
  }

  const credential: StoredCredential = {
    version: 1,
    privateKey: pair.privateKey,
    publicKey: { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y },
    createdAt: Date.now(),
  }

  await writeCredential(credential)
  return credential
}

async function getOrCreateCredential() {
  const existing = await readCredential()
  if (existing?.version === 1 && existing.privateKey && existing.publicKey) {
    return { credential: existing, createdLocally: false }
  }

  return { credential: await createCredential(), createdLocally: true }
}

export function isAndroidNativeShell() {
  return nativeBridge() !== null
}

export async function getLocalDeviceId() {
  const bridge = nativeBridge()
  if (bridge) {
    const deviceId = bridge.getDeviceId()
    if (!deviceId.startsWith('dev_')) throw new Error('Android devolvió un deviceId inválido')
    return deviceId
  }

  const credential = await readCredential()
  if (!credential) throw new Error('Identidad local no disponible')
  const digest = await publicKeyDigest(credential.publicKey)
  return `dev_${digest.slice(0, 24)}`
}

export async function signDeviceAction<TPayload>(action: string, payload: TPayload): Promise<SignedDeviceAction<TPayload>> {
  const bridge = nativeBridge()
  if (bridge) {
    const proof = parseNativeProof(bridge.signAction(action, JSON.stringify(payload)))
    return { ...proof, payload }
  }

  if (!window.isSecureContext || !crypto.subtle) throw new Error('OACLIX necesita un contexto HTTPS seguro')

  const credential = await readCredential()
  if (!credential) throw new Error('Identidad local no disponible')

  const timestamp = Date.now()
  const nonce = randomNonce()
  const deviceDigest = await publicKeyDigest(credential.publicKey)
  const payloadDigest = await digestText(JSON.stringify(payload))
  const message = `oaclix-action|1|${action}|${timestamp}|${nonce}|${deviceDigest}|${payloadDigest}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    credential.privateKey,
    encoder.encode(message),
  )

  return {
    version: 1,
    publicKey: credential.publicKey,
    timestamp,
    nonce,
    payload,
    signature: toBase64Url(new Uint8Array(signature)),
  }
}

async function postBootstrapProof(proof: NativeProof, createdLocally: boolean): Promise<DeviceIdentitySnapshot> {
  const response = await fetch('/api/identity/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: proof.version,
      publicKey: proof.publicKey,
      timestamp: proof.timestamp,
      nonce: proof.nonce,
      signature: proof.signature,
      deviceLabel: DEVICE_LABEL,
    }),
  })

  const data = await response.json().catch(() => ({})) as {
    error?: string
    personId?: string
    deviceId?: string
    deviceLabel?: string
    authenticated?: boolean
    persisted?: boolean
    generalRoomId?: string | null
  }

  if (!response.ok) {
    throw new DeviceIdentityApiError(
      response.status,
      data.error || `No se pudo verificar la identidad (${response.status})`,
    )
  }

  if (!data.authenticated || !data.personId?.startsWith('per_') || !data.deviceId?.startsWith('dev_')) {
    throw new Error('El servidor devolvió una identidad inválida')
  }

  return {
    personId: data.personId,
    deviceId: data.deviceId,
    deviceLabel: data.deviceLabel || DEVICE_LABEL,
    authenticated: true,
    createdLocally,
    persisted: Boolean(data.persisted),
    generalRoomId: data.generalRoomId ?? null,
  }
}

export async function bootstrapDeviceIdentity(): Promise<DeviceIdentitySnapshot> {
  const bridge = nativeBridge()
  if (bridge) {
    const proof = parseNativeProof(bridge.createBootstrapProof())
    return postBootstrapProof(proof, false)
  }

  if (!window.isSecureContext || !crypto.subtle) throw new Error('OACLIX necesita un contexto HTTPS seguro')

  const { credential, createdLocally } = await getOrCreateCredential()
  const timestamp = Date.now()
  const nonce = randomNonce()
  const digest = await publicKeyDigest(credential.publicKey)
  const message = `oaclix-bootstrap|1|${timestamp}|${nonce}|${digest}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    credential.privateKey,
    encoder.encode(message),
  )

  return postBootstrapProof({
    version: 1,
    publicKey: credential.publicKey,
    timestamp,
    nonce,
    signature: toBase64Url(new Uint8Array(signature)),
  }, createdLocally)
}
