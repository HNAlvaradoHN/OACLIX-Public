package app.oaclix.android.background

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import app.oaclix.android.MainActivity
import app.oaclix.android.R
import app.oaclix.android.share.NativeImageReceiptBus
import app.oaclix.android.share.NativeImageRelayForegroundController

/**
 * Process-local handoff between the PWA shell and Android's background Direct receiver.
 * Only one transport owner is active at a time: PWA while MainActivity is visible,
 * native WebRTC while the app is in the background and the user opted in.
 */
internal object BackgroundDirectRuntime {
    @Volatile
    private var service: BackgroundDirectAvailabilityService? = null

    @Volatile
    var mainVisible: Boolean = false
        private set

    fun setMainVisible(visible: Boolean) {
        mainVisible = visible
        service?.refreshReceiverState()
    }

    fun attach(next: BackgroundDirectAvailabilityService) {
        service = next
        next.refreshReceiverState()
    }

    fun detach(current: BackgroundDirectAvailabilityService) {
        if (service === current) service = null
    }
}

class BackgroundDirectAvailabilityService : Service() {
    private lateinit var relayController: NativeImageRelayForegroundController
    private var receiverActive = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForegroundCompat(buildNotification(receiverActive = false))
        relayController = NativeImageRelayForegroundController(applicationContext) {
            NativeImageReceiptBus.publishStored()
            updateNotification(received = true)
        }
        BackgroundDirectRuntime.attach(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_DISABLE) {
            preferences(this).edit().putBoolean(PREF_ENABLED, false).apply()
            stopSelf()
            return START_NOT_STICKY
        }

        if (!isEnabled(this)) {
            stopSelf()
            return START_NOT_STICKY
        }

        refreshReceiverState()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        BackgroundDirectRuntime.detach(this)
        if (::relayController.isInitialized) relayController.close()
        receiverActive = false
        super.onDestroy()
    }

    internal fun refreshReceiverState() {
        if (!::relayController.isInitialized) return
        val shouldReceive = isEnabled(this) && !BackgroundDirectRuntime.mainVisible
        if (shouldReceive == receiverActive) {
            updateNotification(received = false)
            return
        }

        receiverActive = shouldReceive
        if (shouldReceive) relayController.start() else relayController.stop()
        updateNotification(received = false)
    }

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(received: Boolean) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(receiverActive, received))
    }

    private fun buildNotification(receiverActive: Boolean, received: Boolean = false): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val disablePendingIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, BackgroundDirectAvailabilityService::class.java).setAction(ACTION_DISABLE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val text = when {
            received -> getString(R.string.background_direct_received)
            receiverActive -> getString(R.string.background_direct_active)
            else -> getString(R.string.background_direct_foreground)
        }

        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_oaclix_mark)
            .setContentTitle(getString(R.string.background_direct_title))
            .setContentText(text)
            .setContentIntent(openPendingIntent)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(
                Notification.Action.Builder(
                    null,
                    getString(R.string.background_direct_disable),
                    disablePendingIntent,
                ).build(),
            )
            .build()
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.background_direct_channel),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.background_direct_channel_description)
                setShowBadge(false)
            },
        )
    }

    companion object {
        private const val PREFS = "oaclix_background_direct"
        private const val PREF_ENABLED = "enabled"
        private const val CHANNEL_ID = "oaclix-background-direct"
        private const val NOTIFICATION_ID = 2701
        private const val ACTION_DISABLE = "app.oaclix.android.action.DISABLE_BACKGROUND_DIRECT"

        private fun preferences(context: Context) =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        fun isEnabled(context: Context): Boolean =
            preferences(context.applicationContext).getBoolean(PREF_ENABLED, false)

        fun setEnabled(context: Context, enabled: Boolean): Boolean {
            val appContext = context.applicationContext
            if (!enabled) {
                preferences(appContext).edit().putBoolean(PREF_ENABLED, false).apply()
                appContext.stopService(Intent(appContext, BackgroundDirectAvailabilityService::class.java))
                return false
            }

            if (!BackgroundDirectRuntime.mainVisible) return false
            preferences(appContext).edit().putBoolean(PREF_ENABLED, true).apply()
            val started = runCatching {
                appContext.startForegroundService(
                    Intent(appContext, BackgroundDirectAvailabilityService::class.java),
                )
            }.isSuccess
            if (!started) preferences(appContext).edit().putBoolean(PREF_ENABLED, false).apply()
            return started
        }

        fun ensureStartedIfEnabled(context: Context) {
            val appContext = context.applicationContext
            if (!isEnabled(appContext)) return
            runCatching {
                appContext.startForegroundService(
                    Intent(appContext, BackgroundDirectAvailabilityService::class.java),
                )
            }.onFailure {
                preferences(appContext).edit().putBoolean(PREF_ENABLED, false).apply()
            }
        }
    }
}
