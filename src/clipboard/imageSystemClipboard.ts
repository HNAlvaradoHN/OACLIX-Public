const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

function supportedImageType(types: readonly string[]) {
  return SUPPORTED_IMAGE_TYPES.find((type) => types.includes(type)) ?? null
}

export function isSupportedImageClipboardType(type: string) {
  return SUPPORTED_IMAGE_TYPES.includes(type as (typeof SUPPORTED_IMAGE_TYPES)[number])
}

export function imageBlobFromPaste(dataTransfer: DataTransfer) {
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file' || !isSupportedImageClipboardType(item.type)) continue
    const file = item.getAsFile()
    if (file && file.size > 0) return file
  }
  return null
}

export async function readImageFromSystemClipboard() {
  const clipboard = navigator.clipboard as Clipboard & {
    read?: () => Promise<ClipboardItem[]>
  }
  if (!clipboard?.read) {
    throw new Error('Este navegador no permite leer imágenes del portapapeles desde OACLIX')
  }

  const items = await clipboard.read()
  for (const item of items) {
    const type = supportedImageType(item.types)
    if (!type) continue
    const blob = await item.getType(type)
    if (blob.size > 0) return blob
  }
  throw new Error('No hay una imagen compatible en el portapapeles')
}

async function imageBlobToPng(blob: Blob) {
  if (blob.type === 'image/png') return blob

  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('No se pudo preparar la imagen para copiar'))
      element.src = objectUrl
    })
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new Error('La imagen no tiene dimensiones válidas')
    }

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('El navegador no puede preparar imágenes para copiar')
    context.drawImage(image, 0, 0)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error('No se pudo convertir la imagen a PNG'))
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function copyImageUrlToSystemClipboard(imageUrl: string) {
  const clipboard = navigator.clipboard
  const ClipboardItemConstructor = globalThis.ClipboardItem
  if (!clipboard?.write || typeof ClipboardItemConstructor !== 'function') {
    throw new Error('Este navegador no permite copiar imágenes desde OACLIX')
  }

  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error('No se pudo leer la imagen guardada')
  const source = await response.blob()
  if (!source.type.startsWith('image/') || source.size <= 0) {
    throw new Error('La imagen guardada no es válida')
  }

  const png = await imageBlobToPng(source)
  await clipboard.write([new ClipboardItemConstructor({ 'image/png': png })])
}
