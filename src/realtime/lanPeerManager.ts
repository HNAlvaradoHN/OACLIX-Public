import {
  publishLanClipboardChange,
  validLanClipboardChange,
  type LanClipboardChange,
} from './lanClipboardBus'
import {
  publishLanDirectFirstPrepAck,
  validLanDirectFirstPrepAck,
  type LanDirectFirstPrepAck,
} from './lanDirectFirstPrep'
import { publishCloudSyncHint } from './cloudSyncHintBus'
import {
  localDirectCapabilities,
  resolveRemoteDirectCapabilities,
  validDirectCapabilities,
  type DirectCapability,
} from './directCapabilities'
import {
  clearRealtimePresence,
  publishDirectLanPeerIds,
  publishLanPeerDiagnostic,
  publishRealtimePresence,
} from './lanStatus'
import {
  publishLanLocalClipboardTransfer,
  publishLanLocalClipboardTransferAck,
  registerLocalClipboardDirectSender,
  validLocalClipboardTransfer,
  validLocalClipboardTransferAck,
  type LocalClipboardTransfer,
  type LocalClipboardTransferAck,
} from './localClipboardTransfer'
import {
  createLocalImageDirectTransferAck,
  expectedDirectImageChunkBytes,
  publishLanLocalImageDirectTransfer,
  publishLanLocalImageDirectTransferAck,
  registerLocalImageDirectSender,
  validLocalImageDirectTransfer,
  validLocalImageDirectTransferAck,
  type LocalImageDirectTransfer,
  type LocalImageDirectTransferAck,
} from './localImageDirectTransfer'
import {
  RealtimeSignalClient,
  type RealtimePresencePeer,
  type RealtimeSignal,
} from './signalClient'

type PeerState = {
  connection: RTCPeerConnection
  channel: RTCDataChannel | null
  queuedCandidates: RTCIceCandidateInit[]
  offered: boolean
  probeToken: string | null
  validated: boolean
  capabilities: Set<DirectCapability>
  sessionId: string
  negotiationId: string
  negotiationGeneration: number
  localCandidates: number
  remoteCandidates: number
}

type AcceptedRemoteNegotiation = {
  sessionId: string
  negotiationId: string
  generation: number
}

type IncomingDirectImage = {
  transfer: LocalImageDirectTransfer
  chunks: ArrayBuffer[]
  receivedBytes: number
  receivedChunks: number
}

type DirectMessage =
  | { type: 'probe'; token: string; capabilities?: DirectCapability[] }
  | { type: 'probe-ack'; token: string; capabilities?: DirectCapability[] }
  | { type: 'clipboard-change'; change: LanClipboardChange }
  | { type: 'direct-first-ack'; ack: LanDirectFirstPrepAck }
  | { type: 'local-clipboard-transfer'; transfer: LocalClipboardTransfer }
  | { type: 'local-clipboard-transfer-ack'; ack: LocalClipboardTransferAck }
  | { type: 'local-image-direct-start'; transfer: LocalImageDirectTransfer }
  | { type: 'local-image-direct-ack'; ack: LocalImageDirectTransferAck }

type NavigatorWithConnection = Navigator & {
  connection?: EventTarget
}

const RETRY_AFTER_MS = 30_000
const SIGNAL_RECONNECT_DELAY_MS = 4_000
const NETWORK_RESTART_DELAY_MS = 350
const DIRECT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 20_000, 60_000] as const
const IMAGE_BUFFER_HIGH_WATER_BYTES = 1 * 1024 * 1024
const IMAGE_BUFFER_LOW_WATER_BYTES = 256 * 1024
const IMAGE_BUFFER_WAIT_MS = 15_000
const IMAGE_CHUNKS_PER_READ = 16

function randomToken() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function isDirectMessage(value: unknown): value is DirectMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as {
    type?: unknown
    token?: unknown
    change?: unknown
    ack?: unknown
    transfer?: unknown
    capabilities?: unknown
  }
  if (message.type === 'clipboard-change') return validLanClipboardChange(message.change)
  if (message.type === 'direct-first-ack') return validLanDirectFirstPrepAck(message.ack)
  if (message.type === 'local-clipboard-transfer') return validLocalClipboardTransfer(message.transfer)
  if (message.type === 'local-clipboard-transfer-ack') return validLocalClipboardTransferAck(message.ack)
  if (message.type === 'local-image-direct-start') return validLocalImageDirectTransfer(message.transfer)
  if (message.type === 'local-image-direct-ack') return validLocalImageDirectTransferAck(message.ack)
  return (message.type === 'probe' || message.type === 'probe-ack')
    && typeof message.token === 'string'
    && /^[a-f0-9]{24}$/.test(message.token)
    && validDirectCapabilities(message.capabilities)
}

export class LanPeerManager {
  private signalClient: RealtimeSignalClient | null = null
  private ownDeviceId: string | null = null
  private peers = new Map<string, PeerState>()
  private remoteSessions = new Map<string, string>()
  private started = false
  private parked = false
  private lastConnectAttemptAt = 0
  private reconnectTimer: number | null = null
  private networkRestartTimer: number | null = null
  private networkInformation: EventTarget | null = null
  private directRetryTimers = new Map<string, number>()
  private directRetryAttempts = new Map<string, number>()
  private nextNegotiationGenerations = new Map<string, number>()
  private acceptedRemoteNegotiations = new Map<string, AcceptedRemoteNegotiation>()
  private incomingDirectImages = new Map<string, IncomingDirectImage>()
  private sendingDirectImagePeers = new Set<string>()
  private readonly roomId: string

  constructor(roomId: string) {
    this.roomId = roomId
    registerLocalClipboardDirectSender(roomId, this)
    registerLocalImageDirectSender(roomId, this)
  }

  start() {
    if (this.started) return
    this.started = true
    this.parked = false
    this.lastConnectAttemptAt = 0
    document.addEventListener('visibilitychange', this.handleVisibility)
    window.addEventListener('online', this.handleNetworkChange)
    this.networkInformation = (navigator as NavigatorWithConnection).connection ?? null
    this.networkInformation?.addEventListener('change', this.handleNetworkChange)
    this.poke()
  }

  poke() {
    if (!this.started || document.visibilityState !== 'visible' || this.signalClient) return
    if (Date.now() - this.lastConnectAttemptAt < RETRY_AFTER_MS) return
    this.lastConnectAttemptAt = Date.now()
    this.connectSignalClient()
  }

  stop() {
    if (!this.started && !this.parked) return
    const preserveValidatedDirect = this.started && this.getValidatedPeerIds().length > 0
    this.started = false
    window.removeEventListener('online', this.handleNetworkChange)
    this.networkInformation?.removeEventListener('change', this.handleNetworkChange)
    this.networkInformation = null
    if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer)
    if (this.networkRestartTimer != null) window.clearTimeout(this.networkRestartTimer)
    this.reconnectTimer = null
    this.networkRestartTimer = null
    this.clearAllDirectRetries()

    if (preserveValidatedDirect) {
      this.parked = true
      const remoteDeviceIds = Array.from(this.remoteSessions.keys())
      this.signalClient?.disconnect()
      this.signalClient = null
      clearRealtimePresence(this.roomId)
      for (const [remoteDeviceId, peer] of Array.from(this.peers.entries())) {
        if (!peer.validated || peer.channel?.readyState !== 'open') this.dropPeer(remoteDeviceId, peer)
      }
      this.refreshPublishedStatus()
      for (const remoteDeviceId of remoteDeviceIds) this.publishDiagnostic(remoteDeviceId, 'direct-parked')
      return
    }

    this.parked = false
    document.removeEventListener('visibilitychange', this.handleVisibility)
    this.suspend()
  }

  getValidatedPeerIds() {
    return Array.from(this.peers.entries())
      .filter(([, peer]) => (
        peer.validated
        && peer.channel?.readyState === 'open'
        && peer.capabilities.has('room-core')
      ))
      .map(([deviceId]) => deviceId)
  }

  getImageDirectPeerIds() {
    return Array.from(this.peers.entries())
      .filter(([, peer]) => (
        peer.validated
        && peer.channel?.readyState === 'open'
        && peer.capabilities.has('image-direct')
      ))
      .map(([deviceId]) => deviceId)
  }

  hasCloudFallbackPeers() {
    for (const remoteDeviceId of this.remoteSessions.keys()) {
      const peer = this.peers.get(remoteDeviceId)
      if (
        !peer?.validated
        || peer.channel?.readyState !== 'open'
        || !peer.capabilities.has('room-core')
      ) return true
    }
    return false
  }

  notifyCloudFallbackChange() {
    if (!this.hasCloudFallbackPeers()) return
    if (this.signalClient?.notifyCloudChange()) return

    this.lastConnectAttemptAt = 0
    this.poke()
    const client = this.signalClient
    if (!client) return
    void client.connect()
      .then(() => { client.notifyCloudChange() })
      .catch(() => undefined)
  }

  broadcastClipboardChange(change: LanClipboardChange) {
    if (!validLanClipboardChange(change)) return 0
    const serialized = JSON.stringify({ type: 'clipboard-change', change } satisfies DirectMessage)
    let delivered = 0

    for (const peer of this.peers.values()) {
      if (
        !peer.validated
        || peer.channel?.readyState !== 'open'
        || !peer.capabilities.has('room-core')
      ) continue
      peer.channel.send(serialized)
      delivered += 1
    }

    return delivered
  }

  sendClipboardChangeToPeer(remoteDeviceId: string, change: LanClipboardChange) {
    if (!validLanClipboardChange(change)) return false
    const peer = this.peers.get(remoteDeviceId)
    if (
      !peer?.validated
      || peer.channel?.readyState !== 'open'
      || !peer.capabilities.has('room-core')
    ) return false
    peer.channel.send(JSON.stringify({ type: 'clipboard-change', change } satisfies DirectMessage))
    return true
  }

  sendLocalClipboardTransfer(remoteDeviceId: string, transfer: LocalClipboardTransfer) {
    if (
      !this.ownDeviceId
      || !validLocalClipboardTransfer(transfer)
      || transfer.senderDeviceId !== this.ownDeviceId
      || transfer.receiverDeviceId !== remoteDeviceId
    ) return false
    const peer = this.peers.get(remoteDeviceId)
    if (
      !peer?.validated
      || peer.channel?.readyState !== 'open'
      || !peer.capabilities.has('room-core')
    ) return false
    peer.channel.send(JSON.stringify({ type: 'local-clipboard-transfer', transfer } satisfies DirectMessage))
    return true
  }

  sendLocalClipboardTransferAck(remoteDeviceId: string, ack: LocalClipboardTransferAck) {
    if (
      !this.ownDeviceId
      || !validLocalClipboardTransferAck(ack)
      || ack.senderDeviceId !== remoteDeviceId
      || ack.receiverDeviceId !== this.ownDeviceId
    ) return false
    const peer = this.peers.get(remoteDeviceId)
    if (
      !peer?.validated
      || peer.channel?.readyState !== 'open'
      || !peer.capabilities.has('room-core')
    ) return false
    peer.channel.send(JSON.stringify({ type: 'local-clipboard-transfer-ack', ack } satisfies DirectMessage))
    return true
  }

  async sendLocalImageDirect(remoteDeviceId: string, transfer: LocalImageDirectTransfer, blob: Blob) {
    if (
      !this.ownDeviceId
      || !validLocalImageDirectTransfer(transfer)
      || transfer.senderDeviceId !== this.ownDeviceId
      || transfer.receiverDeviceId !== remoteDeviceId
      || blob.size !== transfer.item.byteSize
      || blob.type !== transfer.item.mimeType
      || this.sendingDirectImagePeers.has(remoteDeviceId)
    ) return false

    const peer = this.peers.get(remoteDeviceId)
    const channel = peer?.channel
    if (
      !peer?.validated
      || !channel
      || channel.readyState !== 'open'
      || !peer.capabilities.has('image-direct')
    ) return false

    this.sendingDirectImagePeers.add(remoteDeviceId)
    try {
      channel.send(JSON.stringify({ type: 'local-image-direct-start', transfer } satisfies DirectMessage))
      for (let chunkBase = 0; chunkBase < transfer.chunkCount; chunkBase += IMAGE_CHUNKS_PER_READ) {
        const windowStart = chunkBase * transfer.chunkSize
        const windowEnd = Math.min(
          (chunkBase + IMAGE_CHUNKS_PER_READ) * transfer.chunkSize,
          blob.size,
        )
        const windowBuffer = await blob.slice(windowStart, windowEnd).arrayBuffer()
        if (windowBuffer.byteLength !== windowEnd - windowStart) return false

        const windowChunkCount = Math.min(IMAGE_CHUNKS_PER_READ, transfer.chunkCount - chunkBase)
        for (let windowChunkIndex = 0; windowChunkIndex < windowChunkCount; windowChunkIndex += 1) {
          const chunkIndex = chunkBase + windowChunkIndex
          const expectedBytes = expectedDirectImageChunkBytes(transfer, chunkIndex)
          const chunkOffset = windowChunkIndex * transfer.chunkSize
          if (expectedBytes <= 0 || chunkOffset + expectedBytes > windowBuffer.byteLength) return false
          if (!await this.waitForImageBuffer(remoteDeviceId, peer, channel)) return false
          if (this.peers.get(remoteDeviceId) !== peer || !peer.validated || channel.readyState !== 'open') return false
          const chunk = new Uint8Array(windowBuffer, chunkOffset, expectedBytes)
          channel.send(chunk)
        }
      }
      return true
    } finally {
      this.sendingDirectImagePeers.delete(remoteDeviceId)
    }
  }

  sendLocalImageDirectAck(remoteDeviceId: string, ack: LocalImageDirectTransferAck) {
    if (
      !this.ownDeviceId
      || !validLocalImageDirectTransferAck(ack)
      || ack.senderDeviceId !== remoteDeviceId
      || ack.receiverDeviceId !== this.ownDeviceId
    ) return false
    const peer = this.peers.get(remoteDeviceId)
    if (
      !peer?.validated
      || peer.channel?.readyState !== 'open'
      || !peer.capabilities.has('image-direct')
    ) return false
    peer.channel.send(JSON.stringify({ type: 'local-image-direct-ack', ack } satisfies DirectMessage))
    return true
  }

  sendDirectFirstPrepAck(remoteDeviceId: string, ack: LanDirectFirstPrepAck) {
    if (!validLanDirectFirstPrepAck(ack) || ack.authorDeviceId !== remoteDeviceId) return false
    const peer = this.peers.get(remoteDeviceId)
    if (
      !peer?.validated
      || peer.channel?.readyState !== 'open'
      || !peer.capabilities.has('room-core')
    ) return false
    peer.channel.send(JSON.stringify({ type: 'direct-first-ack', ack } satisfies DirectMessage))
    return true
  }

  private waitForImageBuffer(remoteDeviceId: string, peer: PeerState, channel: RTCDataChannel) {
    if (channel.bufferedAmount <= IMAGE_BUFFER_HIGH_WATER_BYTES) return Promise.resolve(true)
    channel.bufferedAmountLowThreshold = IMAGE_BUFFER_LOW_WATER_BYTES
    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (ready: boolean) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        channel.removeEventListener('bufferedamountlow', handleLow)
        channel.removeEventListener('close', handleClose)
        channel.removeEventListener('error', handleClose)
        resolve(ready)
      }
      const handleLow = () => finish(
        this.peers.get(remoteDeviceId) === peer
        && peer.validated
        && channel.readyState === 'open',
      )
      const handleClose = () => finish(false)
      const timer = window.setTimeout(() => finish(false), IMAGE_BUFFER_WAIT_MS)
      channel.addEventListener('bufferedamountlow', handleLow)
      channel.addEventListener('close', handleClose)
      channel.addEventListener('error', handleClose)
    })
  }

  private rejectIncomingImage(remoteDeviceId: string, transfer: LocalImageDirectTransfer) {
    this.incomingDirectImages.delete(remoteDeviceId)
    this.sendLocalImageDirectAck(
      remoteDeviceId,
      createLocalImageDirectTransferAck(transfer, 'rejected'),
    )
  }

  private receiveImageChunk(remoteDeviceId: string, peer: PeerState, data: ArrayBuffer) {
    if (
      !peer.validated
      || !peer.capabilities.has('image-direct')
      || this.peers.get(remoteDeviceId) !== peer
    ) return
    const incoming = this.incomingDirectImages.get(remoteDeviceId)
    if (!incoming) return

    const expected = expectedDirectImageChunkBytes(incoming.transfer, incoming.receivedChunks)
    if (expected <= 0 || data.byteLength !== expected) {
      this.rejectIncomingImage(remoteDeviceId, incoming.transfer)
      return
    }

    incoming.chunks.push(data)
    incoming.receivedBytes += data.byteLength
    incoming.receivedChunks += 1
    if (incoming.receivedBytes > incoming.transfer.item.byteSize) {
      this.rejectIncomingImage(remoteDeviceId, incoming.transfer)
      return
    }
    if (incoming.receivedChunks < incoming.transfer.chunkCount) return
    if (incoming.receivedBytes !== incoming.transfer.item.byteSize) {
      this.rejectIncomingImage(remoteDeviceId, incoming.transfer)
      return
    }

    this.incomingDirectImages.delete(remoteDeviceId)
    const blob = new Blob(incoming.chunks, { type: incoming.transfer.item.mimeType })
    publishLanLocalImageDirectTransfer(
      this.roomId,
      { transfer: incoming.transfer, blob },
      remoteDeviceId,
    )
  }

  private refreshPublishedStatus() {
    publishDirectLanPeerIds(this.roomId, this.getValidatedPeerIds())
  }

  private publishDiagnostic(remoteDeviceId: string, lastEvent: string) {
    const peer = this.peers.get(remoteDeviceId)
    const ownDeviceId = this.ownDeviceId
    const sessionId = this.remoteSessions.get(remoteDeviceId) ?? peer?.sessionId ?? ''
    const role = !ownDeviceId
      ? 'unknown'
      : ownDeviceId.localeCompare(remoteDeviceId) < 0 ? 'initiator' : 'responder'
    const negotiationSuffix = peer
      ? `${peer.negotiationGeneration}/${peer.negotiationId.slice(-6).toUpperCase()}`
      : '—'

    publishLanPeerDiagnostic(this.roomId, remoteDeviceId, {
      signaling: this.signalClient ? (ownDeviceId ? 'ready' : 'connecting') : 'closed',
      role,
      present: this.remoteSessions.has(remoteDeviceId),
      peerExists: Boolean(peer),
      connectionState: peer?.connection.connectionState ?? 'none',
      iceConnectionState: peer?.connection.iceConnectionState ?? 'none',
      iceGatheringState: peer?.connection.iceGatheringState ?? 'none',
      signalingState: peer?.connection.signalingState ?? 'none',
      channelState: peer?.channel?.readyState ?? 'none',
      validated: Boolean(peer?.validated),
      localCandidates: peer?.localCandidates ?? 0,
      remoteCandidates: peer?.remoteCandidates ?? 0,
      retryAttempt: this.directRetryAttempts.get(remoteDeviceId) ?? 0,
      sessionSuffix: sessionId ? sessionId.slice(-6).toUpperCase() : '—',
      negotiationSuffix,
      lastEvent,
      updatedAt: Date.now(),
    })
  }

  private readonly handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      this.lastConnectAttemptAt = 0
      this.poke()
    } else if (this.parked) {
      this.stop()
    } else {
      this.suspend()
    }
  }

  private readonly handleNetworkChange = () => {
    if (!this.started || document.visibilityState !== 'visible') return
    if (this.networkRestartTimer != null) window.clearTimeout(this.networkRestartTimer)
    this.networkRestartTimer = window.setTimeout(() => {
      this.networkRestartTimer = null
      if (!this.started || document.visibilityState !== 'visible') return
      this.restartSignalClientPreservingDirect()
    }, NETWORK_RESTART_DELAY_MS)
  }

  private restartSignalClientPreservingDirect() {
    const remoteDeviceIds = Array.from(this.remoteSessions.keys())
    const client = this.signalClient
    this.signalClient = null
    client?.disconnect()
    clearRealtimePresence(this.roomId)
    this.clearAllDirectRetries()
    for (const remoteDeviceId of remoteDeviceIds) {
      this.publishDiagnostic(remoteDeviceId, 'network-signal-restart')
    }
    this.lastConnectAttemptAt = 0
    this.poke()
  }

  private scheduleSignalReconnect() {
    if (!this.started || document.visibilityState !== 'visible' || this.reconnectTimer != null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.lastConnectAttemptAt = 0
      this.poke()
    }, SIGNAL_RECONNECT_DELAY_MS)
  }

  private clearDirectRetry(remoteDeviceId: string) {
    const timer = this.directRetryTimers.get(remoteDeviceId)
    if (timer != null) window.clearTimeout(timer)
    this.directRetryTimers.delete(remoteDeviceId)
    this.directRetryAttempts.delete(remoteDeviceId)
  }

  private clearAllDirectRetries() {
    for (const timer of this.directRetryTimers.values()) window.clearTimeout(timer)
    this.directRetryTimers.clear()
    this.directRetryAttempts.clear()
  }

  private nextNegotiationGeneration(remoteDeviceId: string) {
    const next = (this.nextNegotiationGenerations.get(remoteDeviceId) ?? 0) + 1
    this.nextNegotiationGenerations.set(remoteDeviceId, next)
    return next
  }

  private acceptRemoteNegotiation(
    remoteDeviceId: string,
    sessionId: string,
    negotiationId: string,
    generation: number,
  ) {
    const accepted = this.acceptedRemoteNegotiations.get(remoteDeviceId)
    if (accepted && accepted.sessionId !== sessionId) {
      this.acceptedRemoteNegotiations.delete(remoteDeviceId)
    }

    const current = this.acceptedRemoteNegotiations.get(remoteDeviceId)
    if (current) {
      if (generation < current.generation) return false
      if (generation === current.generation && negotiationId !== current.negotiationId) return false
    }

    if (!current || generation > current.generation) {
      this.acceptedRemoteNegotiations.set(remoteDeviceId, {
        sessionId,
        negotiationId,
        generation,
      })
    }
    return true
  }

  private scheduleDirectRetry(remoteDeviceId: string) {
    const ownDeviceId = this.ownDeviceId
    if (
      !this.started
      || document.visibilityState !== 'visible'
      || !this.signalClient
      || !ownDeviceId
      || ownDeviceId.localeCompare(remoteDeviceId) >= 0
      || !this.remoteSessions.has(remoteDeviceId)
      || this.directRetryTimers.has(remoteDeviceId)
    ) return

    const current = this.peers.get(remoteDeviceId)
    if (current?.validated && current.channel?.readyState === 'open') {
      this.clearDirectRetry(remoteDeviceId)
      return
    }

    const attempt = this.directRetryAttempts.get(remoteDeviceId) ?? 0
    const delay = DIRECT_RETRY_DELAYS_MS[Math.min(attempt, DIRECT_RETRY_DELAYS_MS.length - 1)]
    this.publishDiagnostic(remoteDeviceId, `retry-wait-${Math.round(delay / 1000)}s`)

    const timer = window.setTimeout(() => {
      this.directRetryTimers.delete(remoteDeviceId)
      if (!this.started || document.visibilityState !== 'visible' || !this.signalClient) return

      const sessionId = this.remoteSessions.get(remoteDeviceId)
      const ownId = this.ownDeviceId
      if (!sessionId || !ownId || ownId.localeCompare(remoteDeviceId) >= 0) return

      const existing = this.peers.get(remoteDeviceId)
      if (existing?.validated && existing.channel?.readyState === 'open') {
        this.clearDirectRetry(remoteDeviceId)
        this.publishDiagnostic(remoteDeviceId, 'direct-ready')
        return
      }
      if (existing) this.dropPeer(remoteDeviceId, existing)

      this.directRetryAttempts.set(remoteDeviceId, attempt + 1)
      this.publishDiagnostic(remoteDeviceId, `retry-${attempt + 1}`)
      void this.offerTo(remoteDeviceId, sessionId)
    }, delay)
    this.directRetryTimers.set(remoteDeviceId, timer)
  }

  private connectSignalClient() {
    const client = new RealtimeSignalClient(this.roomId, {
      onReady: (deviceId) => {
        this.ownDeviceId = deviceId
        for (const remoteDeviceId of this.remoteSessions.keys()) this.publishDiagnostic(remoteDeviceId, 'signal-ready')
      },
      onPresence: (peers) => {
        publishRealtimePresence(this.roomId, peers.map((peer) => peer.deviceId))
        void this.handlePresence(peers)
      },
      onSignal: (fromDeviceId, fromSessionId, signal) => {
        void this.handleSignal(fromDeviceId, fromSessionId, signal)
      },
      onCloudChange: () => { publishCloudSyncHint(this.roomId) },
      onClose: () => {
        if (this.signalClient !== client) return
        const remoteDeviceIds = Array.from(this.remoteSessions.keys())
        this.signalClient = null
        clearRealtimePresence(this.roomId)
        this.clearAllDirectRetries()
        for (const remoteDeviceId of remoteDeviceIds) this.publishDiagnostic(remoteDeviceId, 'signal-closed')
        this.scheduleSignalReconnect()
      },
    })
    this.signalClient = client
    void client.connect().catch(() => {
      if (this.signalClient !== client) return
      const remoteDeviceIds = Array.from(this.remoteSessions.keys())
      this.signalClient = null
      clearRealtimePresence(this.roomId)
      this.clearAllDirectRetries()
      for (const remoteDeviceId of remoteDeviceIds) this.publishDiagnostic(remoteDeviceId, 'signal-error')
      this.scheduleSignalReconnect()
    })
  }

  private suspend() {
    const remoteDeviceIds = Array.from(this.remoteSessions.keys())
    this.clearAllDirectRetries()
    this.signalClient?.disconnect()
    this.signalClient = null
    this.ownDeviceId = null
    clearRealtimePresence(this.roomId)
    for (const [remoteDeviceId, peer] of Array.from(this.peers.entries())) {
      this.dropPeer(remoteDeviceId, peer)
    }
    this.remoteSessions.clear()
    this.acceptedRemoteNegotiations.clear()
    this.nextNegotiationGenerations.clear()
    this.incomingDirectImages.clear()
    this.sendingDirectImagePeers.clear()
    this.refreshPublishedStatus()
    for (const remoteDeviceId of remoteDeviceIds) this.publishDiagnostic(remoteDeviceId, 'suspended')
  }

  private async handlePresence(presencePeers: RealtimePresencePeer[]) {
    const ownDeviceId = this.ownDeviceId
    if (!ownDeviceId) return

    const previousDeviceIds = Array.from(this.remoteSessions.keys())
    const presentSessions = new Map<string, string>()
    for (const peer of presencePeers) {
      if (peer.deviceId !== ownDeviceId) presentSessions.set(peer.deviceId, peer.sessionId)
    }

    for (const [remoteDeviceId, previousSessionId] of this.remoteSessions) {
      const nextSessionId = presentSessions.get(remoteDeviceId)
      if (!nextSessionId || nextSessionId !== previousSessionId) {
        this.clearDirectRetry(remoteDeviceId)
        this.acceptedRemoteNegotiations.delete(remoteDeviceId)
      }
    }

    for (const [remoteDeviceId, peer] of Array.from(this.peers.entries())) {
      const nextSessionId = presentSessions.get(remoteDeviceId)
      if (!nextSessionId || nextSessionId !== peer.sessionId) {
        this.dropPeer(remoteDeviceId, peer)
      }
    }

    this.remoteSessions = presentSessions

    for (const remoteDeviceId of previousDeviceIds) {
      if (!presentSessions.has(remoteDeviceId)) this.publishDiagnostic(remoteDeviceId, 'presence-lost')
    }

    for (const [remoteDeviceId, sessionId] of presentSessions) {
      this.publishDiagnostic(remoteDeviceId, 'presence')
      if (ownDeviceId.localeCompare(remoteDeviceId) >= 0) continue
      await this.offerTo(remoteDeviceId, sessionId)
    }
  }

  private createPeer(
    remoteDeviceId: string,
    initiator: boolean,
    sessionId: string,
    negotiationId?: string,
    negotiationGeneration?: number,
  ) {
    const existing = this.peers.get(remoteDeviceId)
    if (
      existing?.sessionId === sessionId
      && (!negotiationId || (
        existing.negotiationId === negotiationId
        && (!negotiationGeneration || existing.negotiationGeneration === negotiationGeneration)
      ))
    ) return existing
    if (existing) this.dropPeer(remoteDeviceId, existing)

    const resolvedGeneration = negotiationGeneration ?? this.nextNegotiationGeneration(remoteDeviceId)

    // No STUN/TURN in the LAN stage: ICE can only use local candidates.
    const connection = new RTCPeerConnection({ iceServers: [] })
    const peer: PeerState = {
      connection,
      channel: null,
      queuedCandidates: [],
      offered: false,
      probeToken: null,
      validated: false,
      capabilities: new Set(),
      sessionId,
      negotiationId: negotiationId ?? randomToken(),
      negotiationGeneration: resolvedGeneration,
      localCandidates: 0,
      remoteCandidates: 0,
    }
    this.peers.set(remoteDeviceId, peer)
    this.publishDiagnostic(remoteDeviceId, initiator ? 'peer-created-initiator' : 'peer-created-responder')

    connection.onicecandidate = (event) => {
      if (this.peers.get(remoteDeviceId) !== peer || !event.candidate) return
      peer.localCandidates += 1
      this.publishDiagnostic(remoteDeviceId, 'local-candidate')
      this.signalClient?.sendSignal(remoteDeviceId, {
        kind: 'candidate',
        negotiationId: peer.negotiationId,
        negotiationGeneration: peer.negotiationGeneration,
        candidate: event.candidate.toJSON(),
      })
    }

    connection.ondatachannel = (event) => this.attachChannel(remoteDeviceId, peer, event.channel)
    connection.onconnectionstatechange = () => {
      if (this.peers.get(remoteDeviceId) !== peer) return
      this.publishDiagnostic(remoteDeviceId, `webrtc-${connection.connectionState}`)
      if (connection.connectionState === 'failed' && this.dropPeer(remoteDeviceId, peer)) {
        this.scheduleDirectRetry(remoteDeviceId)
      } else if (connection.connectionState === 'closed') {
        this.dropPeer(remoteDeviceId, peer)
      } else if (connection.connectionState === 'disconnected') {
        if (peer.validated) {
          peer.validated = false
          this.refreshPublishedStatus()
        }
        this.scheduleDirectRetry(remoteDeviceId)
      }
    }
    connection.oniceconnectionstatechange = () => {
      if (this.peers.get(remoteDeviceId) !== peer) return
      this.publishDiagnostic(remoteDeviceId, `ice-${connection.iceConnectionState}`)
      if (connection.iceConnectionState === 'disconnected') {
        if (peer.validated) {
          peer.validated = false
          this.refreshPublishedStatus()
        }
        this.scheduleDirectRetry(remoteDeviceId)
      }
    }
    connection.onicegatheringstatechange = () => {
      if (this.peers.get(remoteDeviceId) !== peer) return
      this.publishDiagnostic(remoteDeviceId, `gather-${connection.iceGatheringState}`)
    }
    connection.onsignalingstatechange = () => {
      if (this.peers.get(remoteDeviceId) !== peer) return
      this.publishDiagnostic(remoteDeviceId, `sdp-${connection.signalingState}`)
    }

    if (initiator) {
      this.attachChannel(remoteDeviceId, peer, connection.createDataChannel('oaclix-room', { ordered: true }))
    }

    return peer
  }

  private async offerTo(remoteDeviceId: string, sessionId: string) {
    const peer = this.createPeer(remoteDeviceId, true, sessionId)
    if (peer.offered) {
      this.scheduleDirectRetry(remoteDeviceId)
      return
    }
    peer.offered = true

    try {
      const offer = await peer.connection.createOffer()
      await peer.connection.setLocalDescription(offer)
      if (this.peers.get(remoteDeviceId) !== peer) return
      if (peer.connection.localDescription) {
        this.signalClient?.sendSignal(remoteDeviceId, {
          kind: 'description',
          negotiationId: peer.negotiationId,
          negotiationGeneration: peer.negotiationGeneration,
          description: peer.connection.localDescription.toJSON(),
        })
        this.publishDiagnostic(remoteDeviceId, 'offer-sent')
      }
      this.scheduleDirectRetry(remoteDeviceId)
    } catch {
      this.publishDiagnostic(remoteDeviceId, 'offer-error')
      if (this.dropPeer(remoteDeviceId, peer)) this.scheduleDirectRetry(remoteDeviceId)
    }
  }

  private async handleSignal(
    fromDeviceId: string,
    fromSessionId: string,
    signal: RealtimeSignal,
  ) {
    try {
      const sessionId = this.remoteSessions.get(fromDeviceId)
      const ownDeviceId = this.ownDeviceId
      if (!sessionId || !ownDeviceId) return
      if (sessionId !== fromSessionId) {
        this.publishDiagnostic(fromDeviceId, 'stale-session-signal-ignored')
        return
      }

      const localIsInitiator = ownDeviceId.localeCompare(fromDeviceId) < 0
      if (localIsInitiator) {
        const existing = this.peers.get(fromDeviceId)
        if (
          !existing
          || existing.sessionId !== sessionId
          || existing.negotiationId !== signal.negotiationId
          || existing.negotiationGeneration !== signal.negotiationGeneration
        ) return
      } else if (!this.acceptRemoteNegotiation(
        fromDeviceId,
        sessionId,
        signal.negotiationId,
        signal.negotiationGeneration,
      )) {
        this.publishDiagnostic(fromDeviceId, 'older-generation-ignored')
        return
      }

      if (signal.kind === 'candidate') {
        const peer = this.createPeer(
          fromDeviceId,
          false,
          sessionId,
          signal.negotiationId,
          signal.negotiationGeneration,
        )
        peer.remoteCandidates += 1
        this.publishDiagnostic(fromDeviceId, 'remote-candidate')
        if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(signal.candidate)
        else peer.queuedCandidates.push(signal.candidate)
        return
      }

      const description = signal.description
      const peer = this.createPeer(
        fromDeviceId,
        description.type === 'answer',
        sessionId,
        signal.negotiationId,
        signal.negotiationGeneration,
      )
      await peer.connection.setRemoteDescription(description)
      if (this.peers.get(fromDeviceId) !== peer) return
      this.publishDiagnostic(fromDeviceId, `remote-${description.type}`)
      for (const candidate of peer.queuedCandidates.splice(0)) {
        await peer.connection.addIceCandidate(candidate)
      }

      if (description.type === 'offer') {
        const answer = await peer.connection.createAnswer()
        await peer.connection.setLocalDescription(answer)
        if (this.peers.get(fromDeviceId) !== peer) return
        if (peer.connection.localDescription) {
          this.signalClient?.sendSignal(fromDeviceId, {
            kind: 'description',
            negotiationId: peer.negotiationId,
            negotiationGeneration: peer.negotiationGeneration,
            description: peer.connection.localDescription.toJSON(),
          })
          this.publishDiagnostic(fromDeviceId, 'answer-sent')
        }
      }
    } catch {
      const peer = this.peers.get(fromDeviceId)
      this.publishDiagnostic(fromDeviceId, 'signal-handle-error')
      if (peer && this.dropPeer(fromDeviceId, peer)) this.scheduleDirectRetry(fromDeviceId)
    }
  }

  private attachChannel(remoteDeviceId: string, peer: PeerState, channel: RTCDataChannel) {
    if (this.peers.get(remoteDeviceId) !== peer) {
      if (channel.readyState !== 'closed') channel.close()
      return
    }

    peer.channel = channel
    channel.binaryType = 'arraybuffer'
    peer.validated = false
    peer.capabilities = new Set()
    this.refreshPublishedStatus()
    this.publishDiagnostic(remoteDeviceId, 'channel-attached')

    channel.onopen = () => {
      if (this.peers.get(remoteDeviceId) !== peer) {
        channel.close()
        return
      }
      const token = randomToken()
      peer.probeToken = token
      this.publishDiagnostic(remoteDeviceId, 'channel-open')
      channel.send(JSON.stringify({
        type: 'probe',
        token,
        capabilities: localDirectCapabilities(),
      } satisfies DirectMessage))
    }

    channel.onmessage = (event) => {
      if (this.peers.get(remoteDeviceId) !== peer) return
      if (event.data instanceof ArrayBuffer) {
        this.receiveImageChunk(remoteDeviceId, peer, event.data)
        return
      }
      if (typeof event.data !== 'string') return

      let message: unknown
      try {
        message = JSON.parse(event.data) as unknown
      } catch {
        return
      }
      if (!isDirectMessage(message)) return

      if (message.type === 'probe') {
        peer.capabilities = resolveRemoteDirectCapabilities(message.capabilities)
        if (channel.readyState === 'open') {
          channel.send(JSON.stringify({
            type: 'probe-ack',
            token: message.token,
            capabilities: localDirectCapabilities(),
          } satisfies DirectMessage))
          this.publishDiagnostic(remoteDeviceId, 'probe-received')
        }
        return
      }

      if (message.type === 'probe-ack') {
        if (message.token === peer.probeToken) {
          peer.capabilities = resolveRemoteDirectCapabilities(message.capabilities)
          peer.validated = true
          this.clearDirectRetry(remoteDeviceId)
          this.refreshPublishedStatus()
          this.publishDiagnostic(remoteDeviceId, 'probe-validated')
        }
        return
      }

      if (!peer.validated) return

      if (message.type === 'local-clipboard-transfer') {
        if (!peer.capabilities.has('room-core')) return
        if (
          message.transfer.senderDeviceId !== remoteDeviceId
          || message.transfer.receiverDeviceId !== this.ownDeviceId
        ) return
        publishLanLocalClipboardTransfer(this.roomId, message.transfer, remoteDeviceId)
        return
      }

      if (message.type === 'local-clipboard-transfer-ack') {
        if (!peer.capabilities.has('room-core')) return
        if (
          message.ack.senderDeviceId !== this.ownDeviceId
          || message.ack.receiverDeviceId !== remoteDeviceId
        ) return
        publishLanLocalClipboardTransferAck(this.roomId, message.ack, remoteDeviceId)
        return
      }

      if (message.type === 'local-image-direct-start') {
        if (!peer.capabilities.has('image-direct')) return
        if (
          message.transfer.senderDeviceId !== remoteDeviceId
          || message.transfer.receiverDeviceId !== this.ownDeviceId
        ) return
        const current = this.incomingDirectImages.get(remoteDeviceId)
        if (current) this.rejectIncomingImage(remoteDeviceId, current.transfer)
        if (message.transfer.item.expiresAt <= Date.now()) {
          this.sendLocalImageDirectAck(
            remoteDeviceId,
            createLocalImageDirectTransferAck(message.transfer, 'expired'),
          )
          return
        }
        this.incomingDirectImages.set(remoteDeviceId, {
          transfer: message.transfer,
          chunks: [],
          receivedBytes: 0,
          receivedChunks: 0,
        })
        return
      }

      if (message.type === 'local-image-direct-ack') {
        if (!peer.capabilities.has('image-direct')) return
        if (
          message.ack.senderDeviceId !== this.ownDeviceId
          || message.ack.receiverDeviceId !== remoteDeviceId
        ) return
        publishLanLocalImageDirectTransferAck(this.roomId, message.ack, remoteDeviceId)
        return
      }

      if (message.type === 'direct-first-ack') {
        if (!peer.capabilities.has('room-core')) return
        if (message.ack.authorDeviceId !== this.ownDeviceId) return
        publishLanDirectFirstPrepAck(this.roomId, remoteDeviceId, message.ack)
        return
      }

      if (!peer.capabilities.has('room-core')) return
      if (message.change.type === 'upsert' && message.change.item.authorDeviceId !== remoteDeviceId) return
      publishLanClipboardChange(this.roomId, message.change, remoteDeviceId)
    }

    channel.onclose = () => {
      if (this.peers.get(remoteDeviceId) !== peer) return
      this.publishDiagnostic(remoteDeviceId, 'channel-closed')
      if (this.dropPeer(remoteDeviceId, peer)) {
        if (this.parked && this.getValidatedPeerIds().length === 0) this.stop()
        else this.scheduleDirectRetry(remoteDeviceId)
      }
    }
    channel.onerror = () => {
      if (this.peers.get(remoteDeviceId) !== peer) return
      this.publishDiagnostic(remoteDeviceId, 'channel-error')
      if (this.dropPeer(remoteDeviceId, peer)) {
        if (this.parked && this.getValidatedPeerIds().length === 0) this.stop()
        else this.scheduleDirectRetry(remoteDeviceId)
      }
    }
  }

  private dropPeer(remoteDeviceId: string, expectedPeer?: PeerState) {
    const peer = this.peers.get(remoteDeviceId)
    if (!peer || (expectedPeer && peer !== expectedPeer)) return false
    this.peers.delete(remoteDeviceId)
    this.incomingDirectImages.delete(remoteDeviceId)
    this.sendingDirectImagePeers.delete(remoteDeviceId)
    if (peer.connection.connectionState !== 'closed') peer.connection.close()
    this.refreshPublishedStatus()
    return true
  }
}
