import {
  createCloudClipboardText,
  createCloudClipboardTextWithItemId,
  createCloudClipboardTextWithOriginalExpiry,
  deleteCloudClipboardText,
  listCloudClipboardChanges,
} from '../data/clipboardCloudApi'
import { createCloudClipboardBoundary } from './cloudClipboardBoundary'

/**
 * Instancia productiva: todas las escrituras cloud del portapapeles deben pasar
 * por esta frontera para que direct-first pueda demostrar cuándo la evita.
 */
export const cloudClipboardBoundary = createCloudClipboardBoundary({
  createText: createCloudClipboardText,
  createTextWithItemId: createCloudClipboardTextWithItemId,
  createTextWithOriginalExpiry: createCloudClipboardTextWithOriginalExpiry,
  deleteText: deleteCloudClipboardText,
  listChanges: listCloudClipboardChanges,
})
