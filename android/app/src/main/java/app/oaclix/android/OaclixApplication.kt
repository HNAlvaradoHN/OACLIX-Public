package app.oaclix.android

import android.app.Activity
import android.app.Application
import android.os.Bundle
import app.oaclix.android.localclipboard.LocalClipboardHistory
import app.oaclix.android.share.NativeDirectTextPeerManager
import app.oaclix.android.share.NativeDirectTextProtocol
import app.oaclix.android.share.NativeDirectTextSessionController
import app.oaclix.android.share.NativeForegroundReceiverGate
import app.oaclix.android.share.NativeTextReceiptBus

class OaclixApplication : Application(), Application.ActivityLifecycleCallbacks {
    private lateinit var directTextController: NativeDirectTextSessionController
    private lateinit var receiverGate: NativeForegroundReceiverGate

    override fun onCreate() {
        super.onCreate()
        directTextController = NativeDirectTextSessionController(
            context = this,
            onIncomingTransfer = { transfer ->
                if (!::receiverGate.isInitialized || !receiverGate.isActive()) {
                    NativeDirectTextProtocol.AckStatus.Rejected
                } else if (NativeDirectTextProtocol.isExpired(transfer)) {
                    NativeDirectTextProtocol.AckStatus.Expired
                } else {
                    runCatching {
                        LocalClipboardHistory(this).saveReceived(
                            text = transfer.text,
                            itemId = transfer.itemId,
                            senderDeviceId = transfer.senderDeviceId,
                            createdAt = transfer.createdAt,
                            expiresAt = transfer.expiresAt,
                        )
                        OaclixClipboardBridge.copy(this, transfer.text)
                        NativeTextReceiptBus.publishStored()
                    }.fold(
                        onSuccess = { NativeDirectTextProtocol.AckStatus.Stored },
                        onFailure = { NativeDirectTextProtocol.AckStatus.Rejected },
                    )
                }
            },
        )
        receiverGate = NativeForegroundReceiverGate(
            onFirstSurfaceStarted = directTextController::start,
            onLastSurfaceStopped = directTextController::stop,
        )
        registerActivityLifecycleCallbacks(this)
    }

    internal fun refreshDirectTextSession() {
        if (
            !::directTextController.isInitialized ||
            !::receiverGate.isInitialized ||
            !receiverGate.isActive()
        ) return
        directTextController.refresh()
    }

    internal fun sendDirectText(
        targetDeviceId: String,
        text: String,
        timeoutMs: Long = NativeDirectTextPeerManager.DEFAULT_SEND_TIMEOUT_MS,
    ) {
        directTextController.send(targetDeviceId, text, timeoutMs)
    }

    override fun onTerminate() {
        if (::receiverGate.isInitialized) receiverGate.close()
        if (::directTextController.isInitialized) directTextController.close()
        unregisterActivityLifecycleCallbacks(this)
        super.onTerminate()
    }

    override fun onActivityStarted(activity: Activity) {
        receiverGate.surfaceStarted()
    }

    override fun onActivityStopped(activity: Activity) {
        receiverGate.surfaceStopped()
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
