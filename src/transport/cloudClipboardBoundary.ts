export type CloudClipboardDelegate<CreateResult, DeleteResult, ListResult> = {
  createText(roomId: string, text: string): Promise<CreateResult>
  createTextWithItemId(roomId: string, itemId: string, text: string): Promise<CreateResult>
  createTextWithOriginalExpiry(roomId: string, itemId: string, text: string, expiresAt: number): Promise<CreateResult>
  deleteText(roomId: string, itemId: string): Promise<DeleteResult>
  listChanges(roomId: string, after: number): Promise<ListResult>
}

export type CloudContentWriteEvent = {
  operation: 'create-text' | 'delete-text'
  phase: 'attempt' | 'success' | 'failure'
  roomId: string
  itemId?: string
}

export type CloudContentWriteListener = (event: CloudContentWriteEvent) => void

/**
 * Frontera observable para contenido cloud del portapapeles.
 *
 * No conoce HTTP, D1 ni la implementación real del backend. Producción inyecta
 * esas funciones en otro módulo; las pruebas usan la misma frontera con dobles.
 * Así podemos demostrar si un flujo intenta cruzar hacia contenido cloud sin
 * hacer solicitudes reales ni añadir persistencia de métricas.
 */
export function createCloudClipboardBoundary<CreateResult, DeleteResult, ListResult>(
  delegate: CloudClipboardDelegate<CreateResult, DeleteResult, ListResult>,
) {
  const listeners = new Set<CloudContentWriteListener>()

  const publish = (event: CloudContentWriteEvent) => {
    for (const listener of listeners) listener(event)
  }

  const create = async (
    roomId: string,
    text: string,
    options: { itemId?: string; expiresAt?: number } = {},
  ) => {
    const { itemId, expiresAt } = options
    publish({ operation: 'create-text', phase: 'attempt', roomId, itemId })
    try {
      const result = expiresAt !== undefined
        ? await delegate.createTextWithOriginalExpiry(roomId, itemId!, text, expiresAt)
        : itemId
          ? await delegate.createTextWithItemId(roomId, itemId, text)
          : await delegate.createText(roomId, text)
      publish({ operation: 'create-text', phase: 'success', roomId, itemId })
      return result
    } catch (error) {
      publish({ operation: 'create-text', phase: 'failure', roomId, itemId })
      throw error
    }
  }

  return {
    createText(roomId: string, text: string) {
      return create(roomId, text)
    },

    createTextWithItemId(roomId: string, itemId: string, text: string) {
      return create(roomId, text, { itemId })
    },

    createTextWithOriginalExpiry(roomId: string, itemId: string, text: string, expiresAt: number) {
      return create(roomId, text, { itemId, expiresAt })
    },

    async deleteText(roomId: string, itemId: string) {
      publish({ operation: 'delete-text', phase: 'attempt', roomId, itemId })
      try {
        const result = await delegate.deleteText(roomId, itemId)
        publish({ operation: 'delete-text', phase: 'success', roomId, itemId })
        return result
      } catch (error) {
        publish({ operation: 'delete-text', phase: 'failure', roomId, itemId })
        throw error
      }
    },

    listChanges(roomId: string, after: number) {
      return delegate.listChanges(roomId, after)
    },

    subscribeContentWrites(listener: CloudContentWriteListener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
