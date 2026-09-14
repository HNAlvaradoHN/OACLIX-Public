import type { ClipboardTextSnapshot } from '../data/clipboardCloudApi'
import type {
  LanDirectFirstPrepAck,
  LanDirectFirstPrepMeta,
} from '../realtime/lanDirectFirstPrep'
import type { LanDirectFirstGapRequest } from '../realtime/lanDirectFirstRepair'
import type { DirectFirstCloudFallbackBoundary } from './directFirstCloudFallbackPlan.ts'
import type {
  DirectFirstDeleteFallbackSeed,
  DirectFirstPrepCoordinator,
} from './directFirstPrepCoordinator'
import {
  directFirstContentExpiresAt,
  redactExpiredDirectFirstChange,
} from './directFirstPersistentState.ts'
import { reconcileDirectFirstShadowCloudTransition } from './directFirstShadowCloudTransition.ts'
import type { DirectChangeEnvelope, DirectDeliveryTrackerSnapshot } from './directFirstProtocol'

export type DirectFirstPrepCoordinatorLoader = (
  roomId: string,
  localDeviceId: string,
) => Promise<DirectFirstPrepCoordinator>

type DirectChangeFactory = (coordinator: DirectFirstPrepCoordinator) => DirectChangeEnvelope

type PrepareChangeOptions = {
  cloudCommitted?: boolean
  deleteFallbackSeed?: (coordinator: DirectFirstPrepCoordinator) => DirectFirstDeleteFallbackSeed | undefined
}

function randomChangeId() {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return `chg_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

function nextLocalAuthorSequence(coordinator: DirectFirstPrepCoordinator, localDeviceId: string) {
  const replay = coordinator.snapshot().replayLogs.find((entry) => entry.authorDeviceId === localDeviceId)
  const latest = replay?.changes.reduce((highest, change) => Math.max(highest, change.authorSequence), 0) ?? 0
  return latest + 1
}

/**
 * Integración persistente entre direct-first y el DataChannel productivo.
 * El checkpoint se escribe antes del envío y conserva ACK/replay/fallback cloud.
 */
export class DirectFirstShadowOutbound {
  private readonly coordinators = new Map<string, Promise<DirectFirstPrepCoordinator>>()
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly loadCoordinator: DirectFirstPrepCoordinatorLoader
  private readonly createChangeId: () => string

  constructor(
    loadCoordinator: DirectFirstPrepCoordinatorLoader,
    createChangeId: () => string = randomChangeId,
  ) {
    this.loadCoordinator = loadCoordinator
    this.createChangeId = createChangeId
  }

  prepareUpsert(
    roomId: string,
    item: ClipboardTextSnapshot,
    destinationDeviceIds: Iterable<string>,
    options: { cloudCommitted?: boolean } = {},
  ): Promise<LanDirectFirstPrepMeta | null> {
    return this.prepareChange(
      roomId,
      item.authorDeviceId,
      destinationDeviceIds,
      (coordinator) => ({
        version: 1,
        changeId: this.createChangeId(),
        authorDeviceId: item.authorDeviceId,
        authorSequence: nextLocalAuthorSequence(coordinator, item.authorDeviceId),
        itemId: item.id,
        operation: 'upsert',
        text: item.text,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        ...(options.cloudCommitted ? {} : {
          directOnly: true as const,
          authorPersonId: item.authorPersonId,
        }),
      }),
      options,
    )
  }

  prepareDelete(
    roomId: string,
    localDeviceId: string,
    itemId: string,
    destinationDeviceIds: Iterable<string>,
    options: { cloudCommitted?: boolean; deleteFallbackSeed?: DirectFirstDeleteFallbackSeed } = {},
  ): Promise<LanDirectFirstPrepMeta | null> {
    return this.prepareChange(
      roomId,
      localDeviceId,
      destinationDeviceIds,
      (coordinator) => ({
        version: 1,
        changeId: this.createChangeId(),
        authorDeviceId: localDeviceId,
        authorSequence: nextLocalAuthorSequence(coordinator, localDeviceId),
        itemId,
        operation: 'delete',
        createdAt: Date.now(),
        ...(options.cloudCommitted ? {} : { directOnly: true as const }),
      }),
      {
        ...options,
        deleteFallbackSeed: options.cloudCommitted
          ? undefined
          : (coordinator) => options.deleteFallbackSeed ?? coordinator.fallbackSeedForItem(itemId),
      },
    )
  }

  replay(
    roomId: string,
    localDeviceId: string,
    request: LanDirectFirstGapRequest,
  ): Promise<DirectChangeEnvelope[] | null> {
    if (request.authorDeviceId !== localDeviceId) return Promise.resolve(null)
    return this.runExclusive(async () => {
      const coordinator = await this.coordinator(roomId, localDeviceId)
      const replay = coordinator.replay(request)
      if (!replay) return null
      const now = Date.now()
      return replay.map((change) => redactExpiredDirectFirstChange(change, now))
    })
  }

  deliverySnapshot(
    roomId: string,
    localDeviceId: string,
    changeId: string,
  ): Promise<DirectDeliveryTrackerSnapshot | null> {
    return this.runExclusive(async () => {
      const coordinator = await this.coordinator(roomId, localDeviceId)
      return coordinator.deliverySnapshot(changeId)
    })
  }

  pendingDirectOnlyForDestination(
    roomId: string,
    localDeviceId: string,
    destinationDeviceId: string,
  ): Promise<DirectChangeEnvelope[]> {
    return this.runExclusive(async () => {
      const coordinator = await this.coordinator(roomId, localDeviceId)
      const now = Date.now()
      return coordinator.pendingDirectOnlyForDestination(destinationDeviceId)
        .filter((change) => {
          const expiresAt = directFirstContentExpiresAt(change)
          return expiresAt === null || expiresAt > now
        })
    })
  }

  observeCloudDeletedItems(
    roomId: string,
    localDeviceId: string,
    itemIds: Iterable<string>,
    observedAt = Date.now(),
  ): Promise<number> {
    const ids = Array.from(new Set(itemIds))
    if (ids.length === 0) return Promise.resolve(0)

    return this.runExclusive(async () => {
      const key = this.coordinatorKey(roomId, localDeviceId)
      const coordinator = await this.coordinator(roomId, localDeviceId)
      try {
        const terminalizedUpserts = coordinator.observeCloudDeletedItems(ids, observedAt)
        await coordinator.persist()
        return terminalizedUpserts
      } catch (error) {
        // Un delete cloud que no pudo reflejarse durablemente no debe dejar una
        // vista en memoria más nueva que el último checkpoint recuperable.
        this.coordinators.delete(key)
        throw error
      }
    })
  }

  reconcileCloudTransition(
    roomId: string,
    localDeviceId: string,
    directDeviceIds: Iterable<string>,
    cloudAvailable: boolean,
    boundary: DirectFirstCloudFallbackBoundary,
    now = Date.now(),
  ) {
    return this.runExclusive(async () => {
      const key = this.coordinatorKey(roomId, localDeviceId)
      const coordinator = await this.coordinator(roomId, localDeviceId)
      try {
        return await reconcileDirectFirstShadowCloudTransition({
          coordinator,
          directDeviceIds,
          cloudAvailable,
          roomId,
          boundary,
          now,
        })
      } catch (error) {
        // Si una escritura cloud o el checkpoint de progreso falla, el siguiente
        // intento debe restaurar exclusivamente el último estado durable.
        this.coordinators.delete(key)
        throw error
      }
    })
  }

  acknowledge(
    roomId: string,
    localDeviceId: string,
    destinationDeviceId: string,
    ack: LanDirectFirstPrepAck,
  ): Promise<boolean> {
    if (ack.authorDeviceId !== localDeviceId) return Promise.resolve(false)

    return this.runExclusive(async () => {
      const key = this.coordinatorKey(roomId, localDeviceId)
      const coordinator = await this.coordinator(roomId, localDeviceId)
      try {
        const accepted = coordinator.acknowledge(ack.changeId, destinationDeviceId, ack)
        if (!accepted) return false

        // El ACK completo queda durable antes de cualquier poda. La entrega se
        // retirará al recargar el checkpoint o antes de la siguiente mutación
        // saliente; así un fallo de persistencia nunca puede fingir un ACK.
        await coordinator.persist()
        return true
      } catch (error) {
        // Si el ACK no quedó durable, restauramos desde el último checkpoint y
        // el destino seguirá pendiente hasta un ACK válido posterior.
        this.coordinators.delete(key)
        throw error
      }
    })
  }

  private prepareChange(
    roomId: string,
    localDeviceId: string,
    destinationDeviceIds: Iterable<string>,
    createChange: DirectChangeFactory,
    options: PrepareChangeOptions = {},
  ): Promise<LanDirectFirstPrepMeta | null> {
    const destinations = Array.from(new Set(destinationDeviceIds))
      .filter((deviceId) => deviceId !== localDeviceId)
    if (destinations.length === 0) return Promise.resolve(null)

    return this.runExclusive(async () => {
      const key = this.coordinatorKey(roomId, localDeviceId)
      const coordinator = await this.coordinator(roomId, localDeviceId)
      const change = createChange(coordinator)

      try {
        // Las entregas completadas ya tuvieron al menos un checkpoint durable.
        // Se eliminan justo antes de guardar una mutación nueva, no en el mismo
        // write que confirma su ACK.
        coordinator.compactCompletedDeliveries()
        if (!coordinator.rememberOutbound(change, destinations, {
          cloudCommitted: options.cloudCommitted,
          deleteFallbackSeed: options.deleteFallbackSeed?.(coordinator),
        })) {
          throw new Error('changeId direct-first ya registrado')
        }
        await coordinator.persist()
      } catch (error) {
        // Una mutación que no quedó confirmada en IndexedDB no puede reservar
        // silenciosamente una secuencia de autor en memoria.
        this.coordinators.delete(key)
        throw error
      }

      return {
        version: 1,
        changeId: change.changeId,
        authorDeviceId: change.authorDeviceId,
        authorSequence: change.authorSequence,
        createdAt: change.createdAt,
      }
    })
  }

  private coordinatorKey(roomId: string, localDeviceId: string) {
    return `${roomId}:${localDeviceId}`
  }

  private coordinator(roomId: string, localDeviceId: string) {
    const key = this.coordinatorKey(roomId, localDeviceId)
    let coordinator = this.coordinators.get(key)
    if (!coordinator) {
      coordinator = this.loadCoordinator(roomId, localDeviceId)
      this.coordinators.set(key, coordinator)
    }
    return coordinator
  }

  private runExclusive<T>(work: () => Promise<T>) {
    const result = this.mutationQueue.then(work, work)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}
