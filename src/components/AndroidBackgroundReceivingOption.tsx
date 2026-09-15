import { useState } from 'react'
import { Icon } from './Icon'

type AndroidBackgroundBridge = {
  isBackgroundDirectEnabled(): boolean
  setBackgroundDirectEnabled(enabled: boolean): boolean
}

function backgroundBridge() {
  return (window as Window & { OaclixNative?: AndroidBackgroundBridge }).OaclixNative ?? null
}

export function AndroidBackgroundReceivingOption() {
  const native = backgroundBridge()
  const [enabled, setEnabled] = useState(() => native?.isBackgroundDirectEnabled() ?? false)

  if (!native) return null

  const toggle = () => {
    const requested = !enabled
    const actual = native.setBackgroundDirectEnabled(requested)
    setEnabled(actual)
  }

  return (
    <button
      className="settings-menu__option"
      type="button"
      aria-pressed={enabled}
      onClick={toggle}
    >
      <span className="settings-menu__icon"><Icon name="devices" /></span>
      <span>
        <strong>Imágenes Directo en segundo plano</strong>
        <small>{enabled
          ? 'Activa · Android puede recibir imágenes aunque OACLIX no esté en pantalla'
          : 'Desactivada · las imágenes Directo requieren OACLIX abierta'}</small>
      </span>
      <strong>{enabled ? 'Sí' : 'No'}</strong>
    </button>
  )
}
