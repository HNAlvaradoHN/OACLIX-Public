import { decideDirectFirstCloudExpiry } from './directFirstCloudExpiryPolicy.ts'
import type { DirectChangeEnvelope } from './directFirstProtocol.ts'

export type DirectFirstCloudFallbackSeed = {
  text: string
  createdAt?: number
  expiresAt?: number
}

export type DirectFirstCloudFallbackStep =
  | { type: 'create-text'; itemId: string; text: string; expiresAt: number }
  | { type: 'delete-text'; itemId: string }

export type DirectFirstCloudFallbackPlan =
  | { status: 'ready'; steps: DirectFirstCloudFallbackStep[] }
  | { status: 'expired'; steps: [] }
  | { status: 'blocked'; reason: 'missing-delete-seed' | 'invalid-expiry' }

/**
 * Prepara el mínimo trabajo cloud necesario para un cambio direct-first.
 *
 * Un contenido que nació direct-only nunca obtiene una nueva ventana al caer a
 * cloud: el create conserva exactamente su expiresAt original. Si ya venció,
 * la transición queda resuelta sin materializar contenido. Los checkpoints
 * legacy de delete que no permitan demostrar la expiración original fallan
 * cerrados en vez de inventar una nueva fecha.
 */
export function planDirectFirstCloudFallback({
  change,
  cloudCopyKnown,
  deleteSeed,
  now = Date.now(),
}: {
  change: DirectChangeEnvelope
  cloudCopyKnown: boolean
  deleteSeed?: DirectFirstCloudFallbackSeed
  now?: number
}): DirectFirstCloudFallbackPlan {
  if (change.operation === 'upsert') {
    if (typeof change.text !== 'string') throw new Error('Cambio upsert sin contenido')
    if (cloudCopyKnown) return { status: 'ready', steps: [] }

    const expiry = decideDirectFirstCloudExpiry(change.createdAt, change.expiresAt ?? Number.NaN, now)
    if (expiry.status === 'invalid') return { status: 'blocked', reason: 'invalid-expiry' }
    if (expiry.status === 'expired') return { status: 'expired', steps: [] }
    if (change.text.trim().length === 0) return { status: 'blocked', reason: 'missing-delete-seed' }
    return {
      status: 'ready',
      steps: [{
        type: 'create-text',
        itemId: change.itemId,
        text: change.text,
        expiresAt: expiry.expiresAt,
      }],
    }
  }

  if (cloudCopyKnown) {
    return {
      status: 'ready',
      steps: [{ type: 'delete-text', itemId: change.itemId }],
    }
  }

  if (!deleteSeed) return { status: 'blocked', reason: 'missing-delete-seed' }

  const expiry = decideDirectFirstCloudExpiry(
    deleteSeed.createdAt ?? Number.NaN,
    deleteSeed.expiresAt ?? Number.NaN,
    now,
  )
  if (expiry.status === 'invalid') return { status: 'blocked', reason: 'invalid-expiry' }
  // El texto pudo haberse eliminado localmente después de vencer. La metadata
  // temporal basta para cerrar la reconciliación sin volver a materializarlo.
  if (expiry.status === 'expired') return { status: 'expired', steps: [] }
  if (typeof deleteSeed.text !== 'string' || deleteSeed.text.trim().length === 0) {
    return { status: 'blocked', reason: 'missing-delete-seed' }
  }

  return {
    status: 'ready',
    steps: [
      {
        type: 'create-text',
        itemId: change.itemId,
        text: deleteSeed.text,
        expiresAt: expiry.expiresAt,
      },
      { type: 'delete-text', itemId: change.itemId },
    ],
  }
}

export type DirectFirstCloudFallbackBoundary = {
  createTextWithOriginalExpiry(roomId: string, itemId: string, text: string, expiresAt: number): Promise<unknown>
  deleteText(roomId: string, itemId: string): Promise<unknown>
}

export async function executeDirectFirstCloudFallback(
  roomId: string,
  plan: DirectFirstCloudFallbackPlan,
  boundary: DirectFirstCloudFallbackBoundary,
) {
  if (plan.status === 'blocked') throw new Error(`Fallback cloud bloqueado: ${plan.reason}`)
  if (plan.status === 'expired') return

  for (const step of plan.steps) {
    if (step.type === 'create-text') {
      await boundary.createTextWithOriginalExpiry(roomId, step.itemId, step.text, step.expiresAt)
    } else {
      await boundary.deleteText(roomId, step.itemId)
    }
  }
}
