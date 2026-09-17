package app.oaclix.android.localclipboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LargeTextFileStorePolicyTest {
    @Test
    fun generatedTextFileNameIsAccepted() {
        val fileName = "txt_1789671000000_0123456789abcdef0123456789abcdef.txt"

        assertTrue(LargeTextFileStore.isValidFileName(fileName))
        assertEquals(1_789_671_000_000L, LargeTextFileStore.createdAtFromFileName(fileName))
    }

    @Test
    fun invalidOrTraversalLikeNamesAreRejected() {
        assertFalse(LargeTextFileStore.isValidFileName("../secret.txt"))
        assertFalse(LargeTextFileStore.isValidFileName("txt_123_0123456789abcdef0123456789abcdef.json"))
        assertFalse(LargeTextFileStore.isValidFileName("txt_123_short.txt"))
        assertNull(LargeTextFileStore.createdAtFromFileName("not-oaclix.txt"))
    }

    @Test
    fun providerAuthorityIsPackageScoped() {
        assertEquals(
            "app.oaclix.android.dev.text",
            LargeTextFileStore.providerAuthority("app.oaclix.android.dev"),
        )
    }
}
