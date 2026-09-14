import { cleanupExpiredClipboardData } from './data/clipboardCleanup'
import { normalizeClipboardCreateSignedPayload } from './data/clipboardCreateRequest'
import { ClipboardAccessError, ClipboardExpiryError, ClipboardItemConflictError, ClipboardLimitError, createClipboardTextItem, deleteClipboardTextItem, listClipboardChanges, listClipboardTextItems, normalizeClipboardCursor, normalizeClipboardItemId } from './data/clipboardStore'
import { getDevicePrincipal, listActivePersonRoomIds, listPersonDevices, persistDeviceIdentity, renamePersonDevice, unlinkPersonDevice, type D1DatabaseLike, type DevicePrincipal } from './data/coreStore'
import { createDeviceLinkCode, consumeDeviceLinkCode, DeviceMergeNotSafeError, InvalidLinkCodeError, LinkCodeTooFrequentError, normalizeLinkCode } from './data/deviceLinkStore'
import { canonicalPublicKey, validProofMetadata, verifyBootstrapProof, verifyDeviceActionProof, type DeviceProofEnvelope, type PublicDeviceKey } from './security/deviceProof'

type BootstrapRequest = {
  version: 1
  publicKey: PublicDeviceKey
  timestamp: number
  nonce: string
  signature: string
  deviceLabel?: string
}

type DurableObjectStubLike = {
  fetch(request: Request): Promise<Response>
}

type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown
  get(id: unknown): DurableObjectStubLike
}

type Env = {
  DB?: D1DatabaseLike
  REALTIME?: DurableObjectNamespaceLike
}

const MAX_BODY_LENGTH = 16_384
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const REALTIME_UNLINK_CONTROL = 'device-unlink-v1'

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function sameOrigin(request: Request) {
  const url = new URL(request.url)
  const origin = request.headers.get('Origin')
  return !origin || origin === url.origin
}

async function readJsonBody<T>(request: Request) {
  if (!sameOrigin(request)) throw new Error('origin')
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new Error('content-type')

  const raw = await request.text()
  if (raw.length === 0 || raw.length > MAX_BODY_LENGTH) throw new Error('body')

  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error('json')
  }
}

function cleanDeviceLabel(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 48)
}

function sanitizeDeviceLabel(value: unknown) {
  return cleanDeviceLabel(value) || 'Este dispositivo'
}

function normalizeEditableDeviceLabel(value: unknown) {
  const clean = cleanDeviceLabel(value)
  return clean.length > 0 ? clean : null
}

function normalizeDeviceId(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return DEVICE_ID_PATTERN.test(normalized) ? normalized : null
}

function normalizeRoomId(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(normalized)) return null
  return normalized
}

async function authenticateDeviceAction<TPayload>(
  env: Env,
  envelope: DeviceProofEnvelope<TPayload>,
  action: string,
  normalizedPayload: TPayload,
): Promise<DevicePrincipal | Response> {
  if (!env.DB) return json({ error: 'Persistencia no configurada' }, 503)
  if (!validProofMetadata(envelope)) return json({ error: 'Prueba de dispositivo inválida o expirada' }, 401)

  try {
    const proof = await verifyDeviceActionProof(envelope, action, normalizedPayload)
    if (!proof.verified) return json({ error: 'Prueba de identidad rechazada' }, 401)

    const principal = await getDevicePrincipal(env.DB, proof.deviceId)
    if (!principal) return json({ error: 'Dispositivo no registrado' }, 401)
    if (principal.requiresStandaloneMigration) {
      return json({ error: 'Reabre OACLIX para actualizar la identidad de este dispositivo' }, 409)
    }
    return principal
  } catch {
    return json({ error: 'No se pudo verificar el dispositivo' }, 401)
  }
}

async function invalidateUnlinkedDeviceRealtime(env: Env, roomIds: string[], deviceId: string) {
  if (!env.REALTIME || roomIds.length === 0) return true
  let invalidated = true

  for (const roomId of roomIds) {
    try {
      const stub = env.REALTIME.get(env.REALTIME.idFromName(roomId))
      const response = await stub.fetch(new Request('https://oaclix.internal/realtime/device-unlink', {
        method: 'POST',
        headers: {
          'X-OACLIX-Internal-Control': REALTIME_UNLINK_CONTROL,
          'X-OACLIX-Device-Id': deviceId,
        },
      }))
      if (!response.ok) invalidated = false
    } catch {
      invalidated = false
    }
  }

  return invalidated
}

async function handleBootstrap(request: Request, env: Env) {
  let body: BootstrapRequest
  try {
    body = await readJsonBody<BootstrapRequest>(request)
  } catch (error) {
    const reason = error instanceof Error ? error.message : ''
    if (reason === 'origin') return json({ error: 'Origen no permitido' }, 403)
    if (reason === 'content-type') return json({ error: 'Content-Type inválido' }, 415)
    if (reason === 'body') return json({ error: 'Solicitud inválida' }, 413)
    return json({ error: 'JSON inválido' }, 400)
  }

  if (!validProofMetadata(body)) return json({ error: 'Prueba de identidad inválida o expirada' }, 401)

  try {
    const proof = await verifyBootstrapProof(body)
    if (!proof.verified) return json({ error: 'Prueba de identidad rechazada' }, 401)

    const stableId = proof.digest.slice(0, 24)
    const deviceId = `dev_${stableId}`
    const derivedPersonId = `per_${stableId}`
    const deviceLabel = sanitizeDeviceLabel(body.deviceLabel)

    if (!env.DB) {
      return json({
        version: 1,
        authenticated: true,
        personId: derivedPersonId,
        deviceId,
        deviceLabel,
        persisted: false,
        generalRoomId: null,
      })
    }

    try {
      const persisted = await persistDeviceIdentity(env.DB, {
        derivedPersonId,
        deviceId,
        deviceLabel,
        publicKeyJson: canonicalPublicKey(body.publicKey),
        now: Date.now(),
      })

      return json({
        version: 1,
        authenticated: true,
        personId: persisted.personId,
        deviceId,
        deviceLabel: persisted.deviceLabel,
        persisted: true,
        generalRoomId: persisted.generalRoomId,
      })
    } catch {
      return json({ error: 'Persistencia temporalmente no disponible' }, 503)
    }
  } catch {
    return json({ error: 'No se pudo verificar la identidad' }, 400)
  }
}

async function handleCreateLink(request: Request, env: Env) {
  let envelope: DeviceProofEnvelope<Record<string, never>>
  try {
    envelope = await readJsonBody(request)
  } catch {
    return json({ error: 'Solicitud inválida' }, 400)
  }

  const payload = {}
  const principal = await authenticateDeviceAction(env, envelope, 'identity.link.create', payload)
  if (principal instanceof Response) return principal

  try {
    const result = await createDeviceLinkCode(env.DB!, principal, Date.now())
    return json({ version: 1, ...result })
  } catch (error) {
    if (error instanceof LinkCodeTooFrequentError) return json({ error: error.message }, 429)
    return json({ error: 'No se pudo generar el código' }, 503)
  }
}

async function handleConsumeLink(request: Request, env: Env) {
  let envelope: DeviceProofEnvelope<{ code?: unknown }>
  try {
    envelope = await readJsonBody(request)
  } catch {
    return json({ error: 'Solicitud inválida' }, 400)
  }

  const normalizedCode = normalizeLinkCode(envelope.payload?.code)
  if (!normalizedCode) return json({ error: 'Código inválido' }, 400)

  const payload = { code: normalizedCode }
  const principal = await authenticateDeviceAction(env, envelope as DeviceProofEnvelope<{ code: string }>, 'identity.link.consume', payload)
  if (principal instanceof Response) return principal

  try {
    const result = await consumeDeviceLinkCode(env.DB!, principal, normalizedCode, Date.now())
    return json({ version: 1, linked: true, ...result })
  } catch (error) {
    if (error instanceof InvalidLinkCodeError) return json({ error: error.message }, 404)
    if (error instanceof DeviceMergeNotSafeError) return json({ error: error.message }, 409)
    return json({ error: 'No se pudo vincular el dispositivo' }, 503)
  }
}

async function handleListDevices(request: Request, env: Env) {
  let envelope: DeviceProofEnvelope<Record<string, never>>
  try {
    envelope = await readJsonBody(request)
  } catch {
    return json({ error: 'Solicitud inválida' }, 400)
  }

  const payload = {}
  const principal = await authenticateDeviceAction(env, envelope, 'identity.devices.list', payload)
  if (principal instanceof Response) return principal

  try {
    const devices = await listPersonDevices(env.DB!, principal.personId)
    return json({ version: 1, personId: principal.personId, devices })
  } catch {
    return json({ error: 'No se pudieron cargar los dispositivos' }, 503)
  }
}

async function handleRenameDevice(request: Request, env: Env) {
  let envelope: DeviceProofEnvelope<{ deviceId?: unknown; label?: unknown }>
  try {
    envelope = await readJsonBody(request)
  } catch {
    return json({ error: 'Solicitud inválida' }, 400)
  }

  const deviceId = normalizeDeviceId(envelope.payload?.deviceId)
  const label = normalizeEditableDeviceLabel(envelope.payload?.label)
  if (!deviceId || !label) return json({ error: 'Nombre o dispositivo inválido' }, 400)

  const payload = { deviceId, label }
  const principal = await authenticateDeviceAction(
    env,
    envelope as DeviceProofEnvelope<typeof payload>,
    'identity.devices.rename',
    payload,
  )
  if (principal instanceof Response) return principal

  try {
    const renamed = await renamePersonDevice(env.DB!, principal.personId, deviceId, label)
    if (!renamed) return json({ error: 'Dispositivo no disponible' }, 404)
    return json({ version: 1, renamed: true, deviceId, label })
  } catch {
    return json({ error: 'No se pudo cambiar el nombre' }, 503)
  }
}

async function handleUnlinkDevice(request: Request, env: Env) {
  let envelope: DeviceProofEnvelope<{ deviceId?: unknown }>
  try {
    envelope = await readJsonBody(request)
  } catch {
    return json({ error: 'Solicitud inválida' }, 400)
  }

  const deviceId = normalizeDeviceId(envelope.payload?.deviceId)
  if (!deviceId) return json({ error: 'Dispositivo inválido' }, 400)

  const payload = { deviceId }
  const principal = await authenticateDeviceAction(
    env,
    envelope as DeviceProofEnvelope<typeof payload>,
    'identity.devices.unlink',
    payload,
  )
  if (principal instanceof Response) return principal
  if (principal.deviceId === deviceId) {
    return json({ error: 'Desvincula este dispositivo desde otro equipo vinculado' }, 409)
  }

  try {
    const roomIds = await listActivePersonRoomIds(env.DB!, principal.personId)
    const unlinked = await unlinkPersonDevice(env.DB!, principal.personId, deviceId, Date.now())
    if (!unlinked) return json({ error: 'Dispositivo no disponible' }, 404)

    const realtimeInvalidated = await invalidateUnlinkedDeviceRealtime(env, roomIds, deviceId)
    return json({ version: 1, unlinked: true, deviceId, realtimeInvalidated })
  } catch {
    return json({ error: 'No se pudo desvincular el dispositivo' }, 503)
  }
}

async function handleCreateClipboardText(request: Request, env: Env) {
  let envelope: DeviceProofEnvelope<Record<string, unknown>>
  try {
    envelope = await readJsonBody(request)
  } catch {
    return json({ error: 'Solicitud inválida' }, 400)
  }

  const payload = normalizeClipboardCreateSignedPayload(envelope.payload)
  if (!payload) return json({ error: 'Texto, identificadores o expiración inválidos' }, 400)

  const principal = await authenticateDeviceAction(
    env,
    envelope as DeviceProofEnvelope<typeof payload>,
    'clipboard.text.create',
    payload,
  )
  if (principal instanceof Response) return principal

  try {
    const result = await createClipboardTextItem(env.DB!, principal, { ...payload, now: Date.now() })
    return json({ version: 1, ...result }, result.created ? 201 : 200)
  } catch (error) {
    if (error instanceof ClipboardAccessError) return json({ error: error.message }, 403)
    if (error instanceof ClipboardExpiryError) return json({ error: error.message }, 400)
    if (error instanceof ClipboardLimitError) return json({ error: error.message }, 429)
    if (error instanceof ClipboardItemConflictError) return json({ error: error.message }, 409)
    return json({ error: 'No se pudo guardar el texto' }, 503)
  }
}

async function handleDeleteClipboardText(request: Request, env: Env) {
  let envelope: DeviceProofEnvelope<{ roomId?: unknown; itemId?: unknown }>
  try {
    envelope = await readJsonBody(request)
  } catch {
    return json({ error: 'Solicitud inválida' }, 400)
  }

  const roomId = normalizeRoomId(envelope.payload?.roomId)
  const itemId = normalizeClipboardItemId(envelope.payload?.itemId)
  if (!roomId || !itemId) return json({ error: 'Identificadores inválidos' }, 400)

  const payload = { roomId, itemId }
  const principal = await authenticateDeviceAction(
    env,
    envelope as DeviceProofEnvelope<typeof payload>,
    'clipboard.text.delete',
    payload,
  )
  if (principal instanceof Response) return principal

  try {
    const result = await deleteClipboardTextItem(env.DB!, principal, { ...payload, now: Date.now() })
    return json({ version: 1, ...result })
  } catch (error) {
    if (error instanceof ClipboardAccessError) return json({ error: error.message }, 403)
    return json({ error: 'No se pudo eliminar el texto' }, 503)
  }
}

async function handleListClipboard(request: Request, env: Env) {
  let envelope: DeviceProofEnvelope<{ roomId?: unknown; after?: unknown }>
  try {
    envelope = await readJsonBody(request)
  } catch {
    return json({ error: 'Solicitud inválida' }, 400)
  }

  const roomId = normalizeRoomId(envelope.payload?.roomId)
  const after = normalizeClipboardCursor(envelope.payload?.after)
  if (!roomId || after == null) return json({ error: 'Consulta inválida' }, 400)

  const payload = { roomId, after }
  const principal = await authenticateDeviceAction(
    env,
    envelope as DeviceProofEnvelope<typeof payload>,
    'clipboard.items.list',
    payload,
  )
  if (principal instanceof Response) return principal

  try {
    const result = await listClipboardTextItems(env.DB!, principal, { ...payload, now: Date.now() })
    return json({ version: 1, ...result })
  } catch (error) {
    if (error instanceof ClipboardAccessError) return json({ error: error.message }, 403)
    return json({ error: 'No se pudo cargar el portapapeles' }, 503)
  }
}

async function handleListClipboardChanges(request: Request, env: Env) {
  let envelope: DeviceProofEnvelope<{ roomId?: unknown; after?: unknown }>
  try {
    envelope = await readJsonBody(request)
  } catch {
    return json({ error: 'Solicitud inválida' }, 400)
  }

  const roomId = normalizeRoomId(envelope.payload?.roomId)
  const after = normalizeClipboardCursor(envelope.payload?.after)
  if (!roomId || after == null) return json({ error: 'Consulta inválida' }, 400)

  const payload = { roomId, after }
  const principal = await authenticateDeviceAction(
    env,
    envelope as DeviceProofEnvelope<typeof payload>,
    'clipboard.changes.list',
    payload,
  )
  if (principal instanceof Response) return principal

  try {
    const result = await listClipboardChanges(env.DB!, principal, { ...payload, now: Date.now() })
    return json({ version: 1, ...result })
  } catch (error) {
    if (error instanceof ClipboardAccessError) return json({ error: error.message }, 403)
    return json({ error: 'No se pudieron cargar los cambios del portapapeles' }, 503)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/identity/bootstrap') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
      return handleBootstrap(request, env)
    }

    if (url.pathname === '/api/identity/link/create') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
      return handleCreateLink(request, env)
    }

    if (url.pathname === '/api/identity/link/consume') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
      return handleConsumeLink(request, env)
    }

    if (url.pathname === '/api/identity/devices/list') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
      return handleListDevices(request, env)
    }

    if (url.pathname === '/api/identity/devices/rename') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
      return handleRenameDevice(request, env)
    }

    if (url.pathname === '/api/identity/devices/unlink') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
      return handleUnlinkDevice(request, env)
    }

    if (url.pathname === '/api/clipboard/text/create') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
      return handleCreateClipboardText(request, env)
    }

    if (url.pathname === '/api/clipboard/text/delete') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
      return handleDeleteClipboardText(request, env)
    }

    if (url.pathname === '/api/clipboard/items/list') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
      return handleListClipboard(request, env)
    }

    if (url.pathname === '/api/clipboard/changes/list') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
      return handleListClipboardChanges(request, env)
    }

    if (url.pathname === '/api/storage/status' && request.method === 'GET') {
      return json({ d1Configured: Boolean(env.DB) })
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, service: 'oaclix' })
    }

    return json({ error: 'Ruta no encontrada' }, 404)
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    if (!env.DB) return
    await cleanupExpiredClipboardData(env.DB, Date.now())
  },
}
