import { useEffect, useMemo, useState } from 'react'
import type { LocalImageClipboardSnapshot } from '../data/localImageClipboard'
import type { DeviceIdentitySnapshot, DeviceIdentityStatus } from '../identity/deviceIdentity'
import type { LinkedDeviceSnapshot } from '../identity/deviceLinking'
import { getDeviceRouteStatus, subscribeDirectLanStatus, type DeviceRouteStatus } from '../realtime/lanStatus'
import { loadLocalClipboardShareDevices } from '../transport/localClipboardDirectTransport'
import { Icon } from './Icon'

function routeBadge(status: DeviceRouteStatus) {
  if (status === 'direct') return { label: 'Directo', className: 'is-direct' }
  if (status === 'cloud') return { label: 'Nube', className: 'is-cloud' }
  if (status === 'offline') return { label: 'Offline', className: 'is-offline' }
  return { label: 'Comprobando…', className: 'is-checking' }
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.ceil(bytes / 1024)} KB`
}

export function LocalImageSharePanel({
  open,
  item,
  identity,
  identityStatus,
  onClose,
  onSendDirect,
}: {
  open: boolean
  item: LocalImageClipboardSnapshot | null
  identity: DeviceIdentitySnapshot | null
  identityStatus: DeviceIdentityStatus
  onClose: () => void
  onSendDirect: (deviceId: string) => Promise<void>
}) {
  const [devices, setDevices] = useState<LinkedDeviceSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [sendingDeviceId, setSendingDeviceId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [, setRouteVersion] = useState(0)

  const remoteDevices = useMemo(
    () => devices.filter((device) => device.id !== identity?.deviceId),
    [devices, identity?.deviceId],
  )

  useEffect(() => {
    if (!open) {
      setDevices([])
      setMessage(null)
      setSendingDeviceId(null)
      return
    }
    if (identityStatus !== 'ready' || !identity?.persisted || !identity.generalRoomId) return

    let cancelled = false
    setLoading(true)
    setMessage(null)
    loadLocalClipboardShareDevices(identity.generalRoomId)
      .then((result) => {
        if (!cancelled) setDevices(result)
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'No se pudieron cargar los dispositivos')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [open, identity?.generalRoomId, identity?.persisted, identityStatus])

  useEffect(() => {
    if (!open) return
    return subscribeDirectLanStatus(() => setRouteVersion((current) => current + 1))
  }, [open])

  const sendDirect = async (deviceId: string) => {
    if (sendingDeviceId) return
    setSendingDeviceId(deviceId)
    setMessage(null)
    try {
      await onSendDirect(deviceId)
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo enviar la imagen')
    } finally {
      setSendingDeviceId(null)
    }
  }

  const identityUnavailable = identityStatus === 'error'

  return (
    <>
      <button className={`scrim ${open ? 'is-open' : ''}`} aria-label="Cerrar envío" type="button" onClick={onClose} />
      <aside className={`side-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <div className="side-panel__head">
          <div>
            <span className="eyebrow">Mi portapapeles</span>
            <h2>Enviar imagen</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
        </div>

        <div className="route-card">
          <span className="route-card__icon"><Icon name="image" /></span>
          <div>
            <strong>Original por Directo local</strong>
            <span>{item ? `${item.mimeType.replace('image/', '').toUpperCase()} · ${formatBytes(item.byteSize)}` : 'La imagen ya no está disponible.'}</span>
          </div>
        </div>

        <section className="link-device-card">
          <div className="link-device-card__head">
            <div>
              <strong>Elige un dispositivo</strong>
              <span>Directo conserva el original y no envía los bytes de la imagen por Worker, D1 ni R2. Nube no se usará automáticamente.</span>
            </div>
          </div>
          {identityStatus === 'loading' ? <p className="link-device-message">Preparando identidad segura…</p> : null}
          {identityUnavailable ? <p className="link-device-message">No se pudo verificar la identidad. Mi portapapeles local sigue intacto.</p> : null}
          {message ? <p className="link-device-message" role="status">{message}</p> : null}
        </section>

        <div className="linked-list real-device-list">
          <section className="person-group">
            <header>
              <span className="avatar-dot avatar-dot--large">D</span>
              <div><strong>Mis dispositivos</strong><span>{loading ? 'Comprobando rutas…' : `${remoteDevices.length} disponibles para revisar`}</span></div>
            </header>
            <div className="device-list">
              {!loading && remoteDevices.length === 0 ? (
                <p className="link-device-message">No hay otro dispositivo vinculado disponible.</p>
              ) : remoteDevices.map((device) => {
                const status = identity?.generalRoomId
                  ? getDeviceRouteStatus(identity.generalRoomId, device.id)
                  : 'checking'
                const badge = routeBadge(status)
                const sending = sendingDeviceId === device.id
                const direct = status === 'direct'
                const routeMessage = direct
                  ? 'Ruta LAN validada · original sin límite cloud'
                  : status === 'cloud'
                    ? 'Solo Nube disponible · no se enviará automáticamente'
                    : status === 'offline'
                      ? 'Abre OACLIX en ese dispositivo para intentar Directo local'
                      : 'Comprobando conexión directa'

                return (
                  <div className="device-row" key={device.id}>
                    <span className="device-row__icon"><Icon name="devices" /></span>
                    <div className="device-row__content">
                      <strong>{device.label}</strong>
                      <span>{routeMessage}</span>
                    </div>
                    <div className="device-row__tools">
                      {direct ? (
                        <button
                          className="device-rename-button"
                          type="button"
                          disabled={Boolean(sendingDeviceId) || !item}
                          onClick={() => void sendDirect(device.id)}
                        >{sending ? 'Enviando…' : 'Enviar'}</button>
                      ) : null}
                      <span className={`device-route-badge ${badge.className}`}>{badge.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </aside>
    </>
  )
}
