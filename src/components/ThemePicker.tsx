import { Icon } from './Icon'
import type { ThemePreference } from '../theme/theme'

type ThemePickerProps = {
  open: boolean
  value: ThemePreference
  onChange: (theme: ThemePreference) => void
  onClose: () => void
}

const options: Array<{ value: ThemePreference; label: string; description: string; icon: 'monitor' | 'sun' | 'moon' }> = [
  { value: 'system', label: 'Sistema', description: 'Sigue el modo de tu dispositivo', icon: 'monitor' },
  { value: 'light', label: 'Claro', description: 'Interfaz clara con contraste suave', icon: 'sun' },
  { value: 'dark', label: 'Oscuro', description: 'Obsidian, el modo original de OACLIX', icon: 'moon' },
]

export function ThemePicker({ open, value, onChange, onClose }: ThemePickerProps) {
  if (!open) return null

  return (
    <>
      <button className="appearance-scrim" type="button" aria-label="Cerrar apariencia" onClick={onClose} />
      <section className="appearance-panel" role="dialog" aria-modal="true" aria-labelledby="appearance-title">
        <header className="appearance-panel__head">
          <div>
            <span className="eyebrow">Apariencia</span>
            <h2 id="appearance-title">Tema</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar apariencia" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        <div className="theme-options" role="radiogroup" aria-label="Tema de OACLIX">
          {options.map((option) => {
            const active = value === option.value
            return (
              <button
                className={`theme-option ${active ? 'is-active' : ''}`}
                type="button"
                role="radio"
                aria-checked={active}
                key={option.value}
                onClick={() => onChange(option.value)}
              >
                <span className="theme-option__icon"><Icon name={option.icon} /></span>
                <span className="theme-option__copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                <span className="theme-option__check" aria-hidden="true">{active ? <Icon name="check" /> : null}</span>
              </button>
            )
          })}
        </div>
      </section>
    </>
  )
}
