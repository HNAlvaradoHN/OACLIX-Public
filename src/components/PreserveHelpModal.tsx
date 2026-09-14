import { useEffect, useState } from 'react'
import type { PreserveTarget } from '../types'
import { Icon } from './Icon'

const options: Array<{
  id: PreserveTarget
  title: string
  summary: string
  detail: string
  icon: 'monitor' | 'devices' | 'spark'
}> = [
  {
    id: 'device',
    title: 'Este dispositivo',
    summary: 'Solo se guarda aquí',
    detail: 'No usa tu nube ni los 100 MB de OACLIX. Si borras la app, limpias sus datos o pierdes este equipo, esa copia puede perderse.',
    icon: 'monitor',
  },
  {
    id: 'devices',
    title: 'Mis dispositivos',
    summary: 'Una copia en tus equipos',
    detail: 'OACLIX intentará pasarla directamente a tus dispositivos vinculados cuando puedan conectarse. No usa los 100 MB de OACLIX.',
    icon: 'devices',
  },
  {
    id: 'cloud',
    title: 'Mi nube',
    summary: 'Disponible usando tu espacio personal',
    detail: 'Usará Drive u otro proveedor personal compatible. Así puede seguir disponible aunque tus otros equipos estén apagados o lejos.',
    icon: 'spark',
  },
]

type PreserveHelpModalProps = {
  open: boolean
  onClose: () => void
  mode?: 'help' | 'select'
  initialTarget?: PreserveTarget
  onConfirm?: (target: PreserveTarget) => void | Promise<void>
}

export function PreserveHelpModal({
  open,
  onClose,
  mode = 'help',
  initialTarget = 'device',
  onConfirm,
}: PreserveHelpModalProps) {
  const [active, setActive] = useState<PreserveTarget>(initialTarget)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setActive(initialTarget)
    setBusy(false)
    setError(null)

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [initialTarget, onClose, open])

  if (!open) return null

  const selected = options.find((option) => option.id === active) ?? options[0]

  const handleConfirm = async () => {
    if (!onConfirm || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(active)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo conservar aquí')
      setBusy(false)
    }
  }

  return (
    <>
      <button className="preserve-help-scrim" type="button" aria-label="Cerrar explicación de Conservar" onClick={onClose} />
      <section className="preserve-help" role="dialog" aria-modal="true" aria-labelledby="preserve-help-title">
        <header className="preserve-help__head">
          <div>
            <span className="eyebrow">Conservar</span>
            <h2 id="preserve-help-title">¿Dónde quieres guardarlo?</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar explicación" onClick={onClose} disabled={busy}>
            <Icon name="x" />
          </button>
        </header>

        <div className="preserve-help__visual" aria-hidden="true">
          <span><Icon name="monitor" /></span>
          <i />
          <span><Icon name="devices" /></span>
          <i />
          <span><Icon name="spark" /></span>
        </div>

        <div className="preserve-help__options" aria-label="Formas de conservar">
          {options.map((option) => (
            <button
              className={`preserve-help__option ${active === option.id ? 'is-active' : ''}`}
              type="button"
              key={option.id}
              onClick={() => {
                setActive(option.id)
                setError(null)
              }}
              disabled={busy}
            >
              <span className="preserve-help__option-icon"><Icon name={option.icon} /></span>
              <span>
                <strong>{option.title}</strong>
                <small>{option.summary}</small>
              </span>
              <span className="preserve-help__info" aria-hidden="true">i</span>
            </button>
          ))}
        </div>

        <div className="preserve-help__detail" key={selected.id}>
          <span className="preserve-help__detail-icon"><Icon name={selected.icon} /></span>
          <div>
            <strong>{selected.title}</strong>
            <p>{selected.detail}</p>
          </div>
        </div>

        {mode === 'select' && (
          <div className="preserve-help__footer">
            {error && <p className="preserve-help__error" role="status">{error}</p>}
            <div className="preserve-help__footer-actions">
              <button className="ghost-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
              <button className="preserve-help__accept" type="button" onClick={() => void handleConfirm()} disabled={busy}>
                <Icon name="check" /> {busy ? 'Guardando…' : 'Aceptar'}
              </button>
            </div>
          </div>
        )}

        <div className="preserve-help__rule">
          <strong>Los 100 MB de OACLIX siempre siguen fluyendo.</strong>
          <span>Conservar nunca usa ese espacio.</span>
        </div>
      </section>
    </>
  )
}
