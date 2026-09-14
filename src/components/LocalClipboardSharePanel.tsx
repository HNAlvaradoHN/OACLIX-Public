import { useEffect, useMemo, useState } from 'react'
import type { LocalClipboardTextSnapshot } from '../data/localClipboard'
import type { DeviceIdentitySnapshot, DeviceIdentityStatus } from '../identity/deviceIdentity'
import type { LinkedDeviceSnapshot } from '../identity/deviceLinking'
import { getDeviceRouteStatus, subscribeDirectLanStatus, type DeviceRouteStatus } from '../realtime/lanStatus'
import { sendLocalClipboardTextCloud } from '../transport/localClipboardCloudTransport'
import { loadLocalClipboardShareDevices } from '../transport/localClipboardDirectTransport'
import { Icon } from './Icon'

function routeBadge(status: DeviceRouteStatus) {
  if (status === 'direct') return { label: 'Directo', className: 'is-direct' }
  if (status === 'cloud') return { label: 'Nube', className: 'is-cloud' }
  if (status === 'offline') return { label: 'Offline', className: 'is-offline' }
  return { label: 'Comprobando…', className: 'is-checking' }
}

export function LocalClipboardSharePanel({
  open,
  item,
  identity,
  identityStatus,
  onClose,
  onSendDirect,
}: {
  open: boolean
  item: LocalClipboardTextSnapshot | null
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

  const send = async (deviceId: string, route: 'direct' | 'cloud') => {
    if (sendingDeviceId) return
    setSendingDeviceId(deviceId)
    setMessage(null)
    try {
      if (route === 'direct') {
        await onSendDirect(deviceId)
      } else {
        if (!identity?.generalRoomId || !item) throw new Error('Este texto ya no está disponible')
        await sendLocalClipboardTextCloud(identity.generalRoomId, deviceId, item)
      }
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo enviar el texto')
    } finally {
      setSendingDeviceId(null)
    }
  }

  const identityUnavailable = identityStatus === 'error'
  const preview = item?.text.length && item.text.length > 150
    ? `${item.text.slice(0, 150)}…`
    : item?.text ?? ''

  return (
    <>
      <button className={`scrim ${open ? 'is-open' : ''}`} aria-label="Cerrar envío" type="button" onClick={onClose} />
      <aside className={`side-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <div className="side-panel__head">
          <div>
            <span className="eyebrow">Mi portapapeles</span>
            <h2>Enviar texto</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
        </div>

        <div className="route-card">
          <span className="route-card__icon"><Icon name="clipboard" /></span>
          <div><strong>Solo envío intencional</strong><span>{preview || 'El texto ya no está disponible.'}</span></div>
        </div>

        <section className="link-device-card">
          <div className="link-device-card__head">
            <div>
              <strong>Elige un dispositivo</strong>
              <span>Directo y Nube se eligen de forma explícita. Nube solo envía este texto al destino elegido; no sube tu historial ni se usa como fallback automático.</span>
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
                const routeMessage = status === 'direct'
                  ? 'Ruta local validada · sin contenido en nube'
                  : status === 'cloud'
                    ? 'Disponible por Nube · solo este texto si lo eliges'
                    : status === 'offline'
                      ? 'Abre OACLIX en ese dispositivo para poder recibir'
                      : 'Comprobando conexión'

                return (
                  <div className="device-row" key={device.id}>
                    <span className="device-row__icon"><Icon name="devices" /></span>
                    <div className="device-row__content">
                      <strong>{device.label}</strong>
                      <span>{routeMessage}</span>
                    </div>
                    <div className="device-row__tools">
                      {status === 'direct' ? (
                        <button
                          className="device-rename-button"
                          type="button"
                          disabled={Boolean(sendingDeviceId) || !item}
                          onClick={() => void send(device.id, 'direct')}
                        >{sending ? 'Enviando…' : 'Enviar'}</button>
                      ) : null}
                      {status === 'cloud' ? (
                        <button
                          className="device-rename-button"
                          type="button"
                          disabled={Boolean(sendingDeviceId) || !item}
                          onClick={() => void send(device.id, 'cloud')}
                        >{sending ? 'Enviando…' : 'Enviar por Nube'}</button>
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
