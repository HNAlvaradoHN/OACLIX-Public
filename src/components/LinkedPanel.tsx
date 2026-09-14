import { useEffect, useRef, useState } from 'react'
import { createDeviceLinkCode, consumeDeviceLinkCode, listLinkedDevices, renameLinkedDevice, unlinkLinkedDevice, type LinkedDeviceSnapshot } from '../identity/deviceLinking'
import { type DeviceIdentitySnapshot, type DeviceIdentityStatus } from '../identity/deviceIdentity'
import { hasNewLinkedDevice, nextLinkRefreshDelayMs, shouldQueryLinkedDevices } from '../identity/linkRefreshPolicy'
import { getDeviceRouteStatus, getLanPeerDiagnostic, getRealtimePresenceRevision, isRealtimePresenceKnown, subscribeDirectLanStatus, type DeviceRouteStatus, type LanPeerDiagnostic } from '../realtime/lanStatus'
import { ensureClipboardRoomConnectivity } from '../transport/clipboardTransport'
import { Icon } from './Icon'

function routeBadge(status: DeviceRouteStatus) {
  if (status === 'direct') return { label: 'Directo', className: 'is-direct' }
  if (status === 'cloud') return { label: 'Nube', className: 'is-cloud' }
  if (status === 'offline') return { label: 'Offline', className: 'is-offline' }
  return { label: 'Comprobando…', className: 'is-checking' }
}

function diagnosticSummary(deviceLabel: string, status: DeviceRouteStatus, diagnostic: LanPeerDiagnostic | null) {
  if (!diagnostic) return `${deviceLabel}\nRuta: ${routeBadge(status).label}\nDiagnóstico directo: todavía sin datos.`
  return [
    deviceLabel,
    `Ruta: ${routeBadge(status).label}`,
    `Señal: ${diagnostic.signaling}`,
    `Rol: ${diagnostic.role}`,
    `Presente: ${diagnostic.present ? 'sí' : 'no'}`,
    `Peer: ${diagnostic.peerExists ? 'sí' : 'no'}`,
    `WebRTC: ${diagnostic.connectionState}`,
    `ICE: ${diagnostic.iceConnectionState}`,
    `ICE gathering: ${diagnostic.iceGatheringState}`,
    `SDP: ${diagnostic.signalingState}`,
    `Canal: ${diagnostic.channelState}`,
    `Validado: ${diagnostic.validated ? 'sí' : 'no'}`,
    `Candidatos local/remoto: ${diagnostic.localCandidates}/${diagnostic.remoteCandidates}`,
    `Reintento: ${diagnostic.retryAttempt}`,
    `Sesión: ${diagnostic.sessionSuffix}`,
    `Negociación: ${diagnostic.negotiationSuffix}`,
    `Último: ${diagnostic.lastEvent}`,
  ].join('\n')
}

export function LinkedPanel({
  open,
  onClose,
  identity,
  identityStatus,
  onIdentityRefresh,
}: {
  open: boolean
  onClose: () => void
  identity: DeviceIdentitySnapshot | null
  identityStatus: DeviceIdentityStatus
  onIdentityRefresh: () => Promise<void>
}) {
  const [devices, setDevices] = useState<LinkedDeviceSnapshot[]>([])
  const [linkCode, setLinkCode] = useState<string | null>(null)
  const [linkExpiresAt, setLinkExpiresAt] = useState<number | null>(null)
  const [linkBaselineCount, setLinkBaselineCount] = useState<number | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null)
  const [deviceNameInput, setDeviceNameInput] = useState('')
  const [renamingDeviceId, setRenamingDeviceId] = useState<string | null>(null)
  const [confirmRemoveDeviceId, setConfirmRemoveDeviceId] = useState<string | null>(null)
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null)
  const [diagnosticDeviceId, setDiagnosticDeviceId] = useState<string | null>(null)
  const presenceKnownRef = useRef(false)
  const presenceRevisionRef = useRef(0)
  const [, setRouteVersion] = useState(0)
  const identityReady = identityStatus === 'ready' && Boolean(identity?.persisted)

  const identityTitle = identityStatus === 'ready'
    ? identity?.persisted ? 'Identidad segura activa' : 'Identidad segura local'
    : identityStatus === 'error'
      ? 'Identidad no verificada'
      : 'Verificando identidad'

  const identityDetail = identityStatus === 'ready' && identity
    ? `${identity.deviceLabel} · ${identity.deviceId.slice(-6).toUpperCase()}`
    : identityStatus === 'error'
      ? 'No se pudo verificar este dispositivo. Reabre OACLIX o revisa la conexión.'
      : 'Comprobando la clave de este dispositivo'

  const loadDevices = async () => {
    if (identityStatus !== 'ready' || !identity?.persisted) return []
    try {
      const result = await listLinkedDevices()
      setDevices(result.devices)
      if (result.personId !== identity.personId) await onIdentityRefresh()
      return result.devices
    } catch {
      setMessage('No se pudieron cargar los dispositivos')
      return []
    }
  }

  const refreshDevicesSilently = async () => {
    if (identityStatus !== 'ready' || !identity?.persisted) return
    try {
      const result = await listLinkedDevices()
      setDevices(result.devices)
      if (result.personId !== identity.personId) await onIdentityRefresh()
    } catch {
      // La pérdida de red también cierra realtime. En ese caso conservamos la UI
      // actual y esperamos a la recuperación normal, sin mostrar un error espurio.
    }
  }

  useEffect(() => {
    if (!open) return
    void loadDevices()
  }, [open, identityStatus, identity?.personId])

  useEffect(() => {
    if (!open || identityStatus !== 'ready' || !identity?.persisted || !identity.generalRoomId) return

    const roomId = identity.generalRoomId
    presenceKnownRef.current = isRealtimePresenceKnown(roomId)
    presenceRevisionRef.current = getRealtimePresenceRevision(roomId)
    const unsubscribe = subscribeDirectLanStatus(() => {
      setRouteVersion((current) => current + 1)
      const presenceKnown = isRealtimePresenceKnown(roomId)
      const presenceRevision = getRealtimePresenceRevision(roomId)
      const lostKnownPresence = presenceKnownRef.current && !presenceKnown
      const hasNewPresenceRevision = presenceRevision !== presenceRevisionRef.current
      presenceKnownRef.current = presenceKnown
      presenceRevisionRef.current = presenceRevision
      if (lostKnownPresence || hasNewPresenceRevision) void refreshDevicesSilently()
    })
    ensureClipboardRoomConnectivity(roomId)
    return () => {
      presenceKnownRef.current = false
      presenceRevisionRef.current = 0
      unsubscribe()
    }
  }, [open, identityStatus, identity?.persisted, identity?.generalRoomId, identity?.personId])

  useEffect(() => {
    if (
      !open
      || !linkCode
      || !linkExpiresAt
      || linkBaselineCount == null
      || identityStatus !== 'ready'
      || !identity?.persisted
    ) return

    let cancelled = false
    let timer: number | undefined
    let attempt = 0

    const clearLinkWait = (nextMessage: string) => {
      setLinkCode(null)
      setLinkExpiresAt(null)
      setLinkBaselineCount(null)
      setMessage(nextMessage)
    }

    const schedule = () => {
      if (cancelled) return
      const delay = nextLinkRefreshDelayMs(attempt, Date.now(), linkExpiresAt)
      if (delay == null) {
        clearLinkWait('El código de vínculo venció')
        return
      }

      timer = window.setTimeout(checkForLinkedDevice, delay)
    }

    const checkForLinkedDevice = async () => {
      if (cancelled) return
      const now = Date.now()
      if (now >= linkExpiresAt) {
        clearLinkWait('El código de vínculo venció')
        return
      }

      // No hacemos consultas mientras OACLIX está en segundo plano.
      if (!shouldQueryLinkedDevices(document.visibilityState, now, linkExpiresAt)) {
        attempt += 1
        schedule()
        return
      }

      try {
        const result = await listLinkedDevices()
        if (cancelled) return
        setDevices(result.devices)

        if (hasNewLinkedDevice(linkBaselineCount, result.devices.length)) {
          clearLinkWait('Nuevo dispositivo vinculado correctamente')
          return
        }
      } catch {
        // Un fallo temporal no genera un bucle agresivo ni reemplaza el estado visible.
      }

      attempt += 1
      schedule()
    }

    schedule()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [open, linkCode, linkExpiresAt, linkBaselineCount, identityStatus, identity?.persisted])

  const generateCode = async () => {
    setBusy(true)
    setMessage(null)
    try {
      // Fijamos una línea base real para detectar solo un nuevo vínculo y no hacer polling continuo.
      const currentDevices = await loadDevices()
      const result = await createDeviceLinkCode()
      setLinkBaselineCount(currentDevices.length)
      setLinkCode(result.code)
      setLinkExpiresAt(result.expiresAt)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo generar el código')
    } finally {
      setBusy(false)
    }
  }

  const joinWithCode = async () => {
    if (!codeInput.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      await consumeDeviceLinkCode(codeInput)
      setCodeInput('')
      setLinkCode(null)
      setLinkExpiresAt(null)
      setLinkBaselineCount(null)
      await onIdentityRefresh()
      const result = await listLinkedDevices()
      setDevices(result.devices)
      setMessage('Dispositivo vinculado correctamente')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo vincular el dispositivo')
    } finally {
      setBusy(false)
    }
  }

  const beginRename = (device: LinkedDeviceSnapshot) => {
    setConfirmRemoveDeviceId(null)
    setEditingDeviceId(device.id)
    setDeviceNameInput(device.label)
    setMessage(null)
  }

  const cancelRename = () => {
    setEditingDeviceId(null)
    setDeviceNameInput('')
  }

  const saveRename = async (deviceId: string) => {
    const label = deviceNameInput.trim()
    if (!label) {
      setMessage('Escribe un nombre para el dispositivo')
      return
    }

    setRenamingDeviceId(deviceId)
    setMessage(null)
    try {
      const result = await renameLinkedDevice(deviceId, label)
      setDevices((current) => current.map((device) => (
        device.id === deviceId ? { ...device, label: result.label } : device
      )))
      setEditingDeviceId(null)
      setDeviceNameInput('')
      if (deviceId === identity?.deviceId) await onIdentityRefresh()
      setMessage('Nombre actualizado')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cambiar el nombre')
    } finally {
      setRenamingDeviceId(null)
    }
  }

  const beginRemove = (deviceId: string) => {
    if (deviceId === identity?.deviceId) return
    setEditingDeviceId(null)
    setDeviceNameInput('')
    setDiagnosticDeviceId(null)
    setConfirmRemoveDeviceId(deviceId)
    setMessage(null)
  }

  const cancelRemove = () => {
    if (removingDeviceId) return
    setConfirmRemoveDeviceId(null)
  }

  const removeDevice = async (deviceId: string) => {
    if (deviceId === identity?.deviceId || removingDeviceId) return

    setRemovingDeviceId(deviceId)
    setMessage(null)
    try {
      const result = await unlinkLinkedDevice(deviceId)
      setDevices((current) => current.filter((device) => device.id !== deviceId))
      setConfirmRemoveDeviceId(null)
      setDiagnosticDeviceId((current) => current === deviceId ? null : current)
      setMessage(result.realtimeInvalidated
        ? 'Dispositivo desvinculado correctamente'
        : 'Dispositivo desvinculado. Una sesión directa ya abierta podría tardar en cerrarse.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo desvincular el dispositivo')
    } finally {
      setRemovingDeviceId(null)
    }
  }

  const copyDiagnostic = async (device: LinkedDeviceSnapshot, status: DeviceRouteStatus, diagnostic: LanPeerDiagnostic | null) => {
    try {
      await navigator.clipboard.writeText(diagnosticSummary(device.label, status, diagnostic))
      setMessage('Diagnóstico de ruta copiado')
    } catch {
      setMessage('No se pudo copiar el diagnóstico')
    }
  }

  return (
    <>
      <button className={`scrim ${open ? 'is-open' : ''}`} aria-label="Cerrar vinculados" type="button" onClick={onClose} />
      <aside className={`side-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <div className="side-panel__head">
          <div>
            <span className="eyebrow">Conectividad</span>
            <h2>Vinculados</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
        </div>

        <div className="route-card">
          <span className="route-card__icon"><Icon name="devices" /></span>
          <div><strong>{identityTitle}</strong><span>{identityDetail}</span></div>
          <span className={`status-dot ${identityStatus === 'ready' ? '' : 'is-off'}`} />
        </div>

        {identityReady ? (
          <section className="link-device-card">
            <div className="link-device-card__head">
              <div>
                <strong>Vincular otro dispositivo</strong>
                <span>Genera un código aquí o introduce uno generado por otro dispositivo OACLIX.</span>
              </div>
            </div>

            <button className="ghost-button link-device-card__generate" type="button" disabled={busy} onClick={generateCode}>
              <Icon name="plus" /> {linkCode ? 'Generar otro código' : 'Generar código'}
            </button>

            {linkCode ? (
              <div className="link-code" aria-live="polite">
                <strong>{linkCode}</strong>
                <span>Válido durante 10 minutos y para un solo vínculo.</span>
              </div>
            ) : null}

            <div className="link-code-entry">
              <input
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                placeholder="Tengo un código"
                aria-label="Código para vincular este dispositivo"
                maxLength={12}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
              <button className="ghost-button" type="button" disabled={busy || !codeInput.trim()} onClick={joinWithCode}>Vincular</button>
            </div>
            {message ? <p className="link-device-message" role="status">{message}</p> : null}
          </section>
        ) : null}

        <div className="linked-list real-device-list">
          <section className="person-group">
            <header>
              <span className="avatar-dot avatar-dot--large">T</span>
              <div><strong>Tu identidad</strong><span>{devices.length} {devices.length === 1 ? 'dispositivo vinculado' : 'dispositivos vinculados'}</span></div>
            </header>
            <div className="device-list">
              {devices.map((device) => {
                const isCurrent = device.id === identity?.deviceId
                const status = identity?.generalRoomId
                  ? getDeviceRouteStatus(identity.generalRoomId, device.id)
                  : 'checking'
                const diagnostic = identity?.generalRoomId && !isCurrent
                  ? getLanPeerDiagnostic(identity.generalRoomId, device.id)
                  : null
                const badge = isCurrent
                  ? { label: 'Aquí', className: 'is-here' }
                  : routeBadge(status)
                const editing = editingDeviceId === device.id
                const renaming = renamingDeviceId === device.id
                const confirmingRemoval = confirmRemoveDeviceId === device.id
                const removing = removingDeviceId === device.id
                const showDiagnostic = diagnosticDeviceId === device.id && !isCurrent && !confirmingRemoval

                return (
                  <div className={`device-row ${editing ? 'is-editing' : ''}`} key={device.id}>
                    <span className="device-row__icon"><Icon name="devices" /></span>
                    <div className="device-row__content">
                      {editing ? (
                        <div className="device-name-editor">
                          <input
                            value={deviceNameInput}
                            onChange={(event) => setDeviceNameInput(event.target.value)}
                            aria-label={`Nombre de ${device.label}`}
                            maxLength={48}
                            autoFocus
                            disabled={renaming}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void saveRename(device.id)
                              if (event.key === 'Escape') cancelRename()
                            }}
                          />
                          <div className="device-name-editor__actions">
                            <button type="button" disabled={renaming} onClick={cancelRename}>Cancelar</button>
                            <button type="button" disabled={renaming || !deviceNameInput.trim()} onClick={() => void saveRename(device.id)}>
                              {renaming ? 'Guardando…' : 'Guardar'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <strong>{device.label}</strong>
                          <span>{isCurrent ? 'Este dispositivo' : `ID · ${device.id.slice(-6).toUpperCase()}`}</span>
                          {confirmingRemoval ? (
                            <div className="device-remove-confirm" role="alert">
                              <span>Este equipo perderá acceso a tus dispositivos y nube compartida. Su identidad OACLIX y contenido local se conservan.</span>
                              <div>
                                <button type="button" disabled={removing} onClick={cancelRemove}>Cancelar</button>
                                <button className="is-danger" type="button" disabled={removing} onClick={() => void removeDevice(device.id)}>
                                  {removing ? 'Desvinculando…' : 'Confirmar desvincular'}
                                </button>
                              </div>
                            </div>
                          ) : null}
                          {showDiagnostic ? (
                            <div className="route-diagnostic" aria-live="polite">
                              {diagnostic ? (
                                <>
                                  <span>Señal: {diagnostic.signaling} · Rol: {diagnostic.role}</span>
                                  <span>WebRTC: {diagnostic.connectionState} · ICE: {diagnostic.iceConnectionState}</span>
                                  <span>Canal: {diagnostic.channelState} · Validado: {diagnostic.validated ? 'sí' : 'no'}</span>
                                  <span>Candidatos: {diagnostic.localCandidates}/{diagnostic.remoteCandidates} · Reintento: {diagnostic.retryAttempt}</span>
                                  <span>Último: {diagnostic.lastEvent}</span>
                                </>
                              ) : <span>Todavía no hay datos de la ruta directa.</span>}
                              <button type="button" onClick={() => void copyDiagnostic(device, status, diagnostic)}>Copiar diagnóstico</button>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                    <div className="device-row__tools">
                      {!editing && !confirmingRemoval ? (
                        <button className="device-rename-button" type="button" onClick={() => beginRename(device)} aria-label={`Cambiar nombre de ${device.label}`}>Editar</button>
                      ) : null}
                      {!editing && !isCurrent && !confirmingRemoval ? (
                        <button
                          className="device-rename-button"
                          type="button"
                          onClick={() => setDiagnosticDeviceId((current) => current === device.id ? null : device.id)}
                          aria-expanded={showDiagnostic}
                        >Ruta</button>
                      ) : null}
                      {!editing && !isCurrent && !confirmingRemoval ? (
                        <button className="device-remove-button" type="button" onClick={() => beginRemove(device.id)} aria-label={`Desvincular ${device.label}`}>Desvincular</button>
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
