import { useEffect, useMemo, useState } from 'react'
import type { DeviceIdentitySnapshot, DeviceIdentityStatus } from '../identity/deviceIdentity'
import type { LinkedDeviceSnapshot } from '../identity/deviceLinking'
import { getDeviceRouteStatus, subscribeDirectLanStatus, type DeviceRouteStatus } from '../realtime/lanStatus'
import { loadLinkedShareDevices } from '../transport/linkedDeviceAuthorization'
import { Icon } from './Icon'

function routeBadge(status: DeviceRouteStatus) {
  if (status === 'direct') return { label: 'Directo', className: 'is-direct' }
  if (status === 'cloud') return { label: 'Nube', className: 'is-cloud' }
  if (status === 'offline') return { label: 'Offline', className: 'is-offline' }
  return { label: 'Comprobando…', className: 'is-checking' }
}

export function GeneralDestinationPanel({
  open,
  identity,
  identityStatus,
  onClose,
  onSelect,
}: {
  open: boolean
  identity: DeviceIdentitySnapshot | null
  identityStatus: DeviceIdentityStatus
  onClose: () => void
  onSelect: (deviceId: string) => Promise<void>
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
    loadLinkedShareDevices(identity.generalRoomId)
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

  const selectDevice = async (deviceId: string) => {
    if (sendingDeviceId) return
    setSendingDeviceId(deviceId)
    setMessage(null)
    try {
      await onSelect(deviceId)
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo enviar a ese dispositivo')
    } finally {
      setSendingDeviceId(null)
    }
  }

  return (
    <>
      <button className={`scrim ${open ? 'is-open' : ''}`} aria-label="Cerrar destinos de General" type="button" onClick={onClose} />
      <aside className={`side-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <div className="side-panel__head">
          <div>
            <span className="eyebrow">General</span>
            <h2>Elegir destino</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
        </div>

        <section className="link-device-card">
          <div className="link-device-card__head">
            <div>
              <strong>Enviar a un dispositivo</strong>
              <span>Elige el equipo. OACLIX comprobará de nuevo autorización y ruta justo al enviar; no hará broadcast ni fallback silencioso.</span>
            </div>
          </div>
          {identityStatus === 'loading' ? <p className="link-device-message">Preparando identidad segura…</p> : null}
          {identityStatus === 'error' ? <p className="link-device-message">No se pudo verificar la identidad.</p> : null}
          {message ? <p className="link-device-message" role="status">{message}</p> : null}
        </section>

        <div className="linked-list real-device-list">
          <section className="person-group">
            <header>
              <span className="avatar-dot avatar-dot--large">D</span>
              <div><strong>Mis dispositivos</strong><span>{loading ? 'Comprobando rutas…' : `${remoteDevices.length} destinos`}</span></div>
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
                const selectable = status === 'direct' || status === 'cloud'
                const routeMessage = status === 'direct'
                  ? 'Ruta directa disponible'
                  : status === 'cloud'
                    ? 'Ruta Nube disponible'
                    : status === 'offline'
                      ? 'Dispositivo sin ruta activa'
                      : 'Comprobando conexión'

                return (
                  <div className="device-row" key={device.id}>
                    <span className="device-row__icon"><Icon name="devices" /></span>
                    <div className="device-row__content">
                      <strong>{device.label}</strong>
                      <span>{routeMessage}</span>
                    </div>
                    <div className="device-row__tools">
                      {selectable ? (
                        <button
                          className="device-rename-button"
                          type="button"
                          disabled={Boolean(sendingDeviceId)}
                          onClick={() => void selectDevice(device.id)}
                        >{sending ? 'Enviando…' : 'Enviar aquí'}</button>
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
