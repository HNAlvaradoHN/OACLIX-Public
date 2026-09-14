import coreWorker from './index'
import { getDevicePrincipal, type D1DatabaseLike } from './data/coreStore'
import { validProofMetadata, verifyDeviceActionProof, type DeviceProofEnvelope } from './security/deviceProof'

export { RealtimeHub } from './realtime/realtimeHub'

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

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{8,96}$/
const AUTH_PROTOCOL_PREFIX = 'oaclix-auth-'

function sameOrigin(request: Request) {
  const origin = request.headers.get('Origin')
  return Boolean(origin && origin === new URL(request.url).origin)
}

function decodeBase64UrlJson<T>(value: string): T | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}

function readRealtimeEnvelope(request: Request) {
  const protocols = (request.headers.get('Sec-WebSocket-Protocol') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (!protocols.includes('oaclix-v1')) return null
  const authProtocol = protocols.find((value) => value.startsWith(AUTH_PROTOCOL_PREFIX))
  if (!authProtocol) return null

  return decodeBase64UrlJson<DeviceProofEnvelope<{ roomId: string }>>(
    authProtocol.slice(AUTH_PROTOCOL_PREFIX.length),
  )
}

async function handleRealtimeConnect(request: Request, env: Env) {
  if (request.method !== 'GET') return Response.json({ error: 'Método no permitido' }, { status: 405 })
  if (!sameOrigin(request)) return Response.json({ error: 'Origen no permitido' }, { status: 403 })
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return Response.json({ error: 'WebSocket requerido' }, { status: 426 })
  }
  if (!env.REALTIME || !env.DB) return Response.json({ error: 'Tiempo real no configurado' }, { status: 503 })

  const url = new URL(request.url)
  const roomId = url.searchParams.get('roomId') ?? ''
  if (!ROOM_ID_PATTERN.test(roomId)) return Response.json({ error: 'Sala inválida' }, { status: 400 })

  const envelope = readRealtimeEnvelope(request)
  if (!envelope || !validProofMetadata(envelope)) {
    return Response.json({ error: 'Prueba de dispositivo inválida' }, { status: 401 })
  }

  const payload = { roomId }

  try {
    const proof = await verifyDeviceActionProof(envelope, 'realtime.connect', payload)
    if (!proof.verified) return Response.json({ error: 'Prueba de identidad rechazada' }, { status: 401 })

    const principal = await getDevicePrincipal(env.DB, proof.deviceId)
    if (!principal) return Response.json({ error: 'Dispositivo no registrado' }, { status: 401 })
    if (principal.requiresStandaloneMigration) {
      return Response.json({ error: 'Reabre OACLIX para actualizar la identidad de este dispositivo' }, { status: 409 })
    }

    const access = await env.DB
      .prepare(`SELECT 1 AS allowed
        FROM rooms r
        INNER JOIN room_memberships m ON m.room_id = r.id
        WHERE r.id = ?1
          AND r.closed_at IS NULL
          AND m.person_id = ?2
        LIMIT 1`)
      .bind(roomId, principal.personId)
      .first<{ allowed: number }>()

    if (!access) return Response.json({ error: 'Sala no disponible' }, { status: 403 })

    const stub = env.REALTIME.get(env.REALTIME.idFromName(roomId))
    const headers = new Headers(request.headers)
    headers.set('X-OACLIX-Room-Id', roomId)
    headers.set('X-OACLIX-Device-Id', principal.deviceId)
    headers.set('X-OACLIX-Person-Id', principal.personId)
    headers.set('Sec-WebSocket-Protocol', 'oaclix-v1')
    return stub.fetch(new Request(request, { headers }))
  } catch {
    return Response.json({ error: 'No se pudo verificar el dispositivo' }, { status: 401 })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (pathname === '/api/realtime/connect') {
      return handleRealtimeConnect(request, env)
    }
    return coreWorker.fetch(request, env)
  },

  async scheduled(controller: unknown, env: Env): Promise<void> {
    await coreWorker.scheduled(controller, env)
  },
}
