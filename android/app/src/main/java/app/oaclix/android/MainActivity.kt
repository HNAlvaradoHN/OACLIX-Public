package app.oaclix.android

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import app.oaclix.android.identity.NativeIdentityApi
import java.io.ByteArrayInputStream

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var backendHost: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val backendBaseUrl = NativeIdentityApi.normalizeBaseUrl(getString(R.string.oaclix_api_base_url))
        backendHost = requireNotNull(Uri.parse(backendBaseUrl).host) { "Endpoint OACLIX inválido" }

        ServiceWorkerController.getInstance().serviceWorkerWebSettings.blockNetworkLoads = true

        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(6, 11, 18))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.setSupportMultipleWindows(false)
            addJavascriptInterface(OaclixWebBridge(), NATIVE_BRIDGE_NAME)
            webViewClient = OaclixShellClient()
        }

        setContentView(webView)
        webView.loadUrl("$backendBaseUrl$SHELL_INDEX_PATH")
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface(NATIVE_BRIDGE_NAME)
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    private inner class OaclixShellClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
            val url = request?.url ?: return null
            if (url.scheme != "https" || url.host != backendHost || !url.path.orEmpty().startsWith(SHELL_PREFIX)) {
                return null
            }

            val relativePath = url.path.orEmpty().removePrefix(SHELL_PREFIX).ifBlank { "index.html" }
            if (!isSafeAssetPath(relativePath)) return notFound()

            return runCatching {
                WebResourceResponse(
                    mimeType(relativePath),
                    if (isTextAsset(relativePath)) "UTF-8" else null,
                    assets.open(relativePath),
                )
            }.getOrElse { notFound() }
        }

        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val url = request?.url ?: return true
            if (!request.isForMainFrame) return false
            if (url.scheme == "https" && url.host == backendHost && url.path.orEmpty().startsWith(SHELL_PREFIX)) {
                return false
            }

            if (url.scheme == "https") {
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
            }
            return true
        }
    }

    private fun isSafeAssetPath(path: String): Boolean {
        if (path.isBlank() || path.startsWith('/') || path.contains('\\')) return false
        return path.split('/').none { segment -> segment.isBlank() || segment == "." || segment == ".." }
    }

    private fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json", "webmanifest" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }

    private fun isTextAsset(path: String): Boolean = when (path.substringAfterLast('.', "").lowercase()) {
        "html", "js", "mjs", "css", "json", "webmanifest", "svg" -> true
        else -> false
    }

    private fun notFound(): WebResourceResponse = WebResourceResponse(
        "text/plain",
        "UTF-8",
        404,
        "Not Found",
        emptyMap(),
        ByteArrayInputStream("Not Found".toByteArray(Charsets.UTF_8)),
    )

    companion object {
        private const val NATIVE_BRIDGE_NAME = "OaclixNative"
        private const val SHELL_PREFIX = "/app/"
        private const val SHELL_INDEX_PATH = "/app/index.html"
    }
}
