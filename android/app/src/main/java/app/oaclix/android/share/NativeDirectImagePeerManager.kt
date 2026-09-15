package app.oaclix.android.share

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import livekit.org.webrtc.CandidatePairChangeEvent
import livekit.org.webrtc.DataChannel
import livekit.org.webrtc.IceCandidate
import livekit.org.webrtc.MediaStream
import livekit.org.webrtc.PeerConnection
import livekit.org.webrtc.PeerConnectionFactory
import livekit.org.webrtc.RtpReceiver
import livekit.org.webrtc.RtpTransceiver
import livekit.org.webrtc.SdpObserver
import livekit.org.webrtc.SessionDescription
import org.json.JSONObject
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicBoolean

internal class NativeDirectImagePeerManager(
    context: Context,
    private val currentDeviceId: String,
    private val sendRealtimeFrame: (JSONObject) -> Boolean,
    private val onStored: () -> Unit,
) : AutoCloseable {
    private val appContext = context.applicationContext
    private val factory = createFactory(appContext, currentDeviceId)
    private val closed = AtomicBoolean(false)
    private val thread = HandlerThread("OACLIX-Direct-Image").apply { start() }
    private val handler = Handler(thread.looper)
    private val remoteSessions = mutableMapOf<String, String>()
    private val peers = mutableMapOf<String, PeerState>()
    private val nextGenerations = mutableMapOf<String, Int>()
    private val acceptedRemoteNegotiations = mutableMapOf<String, AcceptedNegotiation>()
    private val retryScheduled = mutableSetOf<String>()

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

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        handler.post {
            peers.values.toList().forEach(::disposePeer)
            peers.clear()
            remoteSessions.clear()
            acceptedRemoteNegotiations.clear()
            retryScheduled.clear()
            runCatching { factory.dispose() }
            thread.quitSafely()
        }
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

        val initiator = isLocalInitiator(signal.fromDeviceId)
        if (initiator) {
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
                signal.fromSessionId,
                signal.negotiationId,
                signal.negotiationGeneration,
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

        peer.connection.createOffer(object : BaseSdpObserver() {
            override fun onCreateSuccess(description: SessionDescription?) {
                if (description == null) {
                    handler.post { failPeer(peer) }
                    return
                }
                handler.post {
                    if (!isCurrent(peer)) return@post
                    setLocalAndSignal(peer, description)
                }
            }

            override fun onCreateFailure(error: String?) {
                handler.post { failPeer(peer) }
            }
        }, null)
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
        peer.connection.createAnswer(object : BaseSdpObserver() {
            override fun onCreateSuccess(description: SessionDescription?) {
                if (description == null) {
                    handler.post { failPeer(peer) }
                    return
                }
                handler.post {
                    if (!isCurrent(peer)) return@post
                    setLocalAndSignal(peer, description)
                }
            }

            override fun onCreateFailure(error: String?) {
                handler.post { failPeer(peer) }
            }
        }, null)
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
                    sendRealtimeFrame(
                        NativeDirectSignalProtocol.descriptionFrame(
                            targetDeviceId = peer.remoteDeviceId,
                            negotiationId = peer.negotiationId,
                            negotiationGeneration = peer.negotiationGeneration,
                            type = type,
                            sdp = description.description,
                        ),
                    )
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
        sendText(peer, JSONObject()
            .put("type", "probe")
            .put("token", token)
            .put("capabilities", NativeDirectSignalProtocol.imageDirectCapabilitiesJson()))
    }

    private fun handleChannelMessage(peer: PeerState, channel: DataChannel, bytes: ByteArray, binary: Boolean) {
        if (!isCurrent(peer) || peer.channel !== channel) return
        if (binary) {
            if (peer.sawRemoteProbe && peer.remoteImageDirect) peer.inbox?.append(bytes)
            return
        }

        val message = runCatching { JSONObject(bytes.toString(Charsets.UTF_8)) }.getOrNull() ?: return
        when (message.optString("type")) {
            "probe" -> handleProbe(peer, message)
            "probe-ack" -> handleProbeAck(peer, message)
            NativeDirectImageProtocol.START_TYPE -> handleDirectStart(peer, message)
        }
    }

    private fun handleProbe(peer: PeerState, message: JSONObject) {
        val token = message.optString("token")
        if (!TOKEN_PATTERN.matches(token)) return
        peer.sawRemoteProbe = true
        peer.remoteImageDirect = NativeDirectSignalProtocol.remoteSupportsImageDirect(message.opt("capabilities"))
        sendText(peer, JSONObject()
            .put("type", "probe-ack")
            .put("token", token)
            .put("capabilities", NativeDirectSignalProtocol.imageDirectCapabilitiesJson()))
    }

    private fun handleProbeAck(peer: PeerState, message: JSONObject) {
        val token = message.optString("token")
        if (token != peer.probeToken || !TOKEN_PATTERN.matches(token)) return
        peer.remoteImageDirect = NativeDirectSignalProtocol.remoteSupportsImageDirect(message.opt("capabilities"))
        peer.validated = true
        retryScheduled.remove(peer.remoteDeviceId)
    }

    private fun handleDirectStart(peer: PeerState, message: JSONObject) {
        if (!peer.sawRemoteProbe || !peer.remoteImageDirect || peer.channel?.state() != DataChannel.State.OPEN) return
        val transfer = message.optJSONObject("transfer") ?: return
        val start = NativeDirectImageProtocol.parseStart(transfer) ?: return
        if (start.senderDeviceId != peer.remoteDeviceId || start.receiverDeviceId != currentDeviceId) return

        val inbox = peer.inbox ?: NativeDirectImageInbox(
            context = appContext,
            remoteDeviceId = peer.remoteDeviceId,
            currentDeviceId = currentDeviceId,
            onStored = onStored,
            sendAck = { ack ->
                handler.post {
                    if (isCurrent(peer)) sendText(peer, ack)
                }
            },
        ).also { peer.inbox = it }
        inbox.begin(start)
    }

    private fun sendText(peer: PeerState, json: JSONObject): Boolean {
        if (!isCurrent(peer)) return false
        val channel = peer.channel ?: return false
        if (channel.state() != DataChannel.State.OPEN) return false
        return channel.send(DataChannel.Buffer(ByteBuffer.wrap(json.toString().toByteArray(Charsets.UTF_8)), false))
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
        peer.inbox?.close()
        peer.inbox = null
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

    private fun isCurrent(peer: PeerState): Boolean = !closed.get() && peers[peer.remoteDeviceId] === peer

    private fun isLocalInitiator(remoteDeviceId: String): Boolean = currentDeviceId < remoteDeviceId

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
                sendRealtimeFrame(
                    NativeDirectSignalProtocol.candidateFrame(
                        targetDeviceId = remoteDeviceId,
                        negotiationId = peer.negotiationId,
                        negotiationGeneration = peer.negotiationGeneration,
                        sdpMid = candidate.sdpMid,
                        sdpMLineIndex = candidate.sdpMLineIndex,
                        candidate = candidate.sdp,
                    ),
                )
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
        var remoteImageDirect: Boolean = false,
        var validated: Boolean = false,
        var inbox: NativeDirectImageInbox? = null,
    )

    companion object {
        private const val DATA_CHANNEL_LABEL = "oaclix-room"
        private const val RETRY_DELAY_MS = 1_500L
        private const val DISCONNECTED_GRACE_MS = 2_000L
        private const val MAX_QUEUED_CANDIDATES = 64
        private const val NATIVE_LIBRARY_NAME = "lkjingle_peerconnection_so"
        private val TOKEN_PATTERN = Regex("^[a-f0-9]{24}$")
        private val secureRandom = SecureRandom()
        private val initializationLock = Any()
        @Volatile private var webRtcInitialized = false

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
