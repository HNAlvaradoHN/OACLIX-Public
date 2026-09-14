import { useState } from 'react'
import type { ClipboardItem } from '../types'
import { ContentViewerModal } from './ContentViewerModal'
import { Icon } from './Icon'

type PreservedPanelProps = {
  open: boolean
  items: ClipboardItem[]
  onClose: () => void
  onRelease: (item: ClipboardItem) => void | Promise<void>
}

export function PreservedPanel({ open, items, onClose, onRelease }: PreservedPanelProps) {
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null)
  const [releaseErrorId, setReleaseErrorId] = useState<string | null>(null)
  const [viewerItem, setViewerItem] = useState<ClipboardItem | null>(null)

  const copyItem = async (item: ClipboardItem) => {
    if (item.type !== 'text' || !item.text) return
    try {
      await navigator.clipboard.writeText(item.text)
      setCopiedItemId(item.id)
      window.setTimeout(() => setCopiedItemId((current) => current === item.id ? null : current), 1200)
    } catch {
      setCopiedItemId(null)
    }
  }

  const releaseItem = async (item: ClipboardItem) => {
    if (busyItemId) return
    setBusyItemId(item.id)
    setReleaseErrorId(null)
    try {
      await onRelease(item)
    } catch {
      setReleaseErrorId(item.id)
    } finally {
      setBusyItemId(null)
    }
  }

  return (
    <>
      <button
        className={`scrim ${open ? 'is-open' : ''}`}
        type="button"
        aria-label="Cerrar conservados"
        onClick={onClose}
      />
      <aside className={`side-panel preserved-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <div className="side-panel__head preserved-panel__head">
          <div>
            <span className="eyebrow"><Icon name="pin" /> Guardado por ti</span>
            <h2>Conservados</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar conservados">
            <Icon name="x" />
          </button>
        </div>

        <p className="preserved-panel__summary">
          {items.length === 0
            ? 'Aquí aparecerá lo que decidas fijar.'
            : `${items.length} ${items.length === 1 ? 'elemento fijado' : 'elementos fijados'}`}
        </p>

        <div className="preserved-panel__list">
          {items.map((item) => (
            <article className="preserved-panel__item" key={item.id}>
              <div className="preserved-panel__item-top">
                <span className="preserved-panel__pin"><Icon name="pin" /></span>
                <div>
                  <strong>{item.author}</strong>
                  <span>Este dispositivo</span>
                </div>
              </div>

              <button className="preserved-panel__preview" type="button" onClick={() => setViewerItem(item)}>
                <span className="preserved-panel__text">
                  {item.type === 'text' ? item.text : item.imageLabel ?? 'Contenido conservado'}
                </span>
                <span>Abrir</span>
              </button>

              <div className="preserved-panel__actions">
                {item.type === 'text' && (
                  <button className="action-pill" type="button" onClick={() => void copyItem(item)}>
                    <Icon name="copy" /> {copiedItemId === item.id ? 'Copiado' : 'Copiar'}
                  </button>
                )}
                <button
                  className="action-pill action-pill--preserve"
                  type="button"
                  disabled={busyItemId === item.id}
                  onClick={() => void releaseItem(item)}
                >
                  <Icon name="pin" /> {busyItemId === item.id ? 'Quitando…' : 'Quitar pin'}
                </button>
              </div>
              {releaseErrorId === item.id && <span className="preserved-panel__error">No se pudo quitar. Intenta otra vez.</span>}
            </article>
          ))}
        </div>
      </aside>

      {viewerItem && (
        <ContentViewerModal open item={viewerItem} onClose={() => setViewerItem(null)} />
      )}
    </>
  )
}
