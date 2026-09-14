package app.oaclix.android.connection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeBackendConfigTest {
    @Test
    fun `https origin is normalized`() {
        assertEquals(
            "https://oaclix.example.workers.dev",
            NativeBackendConfig.normalize("  https://OACLIX.EXAMPLE.workers.dev/  "),
        )
    }

    @Test
    fun `http and malformed values are rejected`() {
        assertNull(NativeBackendConfig.normalize("http://oaclix.example.workers.dev"))
        assertNull(NativeBackendConfig.normalize("not a url"))
        assertNull(NativeBackendConfig.normalize("https://"))
    }

    @Test
    fun `credentials query fragments and paths are rejected`() {
        assertNull(NativeBackendConfig.normalize("https://user@example.com"))
        assertNull(NativeBackendConfig.normalize("https://example.com/api"))
        assertNull(NativeBackendConfig.normalize("https://example.com?x=1"))
        assertNull(NativeBackendConfig.normalize("https://example.com#fragment"))
    }
}
