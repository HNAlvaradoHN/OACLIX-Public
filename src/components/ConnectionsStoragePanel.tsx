import { useState } from 'react'
import { Icon } from './Icon'
import { PreserveHelpModal } from './PreserveHelpModal'

export function ConnectionsStoragePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [preserveHelpOpen, setPreserveHelpOpen] = useState(false)

  if (!open) return null

  return (
    <>
      <button className="connections-scrim" type="button" aria-label="Cerrar conexiones y espacio" onClick={onClose} />
      <section className="connections-panel" role="dialog" aria-modal="true" aria-labelledby="connections-title">
        <header className="connections-panel__head">
          <div>
            <span className="eyebrow">Cómo funciona</span>
            <h2 id="connections-title">Conexiones y espacio</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar conexiones y espacio" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        <div className="connections-hero">
          <div className="route-demo" aria-hidden="true">
            <span className="route-demo__device"><Icon name="devices" /></span>
            <span className="route-demo__line"><i /></span>
            <span className="route-demo__device route-demo__device--right"><Icon name="monitor" /></span>
          </div>
          <div>
            <strong>OACLIX busca el camino más rápido.</strong>
            <p>Si puede ir directo, no gasta tu espacio de nube OACLIX.</p>
          </div>
        </div>

        <div className="connection-cards">
          <article className="connection-card connection-card--direct">
            <div className="connection-card__visual direct-visual" aria-hidden="true">
              <span className="direct-visual__node"><Icon name="wifi" /></span>
              <span className="direct-visual__beam"><i /></span>
              <span className="direct-visual__node"><Icon name="devices" /></span>
            </div>
            <div className="connection-card__copy">
              <div className="connection-card__title">
                <span className="connection-card__icon"><Icon name="wifi" /></span>
                <div><strong>Directo</strong><small>La ruta preferida</small></div>
              </div>
              <p>Cuando tus equipos pueden conectarse entre ellos, OACLIX manda directo. Es más rápido y no gasta nube OACLIX. Al llegar imágenes y archivos, esta ruta también permitirá envíos más pesados.</p>
              <span className="benefit-pill">Más rápido · sin gastar nube</span>
            </div>
          </article>

          <article className="connection-card connection-card--cloud">
            <div className="connection-card__visual cloud-visual" aria-hidden="true">
              <span className="cloud-visual__ring" />
              <strong>100 MB</strong>
              <span className="cloud-visual__in">Nuevo</span>
              <span className="cloud-visual__out">Antiguo</span>
            </div>
            <div className="connection-card__copy">
              <div className="connection-card__title">
                <span className="connection-card__icon"><Icon name="clipboard" /></span>
                <div><strong>Nube OACLIX</strong><small>100 MB incluidos</small></div>
              </div>
              <p>Si no hay conexión directa, tendrás 100 MB para lo que necesite nube. No se bloquea al llenarse: lo nuevo entra y lo más antiguo va dejando espacio.</p>
              <span className="benefit-pill">Siempre reutilizable</span>
            </div>
          </article>

          <article className="connection-card connection-card--personal">
            <div className="connection-card__visual personal-visual" aria-hidden="true">
              <span className="personal-visual__drive">Drive</span>
              <span className="personal-visual__file personal-visual__file--one" />
              <span className="personal-visual__file personal-visual__file--two" />
              <span className="personal-visual__clean"><Icon name="spark" /></span>
            </div>
            <div className="connection-card__copy">
              <div className="connection-card__title">
                <span className="connection-card__icon"><Icon name="monitor" /></span>
                <div><strong>Tu nube personal</strong><small>Google Drive será la primera</small></div>
              </div>
              <p>Al conectarla podrás ganar más capacidad para envíos grandes usando tu propio espacio. Si no marcas algo para conservar, OACLIX podrá limpiar lo temporal para no dejar archivos basura.</p>
              <span className="benefit-pill benefit-pill--soon">Próximamente</span>
            </div>
          </article>
        </div>

        <div className="connections-cleanup">
          <div className="cleanup-loop" aria-hidden="true">
            <span>Nuevo</span><i>→</i><span>Usar</span><i>→</i><span>Libera</span>
          </div>
          <div>
            <strong>Tu espacio no se llena solo.</strong>
            <p>
              Lo temporal se reutiliza. Lo que quieras guardar por más tiempo se podrá marcar como <b>Conservar</b>{' '}
              <button
                className="preserve-help-trigger"
                type="button"
                aria-label="Ver formas de conservar"
                onClick={() => setPreserveHelpOpen(true)}
              >i</button>.
            </p>
          </div>
        </div>

        <div className="connections-security">
          <span><Icon name="lock" /></span>
          <div>
            <strong>Tu cuenta sigue siendo tuya.</strong>
            <p>Cuando conectemos una nube personal, OACLIX pedirá solo el acceso necesario. Nunca tu contraseña y podrás desconectarla cuando quieras.</p>
          </div>
        </div>

        <p className="connections-footnote">Sin conectar nada extra, puedes seguir usando OACLIX normalmente. La nube personal se mostrará como opción cuando esté lista.</p>
      </section>
      <PreserveHelpModal open={preserveHelpOpen} onClose={() => setPreserveHelpOpen(false)} />
    </>
  )
}
