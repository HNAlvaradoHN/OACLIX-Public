import { useState } from 'react'
import { copyImageUrlToSystemClipboard } from '../clipboard/imageSystemClipboard'
import type { ClipboardItem, PreserveTarget } from '../types'
import { ContentViewerModal } from './ContentViewerModal'
import { Icon } from './Icon'
import { PreserveHelpModal } from './PreserveHelpModal'

type CopyState = 'idle' | 'copied' | 'error'
type DeleteState = 'idle' | 'deleting' | 'error'
type PreserveState = 'idle' | 'saving' | 'releasing' | 'error'

type ClipboardCardProps = {
  item: ClipboardItem
  onDelete?: (id: string) => void | Promise<void>
  onShare?: (item: ClipboardItem) => void
  onPreserve?: (item: ClipboardItem, target: PreserveTarget) => void | Promise<void>
  onReleasePreserve?: (item: ClipboardItem) => void | Promise<void>
}

function formatImageSize(bytes?: number) {
  if (!bytes || bytes <= 0) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.ceil(bytes / 1024)} KB`
}

export function ClipboardCard({ item, onDelete, onShare, onPreserve, onReleasePreserve }: ClipboardCardProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [deleteState, setDeleteState] = useState<DeleteState>('idle')
  const [preserveState, setPreserveState] = useState<PreserveState>('idle')
  const [preserveOpen, setPreserveOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)

  const handleCopy = async () => {
    try {
      if (item.type === 'text' && item.text) {
        await navigator.clipboard.writeText(item.text)
      } else if (item.type === 'image' && item.imageUrl) {
        await copyImageUrlToSystemClipboard(item.imageUrl)
      } else {
        throw new Error('Contenido no disponible')
      }
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
    window.setTimeout(() => setCopyState('idle'), 1400)
  }

  const handleDelete = async () => {
    if (!onDelete || deleteState === 'deleting') return
    setDeleteState('deleting')
    try {
      await onDelete(item.id)
    } catch {
      setDeleteState('error')
      window.setTimeout(() => setDeleteState('idle'), 1600)
    }
  }

  const handlePreserve = async (target: PreserveTarget) => {
    if (!onPreserve || preserveState === 'saving') return
    setPreserveState('saving')
    try {
      await onPreserve(item, target)
      setPreserveState('idle')
    } catch (error) {
      setPreserveState('error')
      throw error
    }
  }

  const handleReleasePreserve = async () => {
    if (!onReleasePreserve || preserveState === 'releasing') return
    setPreserveState('releasing')
    try {
      await onReleasePreserve(item)
      setPreserveState('idle')
    } catch {
      setPreserveState('error')
      window.setTimeout(() => setPreserveState('idle'), 1600)
    }
  }

  const copyLabel = copyState === 'copied' ? 'Copiado' : copyState === 'error' ? 'No se pudo copiar' : 'Copiar'
  const deleteLabel = deleteState === 'deleting' ? 'Eliminando…' : deleteState === 'error' ? 'No se pudo eliminar' : 'Eliminar'
  const preserveLabel = item.preserveTarget
    ? preserveState === 'releasing' ? 'Quitando…' : 'Fijado'
    : 'Conservar'
  const imageSize = formatImageSize(item.imageByteSize)

  return (
    <>
      <article className={`clip-card clip-card--${item.type} ${item.preserveTarget ? 'is-preserved' : ''}`}>
        <div className="clip-card__meta">
          <span className="avatar-dot">{item.author.slice(0, 1).toUpperCase()}</span>
          <span>{item.author}</span>
          {item.preserveTarget && <span className="clip-card__preserved"><Icon name="pin" /> Fijado aquí</span>}
          <span className="clip-card__type"><Icon name={item.type === 'image' ? 'image' : 'clipboard'} /> {item.type === 'image' ? 'Imagen' : 'Texto'}</span>
        </div>

        {item.type === 'text' ? (
          <button
            className="clip-card__content-preview clip-card__content-preview--text"
            type="button"
            onClick={() => setViewerOpen(true)}
            aria-label="Abrir texto completo"
          >
            <span className="clip-card__text">{item.text}</span>
            <span className="clip-card__open-hint">Abrir</span>
          </button>
        ) : (
          <button
            className="clip-card__content-preview clip-card__content-preview--image"
            type="button"
            onClick={() => setViewerOpen(true)}
            aria-label="Abrir imagen completa"
          >
            {item.imageUrl ? (
              <span className="image-real-preview">
                <img src={item.imageUrl} alt={item.imageLabel ?? 'Imagen'} />
                <span className="image-real-preview__meta">Imagen{imageSize ? ` · ${imageSize}` : ''}</span>
              </span>
            ) : (
              <span className="image-mock" role="img" aria-label="Vista previa simulada de imagen">
                <span className="image-mock__orb image-mock__orb--one" />
                <span className="image-mock__orb image-mock__orb--two" />
                <span className="image-mock__grid" />
                <span className="image-mock__label">{item.imageLabel}</span>
              </span>
            )}
          </button>
        )}

        <div className="clip-card__actions">
          <button className={`action-pill ${copyState === 'copied' ? 'is-success' : ''}`} type="button" onClick={() => void handleCopy()}>
            <Icon name="copy" /> {copyLabel}
          </button>
          {onShare && (
            <button className="action-pill" type="button" onClick={() => onShare(item)}>
              <Icon name="devices" /> Enviar
            </button>
          )}
          {onPreserve && (
            <button
              className={`action-pill action-pill--preserve ${item.preserveTarget ? 'is-active' : ''}`}
              type="button"
              disabled={preserveState === 'saving' || preserveState === 'releasing'}
              onClick={() => item.preserveTarget ? void handleReleasePreserve() : setPreserveOpen(true)}
            >
              <Icon name="pin" /> {preserveLabel}
            </button>
          )}
          {item.type === 'image' && !item.imageUrl && <button className="action-pill" type="button"><Icon name="crop" /> Recortar</button>}
          {item.ownedByMe && onDelete && (
            <button
              className="action-pill action-pill--danger"
              type="button"
              disabled={deleteState === 'deleting'}
              onClick={() => void handleDelete()}
            >
              <Icon name="trash" /> {deleteLabel}
            </button>
          )}
        </div>
      </article>

      <ContentViewerModal open={viewerOpen} item={item} onClose={() => setViewerOpen(false)} />

      <PreserveHelpModal
        open={preserveOpen}
        mode="select"
        initialTarget="device"
        onClose={() => setPreserveOpen(false)}
        onConfirm={handlePreserve}
      />
    </>
  )
}
