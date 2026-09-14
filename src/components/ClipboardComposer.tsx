import { ClipboardEvent, FormEvent, useState, useSyncExternalStore } from 'react'
import { imageBlobFromPaste, readImageFromSystemClipboard } from '../clipboard/imageSystemClipboard'
import { storeLocalImageBlob } from '../data/localImageClipboard'
import { hasDirectLanPeer, subscribeDirectLanStatus } from '../realtime/lanStatus'
import { clipboardRouteLabel } from '../realtime/routePolicy'
import { publishLocalImageMutation } from '../transport/localImageReceiptBus'
import type { ClipboardItem } from '../types'
import { Icon } from './Icon'
import { LocalImageClipboardShelf } from './LocalImageClipboardShelf'

export function ClipboardComposer({
  disabled,
  cloudConnected = false,
  label = 'Enviar a General',
  submitLabel = 'Enviar texto',
  busyLabel = 'Enviando…',
  routeText,
  textareaId = 'general-text',
  onSend,
  onShareImage,
}: {
  disabled?: boolean
  cloudConnected?: boolean
  label?: string
  submitLabel?: string
  busyLabel?: string
  routeText?: string
  textareaId?: string
  onSend: (text: string) => Promise<void>
  onShareImage?: (item: ClipboardItem) => void
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageMessage, setImageMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const directLanAvailable = useSyncExternalStore(
    subscribeDirectLanStatus,
    hasDirectLanPeer,
    () => false,
  )
  const visibleRoute = routeText ?? clipboardRouteLabel(directLanAvailable, cloudConnected)
  const localClipboard = textareaId === 'local-text'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (disabled || sending || text.trim().length === 0) return

    setSending(true)
    setError(null)
    try {
      await onSend(text)
      setText('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el texto')
    } finally {
      setSending(false)
    }
  }

  const saveLocalImage = async (blob: Blob) => {
    const item = await storeLocalImageBlob(blob)
    publishLocalImageMutation(item)
    setImageMessage('Imagen guardada en Mi portapapeles')
  }

  const pasteImageFromSystem = async () => {
    if (!localClipboard || disabled || imageBusy) return
    setImageBusy(true)
    setError(null)
    setImageMessage('Leyendo imagen…')
    try {
      const blob = await readImageFromSystemClipboard()
      setImageMessage('Guardando imagen…')
      await saveLocalImage(blob)
    } catch (reason) {
      setImageMessage(null)
      setError(reason instanceof Error ? reason.message : 'No se pudo pegar la imagen')
    } finally {
      setImageBusy(false)
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!localClipboard || disabled || imageBusy) return
    const blob = imageBlobFromPaste(event.clipboardData)
    if (!blob) return
    event.preventDefault()
    setImageBusy(true)
    setError(null)
    setImageMessage('Guardando imagen…')
    void saveLocalImage(blob)
      .catch((reason) => {
        setImageMessage(null)
        setError(reason instanceof Error ? reason.message : 'No se pudo pegar la imagen')
      })
      .finally(() => setImageBusy(false))
  }

  return (
    <>
      <form className="clip-composer" onSubmit={submit}>
        <label className="clip-composer__label" htmlFor={textareaId}>{label}</label>
        <textarea
          id={textareaId}
          maxLength={8000}
          placeholder={localClipboard ? 'Escribe o pega texto o una imagen aquí…' : 'Escribe o pega texto aquí…'}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={handlePaste}
          disabled={disabled || sending}
          rows={3}
        />
        <div className="clip-composer__footer">
          <span className="clip-composer__hint">
            {text.length.toLocaleString()} / 8.000 · {visibleRoute}
          </span>
          <div className="clip-composer__actions">
            {localClipboard ? (
              <button
                className="ghost-button"
                type="button"
                disabled={disabled || imageBusy}
                onClick={() => void pasteImageFromSystem()}
              >
                <Icon name="image" /> {imageBusy ? 'Pegando…' : 'Pegar imagen'}
              </button>
            ) : null}
            <button className="ghost-button" type="submit" disabled={disabled || sending || text.trim().length === 0}>
              <Icon name={sending ? 'devices' : 'plus'} /> {sending ? busyLabel : submitLabel}
            </button>
          </div>
        </div>
        {imageMessage && <p className="clip-composer__status" role="status">{imageMessage}</p>}
        {error && <p className="clip-composer__error" role="alert">{error}</p>}
      </form>
      {localClipboard ? <LocalImageClipboardShelf onShare={onShareImage} /> : null}
    </>
  )
}
