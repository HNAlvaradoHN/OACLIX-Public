package app.oaclix.android.share

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import livekit.org.webrtc.CandidatePairChangeEvent
import livekit.org.webrtc.DataChannel
import livekit.org.webrtc.IceCandidate
import livekit.org.webrtc.MediaConstraints
import livekit.org.webrtc.MediaStream
import livekit.org.webrtc.PeerConnection
import livekit.org.webrtc.PeerConnectionFactory
import livekit.org.webrtc.RtpReceiver
import livekit.org.webrtc.RtpTransceiver
import livekit.org.webrtc.SdpObserver
import livekit.org.webrtc.SessionDescription
import org.json.JSONObject
import java.io.IOException
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal data class NativeDirectTextSendResult(
    val targetDeviceId: String,
    val transferId: String,
    val itemId: String,
)

/**
 * Persistent LAN-only WebRTC peer layer for direct text.
 *
 * The supplied realtime callback is used only for presence/SDP/ICE metadata.
 * Clipboard payload and ACK frames travel only over the encrypted DataChannel.
 * This checkpoint intentionally configures no STUN/TURN servers: it proves the
 * local-network path before any Internet P2P work is added.
 */
internal class NativeDirectTextPeerManager(
    context: Context,
    private val currentDeviceId: String,
    private val sendRealtimeFrame: (JSONObject) -> Boolean,
    private val onIncomingTransfer: (NativeDirectTextProtocol.Transfer) -> NativeDirectTextProtocol.AckStatus,
) : AutoCloseable {
    private val factory = createFactory(context.applicationContext, currentDeviceId)
    private val closed = AtomicBoolean(false)
    private val thread = HandlerThread("OACLIX-Direct-Text").apply { start() }
    private val handler = Handler(thread.looper)
    private val remoteSessions = mutableMapOf<String, String>()
    private val peers = mutableMapOf<String, PeerState>()
    private val nextGenerations = mutableMapOf<String, Int>()
    private val acceptedRemoteNegotiations = mutableMapOf<String, AcceptedNegotiation>()
    private val retryScheduled = mutableSetOf<String>()
    private val pendingSends = mutableMapOf<String, PendingSend>()
    private val receivedReceipts = mutableMapOf<String, ReceivedReceipt>()

    fun handlePresence(message: JSONObject) {
        if (closed.get()) return
        val snapshot = JSONObject(message.toString())
        handler.post {
            if (!closed.get()) applyPresence(snapshot)
        }
    }

    fun handleSignal(message: JSONObject) {
        if (closed.get()) return
        val snapshot = JSONObject(message.toString())
        handler.post {
            if (!closed.get()) applySignal(snapshot)
        }
    }

    fun send(
        targetDeviceId: String,
        text: String,
        timeoutMs: Long = DEFAULT_SEND_TIMEOUT_MS,
    ): NativeDirectTextSendResult {
        require(NativeDirectSignalProtocol.validDeviceId(targetDeviceId)) { "Destino inválido" }
        require(targetDeviceId != currentDeviceId) { "El destino debe ser otro dispositivo" }
        require(timeoutMs in MIN_SEND_TIMEOUT_MS..MAX_SEND_TIMEOUT_MS) { "Timeout inválido" }
        if (closed.get()) throw IOException("El canal directo está cerrado")

        val frame = NativeDirectTextProtocol.createTransferFrame(
            senderDeviceId = currentDeviceId,
            receiverDeviceId = targetDeviceId,
            text = text,
        )
        val transferId = frame.getString("transferId")
        val itemId = frame.getJSONObject("item").getString("id")
        val pending = PendingSend(
            targetDeviceId = targetDeviceId,
            transferId = transferId,
            itemId = itemId,
            frame = frame,
        )

        if (!handler.post { beginSend(pending) }) {
            throw IOException("No se pudo preparar el envío directo")
        }

        if (!pending.completed.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            handler.post {
                if (pendingSends[transferId] === pending) pendingSends.remove(transferId)
                pending.fail(IOException("No se recibió confirmación directa del dispositivo"))
            }
            throw IOException("No se recibió confirmación directa del dispositivo")
        }

        pending.failure.get()?.let { throw it }
        return pending.result.get() ?: throw IOException("El dispositivo no confirmó el envío directo")
    }

    fun resetSession() {
        if (closed.get()) return
        handler.post {
            if (closed.get()) return@post
            failAllPending(IOException("La sesión directa cambió"))
            peers.values.toList().forEach(::disposePeer)
            peers.clear()
            remoteSessions.clear()
            nextGenerations.clear()
            acceptedRemoteNegotiations.clear()
            retryScheduled.clear()
            receivedReceipts.clear()
        }
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        handler.post {
            failAllPending(IOException("El canal directo se cerró"))
            peers.values.toList().forEach(::disposePeer)
            peers.clear()
            remoteSessions.clear()
            nextGenerations.clear()
            acceptedRemoteNegotiations.clear()
            retryScheduled.clear()
            receivedReceipts.clear()
            runCatching { factory.dispose() }
            thread.quitSafely()
        }
    }

    private fun beginSend(pending: PendingSend) {
        if (closed.get()) {
            pending.fail(IOException("El canal directo está cerrado"))
            return
        }
        if (remoteSessions[pending.targetDeviceId] == null) {
            pending.fail(IOException("El dispositivo de destino no está conectado directamente"))
            return
        }
        pendingSends[pending.transferId] = pending
        peers[pending.targetDeviceId]?.let(::dispatchPendingForPeer)
    }

    private fun applyPresence(message: JSONObject) {
        val presence = NativeDirectSignalProtocol.parsePresence(message) ?: return
        if (presence.none { it.deviceId == currentDeviceId }) return

        val next = presence
            .asSequence()
            .filter { it.deviceId != currentDeviceId }
            .associate { it.deviceId to it.sessionId }

        for ((remoteDeviceId, previousSessionId) in remoteSessions.toMap()) {
            val nextSessionId = next[remoteDeviceId]
            if (nextSessionId == null || nextSessionId != previousSessionId) {
                peers[remoteDeviceId]?.let { dropPeer(remoteDeviceId, it, retry = false) }
                acceptedRemoteNegotiations.remove(remoteDeviceId)
                retryScheduled.remove(remoteDeviceId)
                if (nextSessionId == null) {
                    failPendingForRemote(
                        remoteDeviceId,
                        IOException("El dispositivo de destino se desconectó"),
                    )
                }
            }
        }

        remoteSessions.clear()
        remoteSessions.putAll(next)

        for ((remoteDeviceId, sessionId) in next) {
            if (isLocalInitiator(remoteDeviceId)) startOffer(remoteDeviceId, sessionId)
        }
    }

    private fun applySignal(message: JSONObject) {
        val signal = NativeDirectSignalProtocol.parseSignal(message) ?: return
        if (signal.fromDeviceId == currentDeviceId) return
        val expectedSession = remoteSessions[signal.fromDeviceId] ?: return
        if (expectedSession != signal.fromSessionId) return

        if (isLocalInitiator(signal.fromDeviceId)) {
            val peer = peers[signal.fromDeviceId] ?: return
            if (
                peer.sessionId != signal.fromSessionId
                || peer.negotiationId != signal.negotiationId
                || peer.negotiationGeneration != signal.negotiationGeneration
            ) return
            when (signal) {
                is NativeDirectSignalProtocol.Signal.Description -> {
                    if (signal.type != "answer") return
                    applyRemoteDescription(peer, signal)
                }
                is NativeDirectSignalProtocol.Signal.Candidate -> applyRemoteCandidate(peer, signal)
            }
            return
        }

        if (!acceptRemoteNegotiation(signal)) return
        val peer = createPeer(
            remoteDeviceId = signal.fromDeviceId,
            sessionId = signal.fromSessionId,
            negotiationId = signal.negotiationId,
            negotiationGeneration = signal.negotiationGeneration,
            initiator = false,
        ) ?: return

        when (signal) {
            is NativeDirectSignalProtocol.Signal.Description -> {
                if (signal.type != "offer") return
                applyRemoteDescription(peer, signal)
            }
            is NativeDirectSignalProtocol.Signal.Candidate -> applyRemoteCandidate(peer, signal)
        }
    }

    private fun acceptRemoteNegotiation(signal: NativeDirectSignalProtocol.Signal): Boolean {
        val previous = acceptedRemoteNegotiations[signal.fromDeviceId]
        if (previous != null && previous.sessionId != signal.fromSessionId) {
            acceptedRemoteNegotiations.remove(signal.fromDeviceId)
        }
        val current = acceptedRemoteNegotiations[signal.fromDeviceId]
        if (current != null) {
            if (signal.negotiationGeneration < current.generation) return false
            if (
                signal.negotiationGeneration == current.generation
                && signal.negotiationId != current.negotiationId
            ) return false
        }
        if (current == null || signal.negotiationGeneration > current.generation) {
            acceptedRemoteNegotiations[signal.fromDeviceId] = AcceptedNegotiation(
                sessionId = signal.fromSessionId,
                negotiationId = signal.negotiationId,
                generation = signal.negotiationGeneration,
            )
        }
        return true
    }

    private fun startOffer(remoteDeviceId: String, sessionId: String) {
        if (closed.get() || remoteSessions[remoteDeviceId] != sessionId) return
        val existing = peers[remoteDeviceId]
        if (existing?.sessionId == sessionId) return
        if (existing != null) dropPeer(remoteDeviceId, existing, retry = false)

        val generation = (nextGenerations[remoteDeviceId] ?: 0) + 1
        if (generation > NativeDirectSignalProtocol.MAX_NEGOTIATION_GENERATION) return
        nextGenerations[remoteDeviceId] = generation
        val peer = createPeer(
            remoteDeviceId = remoteDeviceId,
            sessionId = sessionId,
            negotiationId = randomToken(),
            negotiationGeneration = generation,
            initiator = true,
        ) ?: run {
            scheduleInitiatorRetry(remoteDeviceId, sessionId)
            return
        }

        runCatching {
            peer.connection.createOffer(object : BaseSdpObserver() {
                override fun onCreateSuccess(description: SessionDescription?) {
                    if (description == null) {
                        handler.post { failPeer(peer) }
                        return
                    }
                    handler.post {
                        if (isCurrent(peer)) setLocalAndSignal(peer, description)
                    }
                }

                override fun onCreateFailure(error: String?) {
                    handler.post { failPeer(peer) }
                }
            }, MediaConstraints())
        }.onFailure {
            failPeer(peer)
        }
    }

    private fun applyRemoteDescription(
        peer: PeerState,
        signal: NativeDirectSignalProtocol.Signal.Description,
    ) {
        if (!isCurrent(peer) || peer.remoteDescriptionSet) return
        val type = if (signal.type == "offer") SessionDescription.Type.OFFER else SessionDescription.Type.ANSWER
        peer.connection.setRemoteDescription(object : BaseSdpObserver() {
            override fun onSetSuccess() {
                handler.post {
                    if (!isCurrent(peer)) return@post
                    peer.remoteDescriptionSet = true
                    drainCandidates(peer)
                    if (signal.type == "offer") createAnswer(peer)
                }
            }

            override fun onSetFailure(error: String?) {
                handler.post { failPeer(peer) }
            }
        }, SessionDescription(type, signal.sdp))
    }

    private fun createAnswer(peer: PeerState) {
        if (!isCurrent(peer)) return
        runCatching {
            peer.connection.createAnswer(object : BaseSdpObserver() {
                override fun onCreateSuccess(description: SessionDescription?) {
                    if (description == null) {
                        handler.post { failPeer(peer) }
                        return
                    }
                    handler.post {
                        if (isCurrent(peer)) setLocalAndSignal(peer, description)
                    }
                }

                override fun onCreateFailure(error: String?) {
                    handler.post { failPeer(peer) }
                }
            }, MediaConstraints())
        }.onFailure {
            failPeer(peer)
        }
    }

    private fun setLocalAndSignal(peer: PeerState, description: SessionDescription) {
        peer.connection.setLocalDescription(object : BaseSdpObserver() {
            override fun onSetSuccess() {
                handler.post {
                    if (!isCurrent(peer)) return@post
                    val type = when (description.type) {
                        SessionDescription.Type.OFFER -> "offer"
                        SessionDescription.Type.ANSWER -> "answer"
                        else -> return@post
                    }
                    val sent = sendRealtimeFrame(
                        NativeDirectSignalProtocol.descriptionFrame(
                            targetDeviceId = peer.remoteDeviceId,
                            negotiationId = peer.negotiationId,
                            negotiationGeneration = peer.negotiationGeneration,
                            type = type,
                            sdp = description.description,
                        ),
                    )
                    if (!sent) failPeer(peer)
                }
            }

            override fun onSetFailure(error: String?) {
                handler.post { failPeer(peer) }
            }
        }, description)
    }

    private fun applyRemoteCandidate(
        peer: PeerState,
        signal: NativeDirectSignalProtocol.Signal.Candidate,
    ) {
        if (!isCurrent(peer)) return
        val candidate = IceCandidate(signal.sdpMid, signal.sdpMLineIndex, signal.candidate)
        if (!peer.remoteDescriptionSet) {
            if (peer.queuedCandidates.size >= MAX_QUEUED_CANDIDATES) {
                failPeer(peer)
                return
            }
            peer.queuedCandidates.add(candidate)
            return
        }
        if (!peer.connection.addIceCandidate(candidate)) failPeer(peer)
    }

    private fun drainCandidates(peer: PeerState) {
        for (candidate in peer.queuedCandidates.toList()) {
            if (!peer.connection.addIceCandidate(candidate)) {
                failPeer(peer)
                return
            }
        }
        peer.queuedCandidates.clear()
    }

    private fun createPeer(
        remoteDeviceId: String,
        sessionId: String,
        negotiationId: String,
        negotiationGeneration: Int,
        initiator: Boolean,
    ): PeerState? {
        val existing = peers[remoteDeviceId]
        if (
            existing != null
            && existing.sessionId == sessionId
            && existing.negotiationId == negotiationId
            && existing.negotiationGeneration == negotiationGeneration
        ) return existing
        if (existing != null) dropPeer(remoteDeviceId, existing, retry = false)

        val observer = PeerObserver(remoteDeviceId, sessionId, negotiationId, negotiationGeneration)
        val config = PeerConnection.RTCConfiguration(emptyList<PeerConnection.IceServer>()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val connection = factory.createPeerConnection(config, observer) ?: return null
        val peer = PeerState(
            remoteDeviceId = remoteDeviceId,
            sessionId = sessionId,
            negotiationId = negotiationId,
            negotiationGeneration = negotiationGeneration,
            initiator = initiator,
            connection = connection,
        )
        peers[remoteDeviceId] = peer

        if (initiator) {
            val init = DataChannel.Init().apply { ordered = true }
            val channel = connection.createDataChannel(DATA_CHANNEL_LABEL, init)
            attachChannel(peer, channel)
        }
        return peer
    }

    private fun attachChannel(peer: PeerState, channel: DataChannel) {
        if (!isCurrent(peer) || channel.label() != DATA_CHANNEL_LABEL) {
            disposeChannel(channel)
            return
        }
        if (peer.channel != null && peer.channel !== channel) {
            disposeChannel(channel)
            return
        }
        peer.channel = channel
        channel.registerObserver(ChannelObserver(peer, channel))
        if (channel.state() == DataChannel.State.OPEN) sendProbe(peer)
    }

    private fun sendProbe(peer: PeerState) {
        if (!isCurrent(peer) || peer.channel?.state() != DataChannel.State.OPEN) return
        val token = randomToken()
        peer.probeToken = token
        if (!sendJson(
                peer,
                JSONObject()
                    .put("type", PROBE_TYPE)
                    .put("token", token)
                    .put("capabilities", NativeDirectSignalProtocol.textDirectCapabilitiesJson()),
            )
        ) failPeer(peer)
    }

    private fun handleChannelMessage(peer: PeerState, channel: DataChannel, bytes: ByteArray, binary: Boolean) {
        if (!isCurrent(peer) || peer.channel !== channel || binary) return
        if (bytes.size > MAX_DATA_CHANNEL_TEXT_BYTES) return
        val message = runCatching { JSONObject(bytes.toString(Charsets.UTF_8)) }.getOrNull() ?: return
        when (message.optString("type")) {
            PROBE_TYPE -> handleProbe(peer, message)
            PROBE_ACK_TYPE -> handleProbeAck(peer, message)
            NativeDirectTextProtocol.TRANSFER_TYPE -> handleIncomingTransfer(peer, message)
            NativeDirectTextProtocol.ACK_TYPE -> handleIncomingAck(peer, message)
        }
    }

    private fun handleProbe(peer: PeerState, message: JSONObject) {
        val token = message.optString("token")
        if (!TOKEN_PATTERN.matches(token)) return
        peer.sawRemoteProbe = true
        peer.remoteTextDirect = NativeDirectSignalProtocol.remoteSupportsTextDirect(message.opt("capabilities"))
        sendJson(
            peer,
            JSONObject()
                .put("type", PROBE_ACK_TYPE)
                .put("token", token)
                .put("capabilities", NativeDirectSignalProtocol.textDirectCapabilitiesJson()),
        )
    }

    private fun handleProbeAck(peer: PeerState, message: JSONObject) {
        val token = message.optString("token")
        if (token != peer.probeToken || !TOKEN_PATTERN.matches(token)) return
        peer.remoteTextDirect = NativeDirectSignalProtocol.remoteSupportsTextDirect(message.opt("capabilities"))
        peer.validated = true
        retryScheduled.remove(peer.remoteDeviceId)
        dispatchPendingForPeer(peer)
    }

    private fun handleIncomingTransfer(peer: PeerState, message: JSONObject) {
        if (!peer.sawRemoteProbe || !peer.remoteTextDirect || peer.channel?.state() != DataChannel.State.OPEN) return
        val now = System.currentTimeMillis()
        cleanupReceipts(now)
        val transfer = NativeDirectTextProtocol.parseTransferFrame(
            message = message,
            expectedRemoteDeviceId = peer.remoteDeviceId,
            currentDeviceId = currentDeviceId,
            now = now,
        ) ?: return

        val receiptKey = "${peer.remoteDeviceId}:${transfer.transferId}:${transfer.itemId}"
        val previous = receivedReceipts[receiptKey]
        val status = when {
            previous != null && previous.expiresAt > now -> previous.status
            NativeDirectTextProtocol.isExpired(transfer, now) -> NativeDirectTextProtocol.AckStatus.Expired
            else -> runCatching { onIncomingTransfer(transfer) }
                .getOrDefault(NativeDirectTextProtocol.AckStatus.Rejected)
        }
        if (previous == null && status != NativeDirectTextProtocol.AckStatus.Rejected) {
            receivedReceipts[receiptKey] = ReceivedReceipt(transfer.expiresAt, status)
        }
        sendJson(peer, NativeDirectTextProtocol.createAckFrame(transfer, status))
    }

    private fun handleIncomingAck(peer: PeerState, message: JSONObject) {
        val ack = NativeDirectTextProtocol.parseAckFrame(
            message = message,
            expectedRemoteDeviceId = peer.remoteDeviceId,
            currentDeviceId = currentDeviceId,
        ) ?: return
        val pending = pendingSends[ack.transferId] ?: return
        if (
            pending.targetDeviceId != peer.remoteDeviceId
            || pending.itemId != ack.itemId
            || !pending.sent
        ) return

        pendingSends.remove(ack.transferId)
        when (ack.status) {
            NativeDirectTextProtocol.AckStatus.Stored -> pending.succeed(
                NativeDirectTextSendResult(
                    targetDeviceId = pending.targetDeviceId,
                    transferId = pending.transferId,
                    itemId = pending.itemId,
                ),
            )
            NativeDirectTextProtocol.AckStatus.Expired -> pending.fail(
                IOException("El texto venció antes de guardarse"),
            )
            NativeDirectTextProtocol.AckStatus.Rejected -> pending.fail(
                IOException("El dispositivo receptor rechazó el texto"),
            )
        }
    }

    private fun dispatchPendingForPeer(peer: PeerState) {
        if (!isCurrent(peer) || !peer.validated) return
        if (!peer.remoteTextDirect) {
            failPendingForRemote(
                peer.remoteDeviceId,
                IOException("El otro dispositivo no admite texto directo"),
            )
            return
        }
        val channel = peer.channel ?: return
        if (channel.state() != DataChannel.State.OPEN) return

        for (pending in pendingSends.values.filter { it.targetDeviceId == peer.remoteDeviceId && !it.sent }) {
            if (sendJson(peer, pending.frame)) {
                pending.sent = true
            } else {
                pendingSends.remove(pending.transferId)
                pending.fail(IOException("No se pudo enviar por el canal directo"))
            }
        }
    }

    private fun sendJson(peer: PeerState, json: JSONObject): Boolean {
        if (!isCurrent(peer)) return false
        val channel = peer.channel ?: return false
        if (channel.state() != DataChannel.State.OPEN) return false
        val bytes = json.toString().toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_DATA_CHANNEL_TEXT_BYTES) return false
        return channel.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false))
    }

    private fun failPeer(peer: PeerState) {
        if (!isCurrent(peer)) return
        val remoteDeviceId = peer.remoteDeviceId
        val sessionId = peer.sessionId
        dropPeer(remoteDeviceId, peer, retry = false)
        if (peer.initiator) scheduleInitiatorRetry(remoteDeviceId, sessionId)
    }

    private fun dropPeer(remoteDeviceId: String, peer: PeerState, retry: Boolean) {
        if (peers[remoteDeviceId] !== peer) return
        peers.remove(remoteDeviceId)
        disposePeer(peer)
        if (retry && peer.initiator) scheduleInitiatorRetry(remoteDeviceId, peer.sessionId)
    }

    private fun disposePeer(peer: PeerState) {
        peer.channel?.let(::disposeChannel)
        peer.channel = null
        runCatching { peer.connection.close() }
        runCatching { peer.connection.dispose() }
    }

    private fun disposeChannel(channel: DataChannel) {
        runCatching { channel.unregisterObserver() }
        runCatching { channel.close() }
        runCatching { channel.dispose() }
    }

    private fun scheduleInitiatorRetry(remoteDeviceId: String, sessionId: String) {
        if (closed.get() || !isLocalInitiator(remoteDeviceId) || !retryScheduled.add(remoteDeviceId)) return
        handler.postDelayed({
            retryScheduled.remove(remoteDeviceId)
            if (
                !closed.get()
                && remoteSessions[remoteDeviceId] == sessionId
                && peers[remoteDeviceId] == null
            ) startOffer(remoteDeviceId, sessionId)
        }, RETRY_DELAY_MS)
    }

    private fun handleConnectionState(peer: PeerState, state: PeerConnection.PeerConnectionState) {
        if (!isCurrent(peer)) return
        when (state) {
            PeerConnection.PeerConnectionState.FAILED,
            PeerConnection.PeerConnectionState.CLOSED,
            -> failPeer(peer)
            PeerConnection.PeerConnectionState.DISCONNECTED -> {
                peer.validated = false
                handler.postDelayed({
                    if (!isCurrent(peer)) return@postDelayed
                    val currentState = peer.connection.connectionState()
                    if (
                        currentState == PeerConnection.PeerConnectionState.DISCONNECTED
                        || currentState == PeerConnection.PeerConnectionState.FAILED
                    ) failPeer(peer)
                }, DISCONNECTED_GRACE_MS)
            }
            else -> Unit
        }
    }

    private fun failPendingForRemote(remoteDeviceId: String, error: IOException) {
        val affected = pendingSends.values.filter { it.targetDeviceId == remoteDeviceId }
        for (pending in affected) {
            pendingSends.remove(pending.transferId)
            pending.fail(error)
        }
    }

    private fun failAllPending(error: IOException) {
        val all = pendingSends.values.toList()
        pendingSends.clear()
        all.forEach { it.fail(error) }
    }

    private fun cleanupReceipts(now: Long) {
        receivedReceipts.entries.removeAll { it.value.expiresAt <= now }
    }

    private fun isCurrent(peer: PeerState): Boolean = !closed.get() && peers[peer.remoteDeviceId] === peer

    private fun isLocalInitiator(remoteDeviceId: String): Boolean = shouldInitiate(currentDeviceId, remoteDeviceId)

    private fun randomToken(): String {
        val bytes = ByteArray(12)
        secureRandom.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private inner class PeerObserver(
        private val remoteDeviceId: String,
        private val sessionId: String,
        private val negotiationId: String,
        private val negotiationGeneration: Int,
    ) : PeerConnection.Observer {
        private fun currentPeer(): PeerState? {
            if (closed.get()) return null
            val peer = peers[remoteDeviceId] ?: return null
            return peer.takeIf {
                it.sessionId == sessionId
                    && it.negotiationId == negotiationId
                    && it.negotiationGeneration == negotiationGeneration
            }
        }

        override fun onIceCandidate(candidate: IceCandidate) {
            handler.post {
                val peer = currentPeer() ?: return@post
                val sent = sendRealtimeFrame(
                    NativeDirectSignalProtocol.candidateFrame(
                        targetDeviceId = remoteDeviceId,
                        negotiationId = peer.negotiationId,
                        negotiationGeneration = peer.negotiationGeneration,
                        sdpMid = candidate.sdpMid,
                        sdpMLineIndex = candidate.sdpMLineIndex,
                        candidate = candidate.sdp,
                    ),
                )
                if (!sent) failPeer(peer)
            }
        }

        override fun onDataChannel(channel: DataChannel) {
            handler.post {
                val peer = currentPeer()
                if (peer == null) disposeChannel(channel) else attachChannel(peer, channel)
            }
        }

        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
            handler.post { currentPeer()?.let { handleConnectionState(it, newState) } }
        }

        override fun onStandardizedIceConnectionChange(newState: PeerConnection.IceConnectionState?) = Unit
        override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent?) = Unit
        override fun onSignalingChange(newState: PeerConnection.SignalingState?) = Unit
        override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) = Unit
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
        override fun onAddStream(stream: MediaStream?) = Unit
        override fun onRemoveStream(stream: MediaStream?) = Unit
        override fun onRenegotiationNeeded() = Unit
        override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out MediaStream>) = Unit
        override fun onTrack(transceiver: RtpTransceiver) = Unit
    }

    private inner class ChannelObserver(
        private val peer: PeerState,
        private val channel: DataChannel,
    ) : DataChannel.Observer {
        override fun onBufferedAmountChange(previousAmount: Long) = Unit

        override fun onStateChange() {
            handler.post {
                if (!isCurrent(peer) || peer.channel !== channel) return@post
                when (channel.state()) {
                    DataChannel.State.OPEN -> sendProbe(peer)
                    DataChannel.State.CLOSED -> dropPeer(peer.remoteDeviceId, peer, retry = true)
                    else -> Unit
                }
            }
        }

        override fun onMessage(buffer: DataChannel.Buffer) {
            val copy = buffer.data.duplicate()
            val bytes = ByteArray(copy.remaining())
            copy.get(bytes)
            val binary = buffer.binary
            handler.post { handleChannelMessage(peer, channel, bytes, binary) }
        }
    }

    private open class BaseSdpObserver : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription?) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String?) = Unit
        override fun onSetFailure(error: String?) = Unit
    }

    private data class AcceptedNegotiation(
        val sessionId: String,
        val negotiationId: String,
        val generation: Int,
    )

    private class PendingSend(
        val targetDeviceId: String,
        val transferId: String,
        val itemId: String,
        val frame: JSONObject,
    ) {
        val completed = CountDownLatch(1)
        val result = AtomicReference<NativeDirectTextSendResult?>(null)
        val failure = AtomicReference<IOException?>(null)
        private val done = AtomicBoolean(false)
        var sent: Boolean = false

        fun succeed(value: NativeDirectTextSendResult) {
            if (!done.compareAndSet(false, true)) return
            result.set(value)
            completed.countDown()
        }

        fun fail(error: IOException) {
            if (!done.compareAndSet(false, true)) return
            failure.set(error)
            completed.countDown()
        }
    }

    private data class ReceivedReceipt(
        val expiresAt: Long,
        val status: NativeDirectTextProtocol.AckStatus,
    )

    private data class PeerState(
        val remoteDeviceId: String,
        val sessionId: String,
        val negotiationId: String,
        val negotiationGeneration: Int,
        val initiator: Boolean,
        val connection: PeerConnection,
        val queuedCandidates: MutableList<IceCandidate> = mutableListOf(),
        var channel: DataChannel? = null,
        var remoteDescriptionSet: Boolean = false,
        var probeToken: String? = null,
        var sawRemoteProbe: Boolean = false,
        var remoteTextDirect: Boolean = false,
        var validated: Boolean = false,
    )

    companion object {
        private const val DATA_CHANNEL_LABEL = "oaclix-text-v1"
        private const val PROBE_TYPE = "probe"
        private const val PROBE_ACK_TYPE = "probe-ack"
        private const val RETRY_DELAY_MS = 1_500L
        private const val DISCONNECTED_GRACE_MS = 2_000L
        private const val MIN_SEND_TIMEOUT_MS = 1_000L
        private const val MAX_SEND_TIMEOUT_MS = 30_000L
        const val DEFAULT_SEND_TIMEOUT_MS = 12_000L
        private const val MAX_QUEUED_CANDIDATES = 64
        private const val MAX_DATA_CHANNEL_TEXT_BYTES = 64 * 1024
        private const val NATIVE_LIBRARY_NAME = "lkjingle_peerconnection_so"
        private val TOKEN_PATTERN = Regex("^[a-f0-9]{24}$")
        private val secureRandom = SecureRandom()
        private val initializationLock = Any()
        @Volatile private var webRtcInitialized = false

        internal fun shouldInitiate(localDeviceId: String, remoteDeviceId: String): Boolean {
            require(NativeDirectSignalProtocol.validDeviceId(localDeviceId)) { "Dispositivo local inválido" }
            require(NativeDirectSignalProtocol.validDeviceId(remoteDeviceId)) { "Dispositivo remoto inválido" }
            require(localDeviceId != remoteDeviceId) { "Los dispositivos deben ser distintos" }
            return localDeviceId < remoteDeviceId
        }

        private fun createFactory(context: Context, deviceId: String): PeerConnectionFactory {
            require(NativeDirectSignalProtocol.validDeviceId(deviceId)) { "Dispositivo local inválido" }
            initializeWebRtc(context)
            return PeerConnectionFactory.builder().createPeerConnectionFactory()
        }

        private fun initializeWebRtc(context: Context) {
            if (webRtcInitialized) return
            synchronized(initializationLock) {
                if (webRtcInitialized) return
                PeerConnectionFactory.initialize(
                    PeerConnectionFactory.InitializationOptions
                        .builder(context.applicationContext)
                        .setNativeLibraryName(NATIVE_LIBRARY_NAME)
                        .createInitializationOptions(),
                )
                webRtcInitialized = true
            }
        }
    }
}
