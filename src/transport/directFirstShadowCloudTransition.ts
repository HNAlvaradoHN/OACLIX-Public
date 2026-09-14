import {
  planDirectFirstCloudFallback,
  type DirectFirstCloudFallbackBoundary,
} from './directFirstCloudFallbackPlan.ts'
import type { DirectFirstPrepCoordinator } from './directFirstPrepCoordinator.ts'

export type DirectFirstShadowCloudTransitionResult = {
  cloudWrites: number
  committedChangeIds: string[]
  expiredChangeIds: string[]
  blockedChangeIds: string[]
}

/**
 * Reconciliación Directo → Nube.
 *
 * Cada create conserva la expiración original. Un item ya vencido se marca como
 * reconciliado sin crear contenido cloud. Los pasos que sí escriben cloud quedan
 * seguidos por checkpoints durables para conservar las ventanas de crash del
 * flujo seed/create/delete con el mismo itemId.
 */
export async function reconcileDirectFirstShadowCloudTransition({
  coordinator,
  directDeviceIds,
  cloudAvailable,
  roomId,
  boundary,
  now = Date.now(),
}: {
  coordinator: DirectFirstPrepCoordinator
  directDeviceIds: Iterable<string>
  cloudAvailable: boolean
  roomId: string
  boundary: DirectFirstCloudFallbackBoundary
  now?: number
}): Promise<DirectFirstShadowCloudTransitionResult> {
  const result: DirectFirstShadowCloudTransitionResult = {
    cloudWrites: 0,
    committedChangeIds: [],
    expiredChangeIds: [],
    blockedChangeIds: [],
  }
  if (!cloudAvailable) return result

  const candidates = coordinator.pendingCloudFallbackChanges(directDeviceIds)
  for (const { change } of candidates) {
    if (coordinator.cloudChangeCommitted(change.changeId)) continue

    const plan = planDirectFirstCloudFallback({
      change,
      cloudCopyKnown: coordinator.cloudItemKnown(change.itemId),
      deleteSeed: coordinator.cloudFallbackSeed(change.changeId, change.itemId),
      now,
    })
    if (plan.status === 'blocked') {
      result.blockedChangeIds.push(change.changeId)
      continue
    }
    if (plan.status === 'expired') {
      coordinator.markCloudChangeExpired(change.changeId)
      await coordinator.persist(now)
      result.expiredChangeIds.push(change.changeId)
      continue
    }

    for (const step of plan.steps) {
      if (step.type === 'create-text') {
        await boundary.createTextWithOriginalExpiry(roomId, step.itemId, step.text, step.expiresAt)
        result.cloudWrites += 1
        coordinator.markCloudItemKnown(step.itemId)
        // Este checkpoint intermedio es obligatorio para delete direct-only:
        // después de crear la semilla, un reinicio debe reanudar desde delete.
        await coordinator.persist(now)
        continue
      }

      await boundary.deleteText(roomId, step.itemId)
      result.cloudWrites += 1
    }

    coordinator.markCloudChangeCommitted(change.changeId)
    await coordinator.persist(now)
    result.committedChangeIds.push(change.changeId)
  }

  return result
}
