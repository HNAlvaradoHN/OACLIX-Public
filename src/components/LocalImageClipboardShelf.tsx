import { useEffect, useMemo, useState } from 'react'
import {
  deleteLocalImage,
  readLocalImages,
  type LocalImageClipboardSnapshot,
} from '../data/localImageClipboard'
import { subscribeAllLocalImageReceipts } from '../transport/localImageReceiptBus'
import type { ClipboardItem } from '../types'
import { ClipboardCard } from './ClipboardCard'

type LocalImageClipboardShelfProps = {
  onShare?: (item: ClipboardItem) => void
}

function authorForImage(image: LocalImageClipboardSnapshot) {
  if (!image.receivedFromDeviceId) return 'Este dispositivo'
  return image.receivedVia === 'direct'
    ? 'Dispositivo vinculado · Directo'
    : 'Dispositivo vinculado · Nube'
}

export function LocalImageClipboardShelf({ onShare }: LocalImageClipboardShelfProps) {
  const [images, setImages] = useState<LocalImageClipboardSnapshot[]>([])

  useEffect(() => {
    let active = true
    const refresh = () => {
      void readLocalImages().then((items) => {
        if (active) setImages(items)
      }).catch(() => undefined)
    }
    refresh()
    const unsubscribe = subscribeAllLocalImageReceipts(refresh)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const cards = useMemo(() => images.map((image) => ({
    image,
    url: URL.createObjectURL(image.blob),
  })), [images])

  useEffect(() => () => {
    for (const card of cards) URL.revokeObjectURL(card.url)
  }, [cards])

  if (cards.length === 0) return null

  return (
    <div className="local-image-shelf" aria-label="Imágenes locales recientes">
      {cards.map(({ image, url }) => {
        const item: ClipboardItem = {
          id: image.id,
          type: 'image',
          author: authorForImage(image),
          imageUrl: url,
          imageLabel: 'Imagen local',
          imageMimeType: image.mimeType,
          imageByteSize: image.byteSize,
          ownedByMe: true,
        }
        return (
          <ClipboardCard
            key={image.id}
            item={item}
            onShare={onShare}
            onDelete={async () => {
              await deleteLocalImage(image.id)
              setImages((current) => current.filter((entry) => entry.id !== image.id))
            }}
          />
        )
      })}
    </div>
  )
}