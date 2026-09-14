package app.oaclix.android.share

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeClipboardApiTest {
    @Test
    fun `create payload matches worker signed contract without expiry`() {
        val raw = NativeClipboardApi.createTextPayload(
            roomId = "room_general_1234",
            itemId = "itm_1234567890abcdef",
            text = "Hola desde Android",
        )
        val json = JSONObject(raw)

        assertEquals("room_general_1234", json.getString("roomId"))
        assertEquals("itm_1234567890abcdef", json.getString("itemId"))
        assertEquals("Hola desde Android", json.getString("text"))
        assertEquals(3, json.length())
    }

    @Test
    fun `generated item id is worker compatible`() {
        val itemId = NativeClipboardApi.newItemId()
        assertTrue(itemId.matches(Regex("^itm_[A-Za-z0-9_-]{16,80}$")))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `blank text is rejected before network`() {
        NativeClipboardApi.createTextPayload(
            roomId = "room_general_1234",
            itemId = "itm_1234567890abcdef",
            text = "   ",
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun `oversized text is rejected before network`() {
        NativeClipboardApi.createTextPayload(
            roomId = "room_general_1234",
            itemId = "itm_1234567890abcdef",
            text = "x".repeat(8_001),
        )
    }

    @Test
    fun `create response must echo item and positive change sequence`() {
        val raw = JSONObject()
            .put("version", 1)
            .put("created", true)
            .put("changeSequence", 7)
            .put("item", JSONObject()
                .put("id", "itm_1234567890abcdef")
                .put("text", "Hola"))
            .toString()

        val snapshot = NativeClipboardApi.parseCreateTextResponse(
            raw = raw,
            expectedRoomId = "room_general_1234",
            expectedItemId = "itm_1234567890abcdef",
            expectedText = "Hola",
        )

        assertTrue(snapshot.created)
        assertEquals(7L, snapshot.changeSequence)
        assertEquals("room_general_1234", snapshot.roomId)
    }
}
