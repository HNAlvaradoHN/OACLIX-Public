import { signDeviceAction } from '../identity/deviceIdentity'
import { receiveLocalClipboardRelayTransfer } from '../transport/localClipboardRelayReceiver'
import { receiveLocalImageRelayTransfer } from '../transport/localImageRelayReceiver'
import { publishCloudConnectivity, publishCloudSyncHint } from './cloudSyncHintBus'
import {
  publishDeviceImageRelayAck,
  publishDeviceRelayAck,
  registerDeviceImageRelayAckSender,
  registerDeviceRelayAckSender,
  registerDeviceRelaySender,
} from './deviceRelayBus'
import {
  validLocalClipboardTransfer,
  validLocalClipboardTransferAck,
  type LocalClipboardTransfer,
  type LocalClipboardTransferAck,
} from './localClipboardTransfer'
import {
  validLocalImageTransfer,
  validLocalImageTransferAck,
  type LocalImageTransfer,
  type LocalImageTransferAck,
} from './localImageTransfer'
import {
  HEARTBEAT_RESPONSE_TIMEOUT_MS,
  heartbeatIdleDelay,
  type HeartbeatPhase,
} from './heartbeatPolicy'

export type RealtimeSignal =
  | {
      kind: 'description'
      negotiationId: string
      negotiationGeneration: number
      description: RTCSessionDescriptionInit
    }
  | {
      kind: 'candidate'
      negotiationId: string
      negotiationGeneration: number
      candidate: RTCIceCandidateInit
    }

export type RealtimePresencePeer = {
  deviceId: string
  sessionId: string
}

type SignalClientHandlers = {
  onReady?(deviceId: string): void
  onPresence?(peers: RealtimePresencePeer[]): void
  onSignal?(fromDeviceId: string, fromSessionId: string, signal: RealtimeSignal): void
  onCloudChange?(fromDeviceId: string): void
  onDeviceTransfer?(fromDeviceId: string, transfer: LocalClipboardTransfer): void
  onDeviceTransferAck?(fromDeviceId: string, ack: LocalClipboardTransferAck): void
  onDeviceImageTransfer?(fromDeviceId: string, transfer: LocalImageTransfer): void
  onDeviceImageTransferAck?(fromDeviceId: string, ack: LocalImageTransferAck): void
  onClose?(): void
}

type ServerMessage =
  | { type: 'ready'; deviceId: string; sessionId?: string }
  | { type: 'presence'; deviceIds: string[]; peers?: RealtimePresencePeer[] }
  | { type: 'signal'; fromDeviceId: string; fromSessionId: string; signal: RealtimeSignal }
  | { type: 'cloud-change'; fromDeviceId: string }
  | { type: 'device-transfer'; fromDeviceId: string; transfer: LocalClipboardTransfer }
  | { type: 'device-transfer-ack'; fromDeviceId: string; ack: LocalClipboardTransferAck }
  | { type: 'device-image-transfer'; fromDeviceId: string; transfer: LocalImageTransfer }
  | { type: 'device-image-transfer-ack'; fromDeviceId: string; ack: LocalImageTransferAck }
  | { type: 'pong' }

const CONNECT_TIMEOUT_MS = 8_000
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,96}$/
const NEGOTIATION_ID_PATTERN = /^[a-f0-9]{24}$/
const MAX_NEGOTIATION_GENERATION = 1_000_000_000
const HEARTBEAT_FRAME = JSON.stringify({ type: 'ping' })

function realtimeUrl(roomId: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(`${protocol}//${window.location.host}/api/realtime/connect`)
  url.searchParams.set('roomId', roomId)
  return url.toString()
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function isRealtimeSignal(value: unknown): value is RealtimeSignal {
  if (!value || typeof value !== 'object') return false
  const signal = value as {
    kind?: unknown
    negotiationId?: unknown
    negotiationGeneration?: unknown
    description?: unknown
    candidate?: unknown
  }
  if (typeof signal.negotiationId !== 'string' || !NEGOTIATION_ID_PATTERN.test(signal.negotiationId)) return false
  if (
    typeof signal.negotiationGeneration !== 'number'
    || !Number.isSafeInteger(signal.negotiationGeneration)
    || signal.negotiationGeneration <= 0
    || signal.negotiationGeneration > MAX_NEGOTIATION_GENERATION
  ) return false
  if (signal.kind === 'description') return Boolean(signal.description && typeof signal.description === 'object')
  if (signal.kind === 'candidate') return Boolean(signal.candidate && typeof signal.candidate === 'object')
  return false
}

function normalizePresence(message: Extract<ServerMessage, { type: 'presence' }>) {
  if (Array.isArray(message.peers)) {
    const peers = message.peers.filter((peer) => (
      peer
      && typeof peer === 'object'
      && DEVICE_ID_PATTERN.test(peer.deviceId)
      && SESSION_ID_PATTERN.test(peer.sessionId)
    ))
    if (peers.length > 0 || message.deviceIds.length === 0) return peers
  }

  return message.deviceIds
    .filter((deviceId) => DEVICE_ID_PATTERN.test(deviceId))
    .map((deviceId) => ({ deviceId, sessionId: `legacy-${deviceId}` }))
}

export class RealtimeSignalClient {
  private socket: WebSocket | null = null
  private readyDeviceId: string | null = null
  private connectPromise: Promise<string> | null = null
  private heartbeatTimer: number | null = null
  private heartbeatTimeout: number | null = null
  private heartbeatPhase: HeartbeatPhase = 'warming'

  constructor(private readonly roomId: string, private readonly handlers: SignalClientHandlers = {}) {
    registerDeviceRelaySender(roomId, (targetDeviceId, transfer) => this.sendDeviceTransfer(targetDeviceId, transfer))
    registerDeviceRelayAckSender(roomId, (targetDeviceId, ack) => this.sendDeviceTransferAck(targetDeviceId, ack))
    registerDeviceImageRelayAckSender(roomId, (targetDeviceId, ack) => this.sendDeviceImageTransferAck(targetDeviceId, ack))
  }

  connect() {
    if (this.readyDeviceId && this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.readyDeviceId)
    }
    if (this.connectPromise) return this.connectPromise

    publishCloudConnectivity(this.roomId, 'checking')
    const pending = this.openAuthenticatedSocket()
    this.connectPromise = pending
    void pending.finally(() => {
      if (this.connectPromise === pending) this.connectPromise = null
    }).catch(() => undefined)
    return pending
  }

  sendSignal(targetDeviceId: string, signal: RealtimeSignal) {
    if (!DEVICE_ID_PATTERN.test(targetDeviceId) || this.socket?.readyState !== WebSocket.OPEN || !this.readyDeviceId) {
      return false
    }
    this.socket.send(JSON.stringify({ type: 'signal', targetDeviceId, signal }))
    return true
  }

  sendDeviceTransfer(targetDeviceId: string, transfer: LocalClipboardTransfer) {
    if (
      !this.readyDeviceId
      || this.socket?.readyState !== WebSocket.OPEN
      || transfer.senderDeviceId !== this.readyDeviceId
      || transfer.receiverDeviceId !== targetDeviceId
      || !validLocalClipboardTransfer(transfer)
    ) return false
    this.socket.send(JSON.stringify({ type: 'device-transfer', targetDeviceId, transfer }))
    return true
  }

  sendDeviceTransferAck(targetDeviceId: string, ack: LocalClipboardTransferAck) {
    if (
      !this.readyDeviceId
      || this.socket?.readyState !== WebSocket.OPEN
      || ack.senderDeviceId !== targetDeviceId
      || ack.receiverDeviceId !== this.readyDeviceId
      || !validLocalClipboardTransferAck(ack)
    ) return false
    this.socket.send(JSON.stringify({ type: 'device-transfer-ack', targetDeviceId, ack }))
    return true
  }

  sendDeviceImageTransfer(targetDeviceId: string, transfer: LocalImageTransfer) {
    if (
      !this.readyDeviceId
      || this.socket?.readyState !== WebSocket.OPEN
      || transfer.senderDeviceId !== this.readyDeviceId
      || transfer.receiverDeviceId !== targetDeviceId
      || !validLocalImageTransfer(transfer)
    ) return false
    this.socket.send(JSON.stringify({ type: 'device-image-transfer', targetDeviceId, transfer }))
    return true
  }

  sendDeviceImageTransferAck(targetDeviceId: string, ack: LocalImageTransferAck) {
    if (
      !this.readyDeviceId
      || this.socket?.readyState !== WebSocket.OPEN
      || ack.senderDeviceId !== targetDeviceId
      || ack.receiverDeviceId !== this.readyDeviceId
      || !validLocalImageTransferAck(ack)
    ) return false
    this.socket.send(JSON.stringify({ type: 'device-image-transfer-ack', targetDeviceId, ack }))
    return true
  }

  notifyCloudChange() {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.readyDeviceId) return false
    this.socket.send(JSON.stringify({ type: 'cloud-change' }))
    return true
  }

  disconnect() {
    this.stopHeartbeat()
    this.readyDeviceId = null
    const socket = this.socket
    this.socket = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Pausa')
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer != null) window.clearTimeout(this.heartbeatTimer)
    if (this.heartbeatTimeout != null) window.clearTimeout(this.heartbeatTimeout)
    this.heartbeatTimer = null
    this.heartbeatTimeout = null
    this.heartbeatPhase = 'warming'
  }

  private scheduleHeartbeat(socket: WebSocket, onDead: () => void) {
    if (this.socket !== socket || !this.readyDeviceId) return
    if (this.heartbeatTimer != null) window.clearTimeout(this.heartbeatTimer)

    const delay = heartbeatIdleDelay(this.heartbeatPhase)
    this.heartbeatTimer = window.setTimeout(() => {
      this.heartbeatTimer = null
      if (this.socket !== socket || !this.readyDeviceId) return
      if (socket.readyState !== WebSocket.OPEN) {
        onDead()
        return
      }
      if (this.heartbeatTimeout != null) return

      try {
        socket.send(HEARTBEAT_FRAME)
      } catch {
        onDead()
        return
      }

      this.heartbeatTimeout = window.setTimeout(() => {
        this.heartbeatTimeout = null
        if (this.socket === socket) onDead()
      }, HEARTBEAT_RESPONSE_TIMEOUT_MS)
    }, delay)
  }

  private startHeartbeat(socket: WebSocket, onDead: () => void) {
    this.stopHeartbeat()
    this.scheduleHeartbeat(socket, onDead)
  }

  private markHeartbeatAlive(socket: WebSocket, onDead: () => void) {
    if (this.socket !== socket || !this.readyDeviceId) return
    if (this.heartbeatTimeout != null) window.clearTimeout(this.heartbeatTimeout)
    this.heartbeatTimeout = null
    this.heartbeatPhase = 'stable'
    this.scheduleHeartbeat(socket, onDead)
  }

  private async openAuthenticatedSocket() {
    const envelope = await signDeviceAction('realtime.connect', { roomId: this.roomId })
    const authProtocol = `oaclix-auth-${toBase64Url(JSON.stringify(envelope))}`

    return new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(realtimeUrl(this.roomId), ['oaclix-v1', authProtocol])
      this.socket = socket
      let settled = false
      let closeNotified = false

      const notifyClosed = () => {
        if (closeNotified) return
        closeNotified = true
        this.handlers.onClose?.()
      }

      const invalidateLiveSocket = () => {
        if (this.socket !== socket) return
        this.stopHeartbeat()
        this.readyDeviceId = null
        this.socket = null
        publishCloudConnectivity(this.roomId, 'offline')
        notifyClosed()
        if (socket.readyState < WebSocket.CLOSING) {
          try { socket.close(4000, 'Canal sin respuesta') } catch { /* noop */ }
        }
      }

      const timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        if (this.socket === socket) {
          this.socket = null
          this.readyDeviceId = null
          publishCloudConnectivity(this.roomId, 'offline')
        }
        try { socket.close() } catch { /* noop */ }
        reject(new Error('Tiempo real no disponible'))
      }, CONNECT_TIMEOUT_MS)

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        this.stopHeartbeat()
        if (this.socket === socket) {
          this.socket = null
          this.readyDeviceId = null
          publishCloudConnectivity(this.roomId, 'offline')
        }
        reject(error)
      }

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        let message: ServerMessage
        try {
          message = JSON.parse(event.data) as ServerMessage
        } catch {
          return
        }

        if (message.type === 'ready' && DEVICE_ID_PATTERN.test(message.deviceId)) {
          this.readyDeviceId = message.deviceId
          this.startHeartbeat(socket, invalidateLiveSocket)
          if (!settled) {
            settled = true
            window.clearTimeout(timeout)
            resolve(message.deviceId)
          }
          publishCloudConnectivity(this.roomId, 'online')
          publishCloudSyncHint(this.roomId)
          this.handlers.onReady?.(message.deviceId)
          return
        }

        this.markHeartbeatAlive(socket, invalidateLiveSocket)

        if (message.type === 'pong') return

        if (message.type === 'presence' && Array.isArray(message.deviceIds)) {
          this.handlers.onPresence?.(normalizePresence(message))
          return
        }

        if (
          message.type === 'signal'
          && DEVICE_ID_PATTERN.test(message.fromDeviceId)
          && SESSION_ID_PATTERN.test(message.fromSessionId)
          && isRealtimeSignal(message.signal)
        ) {
          this.handlers.onSignal?.(message.fromDeviceId, message.fromSessionId, message.signal)
          return
        }

        if (message.type === 'cloud-change' && DEVICE_ID_PATTERN.test(message.fromDeviceId)) {
          this.handlers.onCloudChange?.(message.fromDeviceId)
          return
        }

        if (
          message.type === 'device-transfer'
          && this.readyDeviceId
          && DEVICE_ID_PATTERN.test(message.fromDeviceId)
          && validLocalClipboardTransfer(message.transfer)
          && message.transfer.senderDeviceId === message.fromDeviceId
          && message.transfer.receiverDeviceId === this.readyDeviceId
        ) {
          void receiveLocalClipboardRelayTransfer(this.roomId, message.transfer, message.fromDeviceId)
            .catch(() => undefined)
          this.handlers.onDeviceTransfer?.(message.fromDeviceId, message.transfer)
          return
        }

        if (
          message.type === 'device-transfer-ack'
          && this.readyDeviceId
          && DEVICE_ID_PATTERN.test(message.fromDeviceId)
          && validLocalClipboardTransferAck(message.ack)
          && message.ack.receiverDeviceId === message.fromDeviceId
          && message.ack.senderDeviceId === this.readyDeviceId
        ) {
          publishDeviceRelayAck(this.roomId, message.ack, message.fromDeviceId)
          this.handlers.onDeviceTransferAck?.(message.fromDeviceId, message.ack)
          return
        }

        if (
          message.type === 'device-image-transfer'
          && this.readyDeviceId
          && DEVICE_ID_PATTERN.test(message.fromDeviceId)
          && validLocalImageTransfer(message.transfer)
          && message.transfer.senderDeviceId === message.fromDeviceId
          && message.transfer.receiverDeviceId === this.readyDeviceId
        ) {
          void receiveLocalImageRelayTransfer(this.roomId, message.transfer, message.fromDeviceId)
            .catch(() => undefined)
          this.handlers.onDeviceImageTransfer?.(message.fromDeviceId, message.transfer)
          return
        }

        if (
          message.type === 'device-image-transfer-ack'
          && this.readyDeviceId
          && DEVICE_ID_PATTERN.test(message.fromDeviceId)
          && validLocalImageTransferAck(message.ack)
          && message.ack.receiverDeviceId === message.fromDeviceId
          && message.ack.senderDeviceId === this.readyDeviceId
        ) {
          publishDeviceImageRelayAck(this.roomId, message.ack, message.fromDeviceId)
          this.handlers.onDeviceImageTransferAck?.(message.fromDeviceId, message.ack)
        }
      }

      socket.onerror = () => {
        if (!settled) fail(new Error('No se pudo abrir el canal directo'))
        else invalidateLiveSocket()
      }
      socket.onclose = () => {
        this.stopHeartbeat()
        const wasCurrent = this.socket === socket
        if (wasCurrent) {
          this.readyDeviceId = null
          this.socket = null
          publishCloudConnectivity(this.roomId, 'offline')
        }
        if (!settled) fail(new Error('Canal directo cerrado'))
        else if (wasCurrent) notifyClosed()
      }
    })
  }
}
