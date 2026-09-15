package app.oaclix.android

import android.app.Activity
import android.app.Application
import android.os.Bundle
import app.oaclix.android.background.BackgroundDirectAvailabilityService
import app.oaclix.android.background.BackgroundDirectRuntime

class OaclixApplication : Application(), Application.ActivityLifecycleCallbacks {
    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(this)
    }

    override fun onTerminate() {
        unregisterActivityLifecycleCallbacks(this)
        super.onTerminate()
    }

    override fun onActivityStarted(activity: Activity) {
        if (activity !is MainActivity) return
        BackgroundDirectRuntime.setMainVisible(true)
        BackgroundDirectAvailabilityService.ensureStartedIfEnabled(this)
    }

    override fun onActivityStopped(activity: Activity) {
        if (activity !is MainActivity) return
        BackgroundDirectRuntime.setMainVisible(false)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
