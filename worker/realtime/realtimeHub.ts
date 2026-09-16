import { DurableObject } from 'cloudflare:workers'
import {
  transferControlRequestIsLive,
  type TransferControlRequest,
} from '../../src/shared/transferControlProtocol.ts'
import { parseDeviceRelayInput } from './deviceRelayProtocol'
import {
  PENDING_TRANSFER_STORAGE_KEY,
  nextPendingTransferExpiry,
  normalizePendingTransferRequests,
  pendingTransferRequestsForDevice,
  queuePendingTransferRequest,
  removePendingTransferRequest,
  removePendingTransferRequestsForDevice,
  type PendingTransferRequestRecord,
} from './pendingTransferRequests'
import { parseTransferControlInput } from './transferControlProtocol'

type SocketAttachment = {
  roomId: string
  personId: string
  deviceId: string
  sessionId: string
  connectedAt: number
}

type AttachedWebSocket = WebSocket & {
  serializeAttachment(value: SocketAttachment): void
  deserializeAttachment(): SocketAttachment | null
}

type SignalMessage = {
  type: 'signal'
  targetDeviceId: string
  signal: unknown
}

// A cloud-relayed image is capped at 10 MiB raw. Base64 expands it to ~13.98 MB;
// keep the accepted JSON frame narrowly above that envelope while staying far
// below the platform WebSocket message ceiling. The new transfer-control path
// has its own small limit and never carries content bytes.
const MAX_MESSAGE_LENGTH = 14_100_000
const MAX_SIGNAL_LENGTH = 32_000
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{8,96}$/
const PERSON_ID_PATTERN = /^per_[A-Za-z0-9_-]{16,64}$/
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const HEARTBEAT_REQUEST = JSON.stringify({ type: 'ping' })
const HEARTBEAT_RESPONSE = JSON.stringify({ type: 'pong' })
const UNLINK_CONTROL = 'device-unlink-v1'

function send(socket: WebSocket, value: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
}

function attachment(socket: WebSocket) {
  return (socket as AttachedWebSocket).deserializeAttachment()
}

function latestSocketsByDevice(sockets: WebSocket[]) {
  const latest = new Map<string, { socket: WebSocket; attachment: SocketAttachment }>()
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.OPEN) continue
    const current = attachment(socket)
    if (!current) continue
    const existing = latest.get(current.deviceId)
    if (!existing || current.connectedAt >= existing.attachment.connectedAt) {
      latest.set(current.deviceId, { socket, attachment: current })
    }
  }
  return latest
}

export class RealtimeHub extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'POST' && request.headers.get('X-OACLIX-Internal-Control') === UNLINK_CONTROL) {
      return this.unlinkDevice(request)
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket requerido', { status: 426 })
    }

    const roomId = request.headers.get('X-OACLIX-Room-Id') ?? ''
    const personId = request.headers.get('X-OACLIX-Person-Id') ?? ''
    const deviceId = request.headers.get('X-OACLIX-Device-Id') ?? ''
    if (!ROOM_ID_PATTERN.test(roomId) || !PERSON_ID_PATTERN.test(personId) || !DEVICE_ID_PATTERN.test(deviceId)) {
      return new Response('Sesión inválida', { status: 400 })
    }

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE),
    )

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, AttachedWebSocket]
    const sessionId = crypto.randomUUID()
    const connectedAt = Date.now()
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ roomId, personId, deviceId, sessionId, connectedAt })
    send(server, { type: 'ready', deviceId, sessionId })
    await this.deliverPendingTransferRequests(server, personId, deviceId)
    this.broadcastPresence()

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': 'oaclix-v1' },
    } as ResponseInit & { webSocket: WebSocket })
  }

  async webSocketMessage(socket: AttachedWebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH) {
      socket.close(1009, 'Mensaje inválido')
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      socket.close(1003, 'JSON inválido')
      return
    }

    const current = socket.deserializeAttachment()
    if (!current) {
      socket.close(1008, 'Sesión inválida')
      return
    }

    const latest = latestSocketsByDevice(this.ctx.getWebSockets())
    const activeSender = latest.get(current.deviceId)
    if (!activeSender || activeSender.socket !== socket) return

    if (!parsed || typeof parsed !== 'object') return
    const input = parsed as Partial<SignalMessage> & { type?: unknown }

    if (input.type === 'ping') {
      send(socket, { type: 'pong' })
      return
    }

    if (input.type === 'cloud-change') {
      for (const [deviceId, target] of latest) {
        if (deviceId === current.deviceId) continue
        send(target.socket, { type: 'cloud-change', fromDeviceId: current.deviceId })
      }
      return
    }

    const control = parseTransferControlInput(parsed, current.deviceId)
    if (control) {
      const target = latest.get(control.targetDeviceId)
      const targetIsSamePerson = Boolean(target && target.attachment.personId === current.personId)

      if (control.message.type === 'transfer-request') {
        if (!transferControlRequestIsLive(control.message, Date.now())) return
        if (targetIsSamePerson && target) {
          send(target.socket, {
            type: 'transfer-control',
            fromDeviceId: current.deviceId,
            message: control.message,
          })
        } else if (!target) {
          await this.queuePendingTransferRequest(current, control.message)
        }
        return
      }

      if (control.message.type === 'transfer-cancel') {
        await this.resolvePendingTransferRequest(control.message, Date.now())
        if (targetIsSamePerson && target) {
          send(target.socket, {
            type: 'transfer-control',
            fromDeviceId: current.deviceId,
            message: control.message,
          })
        }
        return
      }

      if (!targetIsSamePerson || !target) return
      await this.resolvePendingTransferRequest(control.message, Date.now())
      send(target.socket, {
        type: 'transfer-control',
        fromDeviceId: current.deviceId,
        message: control.message,
      })
      return
    }

    const relay = parseDeviceRelayInput(parsed, current.deviceId)
    if (relay) {
      const target = latest.get(relay.targetDeviceId)
      if (!target || target.attachment.personId !== current.personId) return
      if (relay.type === 'device-transfer') {
        send(target.socket, {
          type: 'device-transfer',
          fromDeviceId: current.deviceId,
          transfer: relay.transfer,
        })
      } else if (relay.type === 'device-transfer-ack') {
        send(target.socket, {
          type: 'device-transfer-ack',
          fromDeviceId: current.deviceId,
          ack: relay.ack,
        })
      } else if (relay.type === 'device-image-transfer') {
        send(target.socket, {
          type: 'device-image-transfer',
          fromDeviceId: current.deviceId,
          transfer: relay.transfer,
        })
      } else {
        send(target.socket, {
          type: 'device-image-transfer-ack',
          fromDeviceId: current.deviceId,
          ack: relay.ack,
        })
      }
      return
    }

    if (input.type !== 'signal' || typeof input.targetDeviceId !== 'string' || !DEVICE_ID_PATTERN.test(input.targetDeviceId)) {
      return
    }

    const serializedSignal = JSON.stringify(input.signal)
    if (serializedSignal.length === 0 || serializedSignal.length > MAX_SIGNAL_LENGTH) return

    const latestTarget = latest.get(input.targetDeviceId)
    if (!latestTarget || latestTarget.attachment.personId !== current.personId) return
    send(latestTarget.socket, {
      type: 'signal',
      fromDeviceId: current.deviceId,
      fromSessionId: current.sessionId,
      signal: input.signal,
    })
  }

  webSocketClose() {
    this.broadcastPresence()
  }

  webSocketError() {
    this.broadcastPresence()
  }

  async alarm() {
    const now = Date.now()
    const pending = await this.readPendingTransferRequests(now)
    await this.writePendingTransferRequests(pending, now)
  }

  private async readPendingTransferRequests(now: number) {
    const stored = await this.ctx.storage.get<PendingTransferRequestRecord[]>(PENDING_TRANSFER_STORAGE_KEY)
    return normalizePendingTransferRequests(stored, now)
  }

  private async writePendingTransferRequests(pending: PendingTransferRequestRecord[], now: number) {
    const normalized = normalizePendingTransferRequests(pending, now)
    if (normalized.length === 0) {
      await this.ctx.storage.delete(PENDING_TRANSFER_STORAGE_KEY)
      await this.ctx.storage.deleteAlarm()
      return
    }

    await this.ctx.storage.put(PENDING_TRANSFER_STORAGE_KEY, normalized)
    const nextExpiry = nextPendingTransferExpiry(normalized, now)
    if (nextExpiry != null) await this.ctx.storage.setAlarm(nextExpiry)
  }

  private async queuePendingTransferRequest(current: SocketAttachment, message: TransferControlRequest) {
    const now = Date.now()
    const pending = await this.readPendingTransferRequests(now)
    const queued = queuePendingTransferRequest(pending, {
      personId: current.personId,
      fromDeviceId: current.deviceId,
      message,
    }, now)
    if (!queued.accepted) return
    await this.writePendingTransferRequests(queued.pending, now)
  }

  private async deliverPendingTransferRequests(socket: WebSocket, personId: string, deviceId: string) {
    const now = Date.now()
    const pending = await this.readPendingTransferRequests(now)
    for (const record of pendingTransferRequestsForDevice(pending, personId, deviceId, now)) {
      send(socket, {
        type: 'transfer-control',
        fromDeviceId: record.fromDeviceId,
        message: record.message,
      })
    }
    await this.writePendingTransferRequests(pending, now)
  }

  private async resolvePendingTransferRequest(
    message: { requestId: string; senderDeviceId: string; receiverDeviceId: string },
    now: number,
  ) {
    const pending = await this.readPendingTransferRequests(now)
    const remaining = removePendingTransferRequest(
      pending,
      message.requestId,
      message.senderDeviceId,
      message.receiverDeviceId,
      now,
    )
    if (remaining.length === pending.length) return
    await this.writePendingTransferRequests(remaining, now)
  }

  private async unlinkDevice(request: Request) {
    const deviceId = request.headers.get('X-OACLIX-Device-Id') ?? ''
    if (!DEVICE_ID_PATTERN.test(deviceId)) return new Response('Dispositivo inválido', { status: 400 })

    let closed = 0
    for (const socket of this.ctx.getWebSockets()) {
      const current = attachment(socket)
      if (!current || current.deviceId !== deviceId) continue
      if (socket.readyState < WebSocket.CLOSING) socket.close(4003, 'Dispositivo desvinculado')
      closed += 1
    }

    const now = Date.now()
    const pending = await this.readPendingTransferRequests(now)
    const remaining = removePendingTransferRequestsForDevice(pending, deviceId, now)
    await this.writePendingTransferRequests(remaining, now)

    this.broadcastPresence()
    return Response.json({ unlinked: true, closed })
  }

  private broadcastPresence() {
    const sockets = this.ctx.getWebSockets()
    const latest = latestSocketsByDevice(sockets)
    const peers = Array.from(latest.values()).map(({ attachment: current }) => ({
      deviceId: current.deviceId,
      sessionId: current.sessionId,
    }))
    const deviceIds = peers.map((peer) => peer.deviceId)

    for (const socket of sockets) send(socket, { type: 'presence', deviceIds, peers })
  }
}
