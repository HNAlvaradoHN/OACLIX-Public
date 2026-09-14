import { useEffect } from 'react'
import {
  ensureClipboardRoomForegroundReception,
  suspendClipboardRoomForegroundReception,
} from '../data/clipboardApi'
import { bootstrapDeviceIdentity, getLocalDeviceId } from '../identity/deviceIdentity'

export function ForegroundLinkedImageReceiver() {
  useEffect(() => {
    let disposed = false
    let activeRoomId: string | null = null

    const stop = () => {
      if (!activeRoomId) return
      suspendClipboardRoomForegroundReception(activeRoomId)
      activeRoomId = null
    }

    const start = async () => {
      stop()
      if (document.visibilityState !== 'visible') return

      try {
        // No crea identidad para un usuario puramente local: solo reactiva una
        // credencial que ya existe en este navegador.
        await getLocalDeviceId()
        const identity = await bootstrapDeviceIdentity()
        if (disposed || document.visibilityState !== 'visible') return
        if (!identity.persisted || !identity.generalRoomId) return

        activeRoomId = identity.generalRoomId
        ensureClipboardRoomForegroundReception(activeRoomId)
      } catch {
        // Mi portapapeles sigue siendo local/offline aunque la recepción remota
        // no pueda levantarse en este momento.
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void start()
      else stop()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    void start()

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', handleVisibility)
      stop()
    }
  }, [])

  return null
}
