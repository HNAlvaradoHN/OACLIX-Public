package app.oaclix.android

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import app.oaclix.android.connection.NativeBackendConfig
import app.oaclix.android.identity.AndroidKeystoreDeviceIdentity
import app.oaclix.android.identity.NativeLinkedDeviceSnapshot
import app.oaclix.android.identity.NativeLinkedDevicesSnapshot
import app.oaclix.android.identity.NativeLinkingFlow
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class LinkDeviceActivity : Activity() {
    private lateinit var codeInput: EditText
    private lateinit var linkButton: Button
    private lateinit var generateCodeButton: Button
    private lateinit var refreshButton: Button
    private lateinit var configureConnectionButton: Button
    private lateinit var generatedCode: TextView
    private lateinit var devicesContainer: LinearLayout
    private lateinit var status: TextView
    private lateinit var ioExecutor: ExecutorService
    private lateinit var flow: NativeLinkingFlow
    private val identity = AndroidKeystoreDeviceIdentity()
    private var busy = false
    private var currentDeviceId = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_link_device)

        ioExecutor = Executors.newSingleThreadExecutor()
        codeInput = findViewById(R.id.link_code_input)
        linkButton = findViewById(R.id.link_device_button)
        generateCodeButton = findViewById(R.id.generate_link_code_button)
        refreshButton = findViewById(R.id.refresh_linked_devices_button)
        configureConnectionButton = findViewById(R.id.configure_connection_button)
        generatedCode = findViewById(R.id.generated_link_code)
        devicesContainer = findViewById(R.id.linked_devices_container)
        status = findViewById(R.id.link_status)
        currentDeviceId = identity.getOrCreateSnapshot().deviceId

        configureConnectionButton.setOnClickListener { showConnectionDialog() }
        linkButton.setOnClickListener { consumeCode() }
        generateCodeButton.setOnClickListener { generateCode() }
        refreshButton.setOnClickListener { loadRoster(announce = true) }
        configureFlow(loadRoster = true)
    }

    override fun onDestroy() {
        if (::ioExecutor.isInitialized) ioExecutor.shutdown()
        super.onDestroy()
    }

    private fun configureFlow(loadRoster: Boolean) {
        val baseUrl = NativeBackendConfig.resolve(this)
        if (baseUrl.isBlank()) {
            status.setText(R.string.link_connection_required)
            setControlsEnabled(false)
            return
        }

        flow = NativeLinkingFlow(baseUrl, identity)
        setControlsEnabled(true)
        if (loadRoster) loadRoster(announce = false)
    }

    private fun showConnectionDialog() {
        if (busy) return
        val input = EditText(this).apply {
            hint = getString(R.string.share_connection_hint)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setText(NativeBackendConfig.resolve(this@LinkDeviceActivity))
            setSelection(text.length)
            setPadding(dp(20), dp(8), dp(20), dp(8))
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.share_connection_title)
            .setMessage(R.string.share_connection_message)
            .setView(input)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.share_connection_save) { _, _ ->
                try {
                    NativeBackendConfig.save(this, input.text.toString())
                    (application as? OaclixApplication)?.refreshDirectTextSession()
                    configureFlow(loadRoster = true)
                } catch (error: IllegalArgumentException) {
                    status.text = error.message ?: getString(R.string.link_error)
                }
            }
            .show()
    }

    private fun consumeCode() {
        val code = codeInput.text.toString().trim()
        if (code.isBlank()) {
            status.setText(R.string.link_code_required)
            return
        }
        runRemote(
            busyMessage = getString(R.string.link_in_progress),
            task = { flow.consumeAndLoad(code) },
            onSuccess = { roster ->
                currentDeviceId = identity.getOrCreateSnapshot().deviceId
                (application as? OaclixApplication)?.refreshDirectTextSession()
                codeInput.text.clear()
                generatedCode.visibility = View.GONE
                renderDevices(roster)
                status.text = getString(R.string.link_success, roster.devices.size)
            },
        )
    }

    private fun generateCode() {
        runRemote(
            busyMessage = getString(R.string.link_generating_code),
            task = { flow.createCode() },
            onSuccess = { result ->
                generatedCode.text = getString(R.string.link_generated_code, result.code)
                generatedCode.visibility = View.VISIBLE
                status.setText(R.string.link_code_generated)
            },
        )
    }

    private fun loadRoster(announce: Boolean) {
        runRemote(
            busyMessage = getString(R.string.link_loading_devices),
            task = { flow.load() },
            onSuccess = { roster ->
                (application as? OaclixApplication)?.refreshDirectTextSession()
                renderDevices(roster)
                status.text = if (announce) {
                    getString(R.string.link_devices_loaded, roster.devices.size)
                } else {
                    getString(R.string.link_ready)
                }
            },
        )
    }

    private fun renameDevice(device: NativeLinkedDeviceSnapshot, label: String) {
        runRemote(
            busyMessage = getString(R.string.link_renaming),
            task = { flow.renameAndLoad(device.id, label) },
            onSuccess = { roster ->
                renderDevices(roster)
                status.setText(R.string.link_renamed)
            },
        )
    }

    private fun unlinkDevice(device: NativeLinkedDeviceSnapshot) {
        if (device.id == currentDeviceId) return
        runRemote(
            busyMessage = getString(R.string.link_removing),
            task = { flow.unlinkAndLoad(device.id) },
            onSuccess = { roster ->
                renderDevices(roster)
                status.setText(R.string.link_removed)
            },
        )
    }

    private fun showRenameDialog(device: NativeLinkedDeviceSnapshot) {
        if (busy) return
        val input = EditText(this).apply {
            setText(device.label)
            setSelection(text.length)
            hint = getString(R.string.link_rename_hint)
            filters = arrayOf(InputFilter.LengthFilter(48))
            setPadding(dp(20), dp(8), dp(20), dp(8))
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle(R.string.link_rename_title)
            .setView(input)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.confirm, null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val label = input.text.toString().trim()
                if (label.isBlank()) {
                    input.error = getString(R.string.link_rename_hint)
                    return@setOnClickListener
                }
                dialog.dismiss()
                renameDevice(device, label)
            }
        }
        dialog.show()
    }

    private fun showUnlinkDialog(device: NativeLinkedDeviceSnapshot) {
        if (busy || device.id == currentDeviceId) return
        AlertDialog.Builder(this)
            .setTitle(R.string.link_remove_title)
            .setMessage(getString(R.string.link_remove_message, device.label))
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.link_remove) { _, _ -> unlinkDevice(device) }
            .show()
    }

    private fun renderDevices(roster: NativeLinkedDevicesSnapshot) {
        devicesContainer.removeAllViews()
        if (roster.devices.isEmpty()) {
            devicesContainer.addView(TextView(this).apply {
                text = getString(R.string.link_empty_devices)
                setTextColor(getColor(R.color.oaclix_muted))
                textSize = 14f
                setBackgroundResource(R.drawable.local_item_background)
                setPadding(dp(14), dp(14), dp(14), dp(14))
            })
            return
        }

        roster.devices.forEach { device ->
            val isCurrent = device.id == currentDeviceId
            val suffix = device.id.takeLast(6).uppercase(Locale.US)
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundResource(R.drawable.local_item_background)
                setPadding(dp(14), dp(14), dp(14), dp(14))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply {
                    bottomMargin = dp(10)
                }
            }
            row.addView(TextView(this).apply {
                text = device.label
                setTextColor(getColor(R.color.oaclix_text))
                textSize = 16f
                setTypeface(typeface, Typeface.BOLD)
            })
            row.addView(TextView(this).apply {
                text = if (isCurrent) {
                    getString(R.string.link_device_here, suffix)
                } else {
                    getString(R.string.link_device_remote, suffix)
                }
                setTextColor(getColor(R.color.oaclix_muted))
                textSize = 12f
                setPadding(0, dp(3), 0, dp(10))
            })
            row.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(styledActionButton(R.style.Widget_Oaclix_Button_Secondary).apply {
                    text = getString(R.string.link_rename)
                    layoutParams = LinearLayout.LayoutParams(
                        0,
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        1f,
                    )
                    setOnClickListener { showRenameDialog(device) }
                })
                if (!isCurrent) {
                    addView(View(this@LinkDeviceActivity).apply {
                        layoutParams = LinearLayout.LayoutParams(dp(8), 1)
                    })
                    addView(styledActionButton(R.style.Widget_Oaclix_Button_Danger).apply {
                        text = getString(R.string.link_remove)
                        layoutParams = LinearLayout.LayoutParams(
                            0,
                            LinearLayout.LayoutParams.WRAP_CONTENT,
                            1f,
                        )
                        setOnClickListener { showUnlinkDialog(device) }
                    })
                }
            })
            devicesContainer.addView(row)
        }
    }

    private fun styledActionButton(styleRes: Int): Button = Button(this, null, 0, styleRes)

    private fun <T> runRemote(
        busyMessage: String,
        task: () -> T,
        onSuccess: (T) -> Unit,
    ) {
        if (busy || !::ioExecutor.isInitialized || ioExecutor.isShutdown) return
        busy = true
        setControlsEnabled(false)
        status.text = busyMessage
        ioExecutor.execute {
            try {
                val result = task()
                runOnUiThread {
                    if (isDestroyed) return@runOnUiThread
                    busy = false
                    setControlsEnabled(true)
                    onSuccess(result)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (isDestroyed) return@runOnUiThread
                    busy = false
                    setControlsEnabled(true)
                    status.text = error.message ?: getString(R.string.link_error)
                }
            }
        }
    }

    private fun setControlsEnabled(enabled: Boolean) {
        if (::codeInput.isInitialized) codeInput.isEnabled = enabled
        if (::linkButton.isInitialized) linkButton.isEnabled = enabled
        if (::generateCodeButton.isInitialized) generateCodeButton.isEnabled = enabled
        if (::refreshButton.isInitialized) refreshButton.isEnabled = enabled
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
