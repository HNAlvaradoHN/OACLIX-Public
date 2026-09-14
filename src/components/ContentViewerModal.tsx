import { useEffect, useState } from 'react'
import type { ClipboardItem } from '../types'
import { Icon } from './Icon'

type ContentViewerModalProps = {
  open: boolean
  item: ClipboardItem
  onClose: () => void
}

export function ContentViewerModal({ open, item, onClose }: ContentViewerModalProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setCopied(false)

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])

  if (!open) return null

  const copyFullText = async () => {
    if (item.type !== 'text' || !item.text) return
    try {
      await navigator.clipboard.writeText(item.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <button className="content-viewer__scrim" type="button" aria-label="Cerrar contenido" onClick={onClose} />
      <section className="content-viewer" role="dialog" aria-modal="true" aria-labelledby="content-viewer-title">
        <header className="content-viewer__head">
          <div>
            <span className="eyebrow">Contenido completo</span>
            <h2 id="content-viewer-title">{item.type === 'image' ? 'Imagen' : 'Texto'}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar contenido">
            <Icon name="x" />
          </button>
        </header>

        <div className="content-viewer__body">
          {item.type === 'text' ? (
            <pre className="content-viewer__text">{item.text}</pre>
          ) : item.imageUrl ? (
            <img className="content-viewer__image-real" src={item.imageUrl} alt={item.imageLabel ?? 'Imagen'} />
          ) : (
            <div className="content-viewer__image-mock" role="img" aria-label={item.imageLabel ?? 'Imagen'}>
              <span className="image-mock__orb image-mock__orb--one" />
              <span className="image-mock__orb image-mock__orb--two" />
              <span className="image-mock__grid" />
              <span className="image-mock__label">{item.imageLabel}</span>
            </div>
          )}
        </div>

        <footer className="content-viewer__footer">
          {item.type === 'text' && (
            <button className={`action-pill ${copied ? 'is-success' : ''}`} type="button" onClick={() => void copyFullText()}>
              <Icon name="copy" /> {copied ? 'Copiado' : 'Copiar todo'}
            </button>
          )}
          <button className="ghost-button" type="button" onClick={onClose}>Cerrar</button>
        </footer>
      </section>
    </>
  )
}
