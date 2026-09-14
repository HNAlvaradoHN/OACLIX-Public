import { Icon } from './Icon'

type SettingsMenuProps = {
  open: boolean
  onClose: () => void
  onOpenConnections: () => void
  onOpenAppearance: () => void
}

export function SettingsMenu({ open, onClose, onOpenConnections, onOpenAppearance }: SettingsMenuProps) {
  if (!open) return null

  return (
    <>
      <button className="settings-menu-scrim" type="button" aria-label="Cerrar menú" onClick={onClose} />
      <section className="settings-menu" role="dialog" aria-modal="true" aria-labelledby="settings-menu-title">
        <header className="settings-menu__head">
          <div>
            <span className="eyebrow">Menú</span>
            <h2 id="settings-menu-title">OACLIX</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar menú" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        <div className="settings-menu__options">
          <button className="settings-menu__option" type="button" onClick={onOpenConnections}>
            <span className="settings-menu__icon"><Icon name="wifi" /></span>
            <span>
              <strong>Conexiones y espacio</strong>
              <small>Directo, 100 MB y tu nube personal</small>
            </span>
            <Icon name="chevron-right" />
          </button>

          <button className="settings-menu__option" type="button" onClick={onOpenAppearance}>
            <span className="settings-menu__icon"><Icon name="moon" /></span>
            <span>
              <strong>Apariencia</strong>
              <small>Sistema, claro u oscuro</small>
            </span>
            <Icon name="chevron-right" />
          </button>
        </div>
      </section>
    </>
  )
}
