import { useState } from 'react'
import { activateWaitingServiceWorker } from '../pwa/registerServiceWorker'

type UpdatePromptProps = {
  open: boolean
}

export function UpdatePrompt({ open }: UpdatePromptProps) {
  const [updating, setUpdating] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!open) return null

  const update = async () => {
    if (updating) return
    setUpdating(true)
    setFailed(false)
    try {
      await activateWaitingServiceWorker()
    } catch {
      setUpdating(false)
      setFailed(true)
    }
  }

  return (
    <aside className="update-prompt" role="status" aria-live="polite">
      <div className="update-prompt__copy">
        <strong>{failed ? 'La actualización todavía no está lista' : 'Nueva versión disponible'}</strong>
        <span>{failed ? 'Espera unos segundos y vuelve a intentarlo.' : 'Actualiza para asegurarte de estar viendo la versión más reciente de OACLIX.'}</span>
      </div>
      <button className="update-prompt__button" type="button" onClick={update} disabled={updating}>
        {updating ? 'Actualizando…' : failed ? 'Reintentar' : 'Actualizar'}
      </button>
    </aside>
  )
}
