package app.oaclix.android.localclipboard

import android.content.Context

object LocalClipboardRepositoryProvider {
    @Volatile
    private var instance: LocalClipboardRepository? = null

    fun get(context: Context): LocalClipboardRepository {
        return instance ?: synchronized(this) {
            instance ?: SqliteLocalClipboardRepository(context.applicationContext).also { repository ->
                instance = repository
            }
        }
    }
}
