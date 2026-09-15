package app.oaclix.android

import android.app.Activity
import android.app.Application
import android.os.Bundle
import app.oaclix.android.share.NativeForegroundReceiverGate
import app.oaclix.android.share.NativeImageReceiptBus
import app.oaclix.android.share.NativeImageRelayForegroundController

class OaclixApplication : Application(), Application.ActivityLifecycleCallbacks {
    private lateinit var imageRelayController: NativeImageRelayForegroundController
    private lateinit var receiverGate: NativeForegroundReceiverGate

    override fun onCreate() {
        super.onCreate()
        imageRelayController = NativeImageRelayForegroundController(this) {
            NativeImageReceiptBus.publishStored()
        }
        receiverGate = NativeForegroundReceiverGate(
            onFirstSurfaceStarted = imageRelayController::start,
            onLastSurfaceStopped = imageRelayController::stop,
        )
        registerActivityLifecycleCallbacks(this)
    }

    override fun onTerminate() {
        if (::receiverGate.isInitialized) receiverGate.close()
        if (::imageRelayController.isInitialized) imageRelayController.close()
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
