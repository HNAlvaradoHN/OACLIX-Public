package app.oaclix.android.connection

import android.content.Context
import app.oaclix.android.R
import java.net.URI

object NativeBackendConfig {
    private const val PREFERENCES = "oaclix_native_connection"
    private const val KEY_BASE_URL = "api_base_url"

    fun resolve(context: Context): String {
        val saved = context
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getString(KEY_BASE_URL, null)
            .orEmpty()

        normalize(saved)?.let { return it }
        return normalize(context.getString(R.string.oaclix_api_base_url)).orEmpty()
    }

    fun save(context: Context, raw: String): String {
        val normalized = requireNotNull(normalize(raw)) {
            "Usa una dirección HTTPS válida de OACLIX"
        }
        context
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_BASE_URL, normalized)
            .apply()
        return normalized
    }

    fun normalize(raw: String): String? {
        val candidate = raw.trim()
        if (candidate.isEmpty()) return null

        val uri = try {
            URI(candidate)
        } catch (_: Exception) {
            return null
        }

        if (!uri.scheme.equals("https", ignoreCase = true)) return null
        val host = uri.host?.takeIf { it.isNotBlank() } ?: return null
        if (host.equals("invalid", ignoreCase = true) || host.endsWith(".invalid", ignoreCase = true)) return null
        if (uri.userInfo != null || uri.query != null || uri.fragment != null) return null
        if (uri.path.isNotEmpty() && uri.path != "/") return null

        val port = if (uri.port == -1) "" else ":${uri.port}"
        return "https://${host.lowercase()}$port"
    }
}
