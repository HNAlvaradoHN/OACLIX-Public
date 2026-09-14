import type { ClipboardChange, ClipboardTextSnapshot } from '../data/clipboardCloudApi'
import { loadBrowserDirectFirstPrepCoordinator } from '../data/directFirstPrepCoordinator'
import { getLocalDeviceId } from '../identity/deviceIdentity'
import { listLinkedDevices } from '../identity/deviceLinking'
import {
  subscribeCloudConnectivity,
  subscribeCloudSyncHints,
} from '../realtime/cloudSyncHintBus'
import {
  subscribeLanClipboardChanges,
  subscribeLanDirectFirstBaselines,
  subscribeLanDirectFirstGapRequests,
  subscribeLanDirectFirstReplays,
  type LanClipboardContentChange,
} from '../realtime/lanClipboardBus'
import { subscribeLanDirectFirstPrepAcks } from '../realtime/lanDirectFirstPrep'
import type { LanDirectFirstGapRequest } from '../realtime/lanDirectFirstRepair'
import { LanPeerManager } from '../realtime/lanPeerManager'
import { subscribeDirectLanStatus } from '../realtime/lanStatus'
import { selectAllDirectDestinations } from './directFirstActivation.ts'
import { decideDirectFirstCloudExpiry } from './directFirstCloudExpiryPolicy.ts'
import { cloudClipboardBoundary } from './cloudClipboardProductBoundary'
import {
  DirectFirstShadowInbound,
  type DirectFirstShadowBaselineResult,
  type DirectFirstShadowInboundResult,
} from './directFirstShadowInbound'
import { DirectFirstShadowOutbound } from './directFirstShadowOutbound'
import type { DirectChangeEnvelope } from './directFirstProtocol'

export type { ClipboardChange, ClipboardTextSnapshot }
export type DirectClipboardChange = LanClipboardContentChange

export type ClipboardCreateResult = Awaited<ReturnType<typeof cloudClipboardBoundary.createText>> & {
  delivery: 'cloud' | 'direct'
}

export type ClipboardDeleteResult = Awaited<ReturnType<typeof cloudClipboardBoundary.deleteText>> & {
  delivery: 'cloud' | 'direct'
}

export type ClipboardDeleteFallbackSeed = {
  text: string
  createdAt: number
  expiresAt: number
}

export type ClipboardDeleteOptions = {
  /** Solo un item que todavía no tiene copia cloud puede intentar delete direct-only. */
  directOnly?: true
  /** Metadata original necesaria si una transición posterior necesita seed+tombstone cloud. */
  fallbackSeed?: ClipboardDeleteFallbackSeed
}

export type ClipboardTransport = {
  kind: 'cloud' | 'hybrid'
  createText(roomId: string, text: string): Promise<ClipboardCreateResult>
  deleteText(roomId: string, itemId: string, options?: ClipboardDeleteOptions): Promise<ClipboardDeleteResult>
  listChanges(roomId: string, after: number): ReturnType<typeof cloudClipboardBoundary.listChanges>
  subscribeDirectChanges(roomId: string, listener: (change: DirectClipboardChange) => void): () => void
  subscribeCloudSyncHints(roomId: string, listener: () => void): () => void
}

export const cloudClipboardTransport: ClipboardTransport = {
  kind: 'cloud',
  async createText(roomId, text) {
    return { ...(await cloudClipboardBoundary.createText(roomId, text)), delivery: 'cloud' }
  },
  async deleteText(roomId, itemId) {
    return { ...(await cloudClipboardBoundary.deleteText(roomId, itemId)), delivery: 'cloud' }
  },
  listChanges: cloudClipboardBoundary.listChanges,
  subscribeDirectChanges: () => () => undefined,
  subscribeCloudSyncHints: () => () => undefined,
}

const DIRECT_TEXT_RETENTION_MS = 21_600_000
const lanManagers = new Map<string, LanPeerManager>()
const suspendedConnectivityRooms = new Set<string>()
const controlOnlyConnectivityRooms = new Set<string>()
const cloudAvailabilityByRoom = new Map<string, boolean>()
const cloudReconcileByRoom = new Map<string, () => void>()
const directProductListenersByRoom = new Map<string, Set<(change: DirectClipboardChange) => void>>()
const directFirstShadowOutbound = new DirectFirstShadowOutbound(loadBrowserDirectFirstPrepCoordinator)
const directFirstShadowInbound = new DirectFirstShadowInbound(loadBrowserDirectFirstPrepCoordinator)
let localDeviceIdPromise: Promise<string> | null = null

type LinkedRoster = {
  personId: string
  localDeviceId: string
  deviceIds: string[]
}

const linkedRosterByLocalDevice = new Map<string, LinkedRoster>()

function transportLocalDeviceId() {
  if (!localDeviceIdPromise) {
    localDeviceIdPromise = getLocalDeviceId().catch((error) => {
      localDeviceIdPromise = null
      throw error
    })
  }
  return localDeviceIdPromise
}

function assertClipboardRoomConnectivityActive(roomId: string) {
  if (suspendedConnectivityRooms.has(roomId) || controlOnlyConnectivityRooms.has(roomId)) {
    throw new Error('General no está activo para contenido')
  }
}

function createDirectItemId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `itm_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

async function refreshLinkedRoster(localDeviceId: string) {
  const result = await listLinkedDevices()
  if (!result.personId?.startsWith('per_')) throw new Error('Roster vinculado inválido')
  const deviceIds = result.devices.map((device) => device.id)
  if (!deviceIds.includes(localDeviceId)) throw new Error('El dispositivo local no pertenece al roster')

  const roster: LinkedRoster = {
    personId: result.personId,
    localDeviceId,
    deviceIds,
  }
  linkedRosterByLocalDevice.set(localDeviceId, roster)
  return roster
}

async function resolveAllDirectCoverage(roomId: string, manager: LanPeerManager, localDeviceId: string) {
  const validatedPeerIds = manager.getValidatedPeerIds()
  if (validatedPeerIds.length === 0) return null

  let roster: LinkedRoster | undefined
  if (cloudAvailabilityByRoom.get(roomId) === true) {
    try {
      roster = await refreshLinkedRoster(localDeviceId)
    } catch {
      // Con cloud disponible no usamos un roster viejo: fallamos de forma conservadora a cloud-first.
      return null
    }
  } else {
    // Tras perder Internet, una sesión que ya conocía su roster puede seguir usando el DL validado.
    roster = linkedRosterByLocalDevice.get(localDeviceId)
  }
  if (!roster || roster.localDeviceId !== localDeviceId) return null

  const destinationDeviceIds = selectAllDirectDestinations(
    localDeviceId,
    roster.deviceIds,
    validatedPeerIds,
  )
  if (!destinationDeviceIds) return null
  return { personId: roster.personId, destinationDeviceIds }
}

function publishDirectProductChange(roomId: string, change: DirectClipboardChange) {
  for (const listener of directProductListenersByRoom.get(roomId) ?? []) listener(change)
}

function directProductChangeFromEnvelope(envelope: DirectChangeEnvelope): DirectClipboardChange | null {
  if (!envelope.directOnly) return null
  if (envelope.operation === 'delete') {
    return {
      sequence: envelope.authorSequence,
      type: 'delete',
      itemId: envelope.itemId,
      directOnly: true,
    }
  }
  if (!envelope.authorPersonId || envelope.expiresAt === undefined || typeof envelope.text !== 'string') return null
  return {
    sequence: envelope.authorSequence,
    type: 'upsert',
    directOnly: true,
    item: {
      sequence: envelope.authorSequence,
      id: envelope.itemId,
      authorPersonId: envelope.authorPersonId,
      authorDeviceId: envelope.authorDeviceId,
      text: envelope.text,
      createdAt: envelope.createdAt,
      expiresAt: envelope.expiresAt,
      directOnly: true,
    },
  }
}

function publishCommittedDirectOnly(
  roomId: string,
  result: DirectFirstShadowInboundResult | DirectFirstShadowBaselineResult | null,
) {
  if (!result) return
  // committed mantiene continuidad/ACK del protocolo; productCommitted excluye
  // upserts atrasados de itemIds que un tombstone ya declaró eliminados.
  for (const envelope of result.productCommitted) {
    const change = directProductChangeFromEnvelope(envelope)
    if (change) publishDirectProductChange(roomId, change)
  }
}

function sendShadowRepairRequest(
  manager: LanPeerManager,
  remoteDeviceId: string,
  request: LanDirectFirstGapRequest,
) {
  manager.broadcastClipboardChange({
    type: 'direct-first-gap-request',
    targetDeviceId: remoteDeviceId,
    request,
  })
}

function sendDirectReplay(
  manager: LanPeerManager,
  remoteDeviceId: string,
  change: DirectChangeEnvelope,
  throughSequence = change.authorSequence,
) {
  manager.broadcastClipboardChange({
    type: 'direct-first-replay',
    targetDeviceId: remoteDeviceId,
    replay: {
      version: 1,
      type: 'replay-change',
      throughSequence,
      change,
    },
  })
}

function sendDirectBaseline(
  manager: LanPeerManager,
  remoteDeviceId: string,
  authorDeviceId: string,
  throughSequence: number,
) {
  manager.broadcastClipboardChange({
    type: 'direct-first-baseline',
    targetDeviceId: remoteDeviceId,
    baseline: {
      version: 1,
      type: 'baseline',
      authorDeviceId,
      throughSequence,
    },
  })
}

function finishShadowReceive(
  manager: LanPeerManager,
  remoteDeviceId: string,
  result: DirectFirstShadowInboundResult | DirectFirstShadowBaselineResult | null,
) {
  if (!result) return
  for (const ack of result.acks) manager.sendDirectFirstPrepAck(remoteDeviceId, ack)
  if (result.repairRequest) sendShadowRepairRequest(manager, remoteDeviceId, result.repairRequest)
}

async function deleteDirectOnlyThroughCloud(
  roomId: string,
  itemId: string,
  seed: ClipboardDeleteFallbackSeed,
) {
  try {
    return { status: 'deleted' as const, result: await cloudClipboardBoundary.deleteText(roomId, itemId) }
  } catch {
    const expiry = decideDirectFirstCloudExpiry(seed.createdAt, seed.expiresAt, Date.now())
    if (expiry.status === 'invalid') throw new Error('No se puede demostrar la expiración original del texto')
    if (expiry.status === 'expired') return { status: 'expired' as const }

    try {
      await cloudClipboardBoundary.createTextWithOriginalExpiry(
        roomId,
        itemId,
        seed.text,
        expiry.expiresAt,
      )
    } catch {
      // Una carrera puede haber creado/borrado ya el mismo itemId. El delete
      // idempotente decide si existe una transición cloud recuperable.
      try {
        return { status: 'deleted' as const, result: await cloudClipboardBoundary.deleteText(roomId, itemId) }
      } catch (retryError) {
        if (Date.now() >= seed.expiresAt) return { status: 'expired' as const }
        throw retryError
      }
    }

    return { status: 'deleted' as const, result: await cloudClipboardBoundary.deleteText(roomId, itemId) }
  }
}

function ensureLan(roomId: string) {
  let manager = lanManagers.get(roomId)
  if (!manager) {
    manager = new LanPeerManager(roomId)
    lanManagers.set(roomId, manager)
    const roomManager = manager
    const knownValidatedPeerIds = new Set<string>()
    let cloudAvailable = false

    const contentTransportSuppressed = () => (
      suspendedConnectivityRooms.has(roomId) || controlOnlyConnectivityRooms.has(roomId)
    )

    const reconcileCloudTransition = () => {
      if (contentTransportSuppressed()) return
      const directDeviceIds = roomManager.getValidatedPeerIds()
      void transportLocalDeviceId()
        .then((localDeviceId) => directFirstShadowOutbound.reconcileCloudTransition(
          roomId,
          localDeviceId,
          directDeviceIds,
          cloudAvailable,
          cloudClipboardBoundary,
        ))
        .then((result) => {
          if (result.cloudWrites > 0) roomManager.notifyCloudFallbackChange()
        })
        .catch(() => undefined)
    }
    cloudReconcileByRoom.set(roomId, reconcileCloudTransition)

    subscribeLanClipboardChanges(roomId, (change, remoteDeviceId) => {
      if (contentTransportSuppressed()) return
      if (!remoteDeviceId || !change.directFirstPrep) {
        publishDirectProductChange(roomId, change)
        return
      }

      const receive = () => transportLocalDeviceId()
        .then((localDeviceId) => change.type === 'upsert'
          ? directFirstShadowInbound.receiveUpsert(roomId, localDeviceId, change, remoteDeviceId)
          : directFirstShadowInbound.receiveDelete(roomId, localDeviceId, remoteDeviceId, change))

      if (!change.directOnly) {
        // Cloud-sequenced: la UI conserva el comportamiento inmediato previo;
        // shadow no puede romper el producto aunque falle su checkpoint.
        void receive()
          .then((result) => finishShadowReceive(roomManager, remoteDeviceId, result))
          .catch(() => undefined)
        publishDirectProductChange(roomId, change)
        return
      }

      // Direct-only: nunca aplicar a producto antes de persistir y cerrar gaps.
      void receive()
        .then((result) => {
          finishShadowReceive(roomManager, remoteDeviceId, result)
          publishCommittedDirectOnly(roomId, result)
        })
        .catch(() => undefined)
    })

    subscribeLanDirectFirstPrepAcks(roomId, (remoteDeviceId, ack) => {
      if (contentTransportSuppressed()) return
      void transportLocalDeviceId()
        .then((localDeviceId) => directFirstShadowOutbound.acknowledge(
          roomId,
          localDeviceId,
          remoteDeviceId,
          ack,
        ))
        .catch(() => undefined)
    })

    subscribeLanDirectFirstGapRequests(roomId, (message, remoteDeviceId) => {
      if (contentTransportSuppressed() || !remoteDeviceId) return
      void transportLocalDeviceId()
        .then(async (localDeviceId) => {
          if (message.targetDeviceId !== localDeviceId) return
          if (message.request.authorDeviceId !== localDeviceId) return
          if (message.request.afterSequence === 0) {
            // El receptor no tiene historial durable de este autor. No se le
            // retroenvía contenido direct-only anterior a su vínculo/estado local;
            // se establece solo la frontera necesaria para recibir lo futuro.
            sendDirectBaseline(
              roomManager,
              remoteDeviceId,
              localDeviceId,
              message.request.throughSequence,
            )
            return
          }

          const replay = await directFirstShadowOutbound.replay(roomId, localDeviceId, message.request)
          if (!replay) {
            // Un replay que salió de la ventana persistente no se inventa.
            reconcileCloudTransition()
            return
          }

          for (const change of replay) {
            sendDirectReplay(roomManager, remoteDeviceId, change, message.request.throughSequence)
          }
        })
        .catch(() => undefined)
    })

    subscribeLanDirectFirstReplays(roomId, (message, remoteDeviceId) => {
      if (contentTransportSuppressed() || !remoteDeviceId) return
      void transportLocalDeviceId()
        .then((localDeviceId) => {
          if (message.targetDeviceId !== localDeviceId) return null
          return directFirstShadowInbound.receiveReplay(
            roomId,
            localDeviceId,
            remoteDeviceId,
            message.replay,
          )
        })
        .then((result) => {
          finishShadowReceive(roomManager, remoteDeviceId, result)
          publishCommittedDirectOnly(roomId, result)
        })
        .catch(() => undefined)
    })

    subscribeLanDirectFirstBaselines(roomId, (message, remoteDeviceId) => {
      if (contentTransportSuppressed() || !remoteDeviceId) return
      void transportLocalDeviceId()
        .then((localDeviceId) => {
          if (message.targetDeviceId !== localDeviceId) return null
          return directFirstShadowInbound.receiveBaseline(
            roomId,
            localDeviceId,
            remoteDeviceId,
            message.baseline,
          )
        })
        .then((result) => {
          finishShadowReceive(roomManager, remoteDeviceId, result)
          publishCommittedDirectOnly(roomId, result)
        })
        .catch(() => undefined)
    })

    subscribeCloudConnectivity(roomId, (status) => {
      if (suspendedConnectivityRooms.has(roomId)) {
        cloudAvailable = false
        cloudAvailabilityByRoom.set(roomId, false)
        return
      }

      const nextAvailable = status === 'online'
      const becameOnline = nextAvailable && !cloudAvailable
      cloudAvailable = nextAvailable
      cloudAvailabilityByRoom.set(roomId, nextAvailable)
      if (becameOnline && !controlOnlyConnectivityRooms.has(roomId)) {
        void transportLocalDeviceId()
          .then((localDeviceId) => refreshLinkedRoster(localDeviceId))
          .catch(() => undefined)
        reconcileCloudTransition()
      }
    })

    subscribeDirectLanStatus(() => {
      const currentPeerIds = new Set(roomManager.getValidatedPeerIds())
      const currentKey = Array.from(currentPeerIds).sort().join('|')
      const previousKey = Array.from(knownValidatedPeerIds).sort().join('|')
      if (currentKey === previousKey) return

      if (contentTransportSuppressed()) {
        knownValidatedPeerIds.clear()
        return
      }

      const newlyValidatedPeerIds = Array.from(currentPeerIds)
        .filter((remoteDeviceId) => !knownValidatedPeerIds.has(remoteDeviceId))

      knownValidatedPeerIds.clear()
      for (const remoteDeviceId of currentPeerIds) knownValidatedPeerIds.add(remoteDeviceId)

      for (const remoteDeviceId of newlyValidatedPeerIds) {
        void transportLocalDeviceId()
          .then(async (localDeviceId) => {
            const request = await directFirstShadowInbound.pendingRepairRequest(
              roomId,
              localDeviceId,
              remoteDeviceId,
            )
            if (request) sendShadowRepairRequest(roomManager, remoteDeviceId, request)

            const pending = await directFirstShadowOutbound.pendingDirectOnlyForDestination(
              roomId,
              localDeviceId,
              remoteDeviceId,
            )
            for (const change of pending) sendDirectReplay(roomManager, remoteDeviceId, change)
          })
          .catch(() => undefined)
      }

      reconcileCloudTransition()
    })

    if (!suspendedConnectivityRooms.has(roomId)) roomManager.start()
  } else if (!suspendedConnectivityRooms.has(roomId)) {
    manager.start()
    manager.poke()
  }
  return manager
}

export function ensureClipboardRoomConnectivity(roomId: string) {
  suspendedConnectivityRooms.delete(roomId)
  controlOnlyConnectivityRooms.delete(roomId)
  const manager = ensureLan(roomId)
  manager.start()
  manager.poke()
  if (cloudAvailabilityByRoom.get(roomId) === true) {
    void transportLocalDeviceId()
      .then((localDeviceId) => refreshLinkedRoster(localDeviceId))
      .catch(() => undefined)
    cloudReconcileByRoom.get(roomId)?.()
  }
}

export function ensureClipboardRoomControlConnectivity(roomId: string) {
  suspendedConnectivityRooms.delete(roomId)
  controlOnlyConnectivityRooms.add(roomId)
  const manager = ensureLan(roomId)
  manager.start()
  manager.poke()
}

export function suspendClipboardRoomConnectivity(roomId: string) {
  suspendedConnectivityRooms.add(roomId)
  controlOnlyConnectivityRooms.delete(roomId)
  cloudAvailabilityByRoom.set(roomId, false)
  lanManagers.get(roomId)?.stop()
}

export const clipboardTransport: ClipboardTransport = {
  kind: 'hybrid',
  async createText(roomId, text) {
    const manager = ensureLan(roomId)
    assertClipboardRoomConnectivityActive(roomId)
    const localDeviceId = await transportLocalDeviceId()
    const coverage = await resolveAllDirectCoverage(roomId, manager, localDeviceId)

    if (coverage) {
      const now = Date.now()
      const draft: ClipboardTextSnapshot = {
        sequence: 1,
        id: createDirectItemId(),
        authorPersonId: coverage.personId,
        authorDeviceId: localDeviceId,
        text,
        createdAt: now,
        expiresAt: now + DIRECT_TEXT_RETENTION_MS,
        directOnly: true,
      }
      const directFirstPrep = await directFirstShadowOutbound.prepareUpsert(
        roomId,
        draft,
        coverage.destinationDeviceIds,
      )
      if (directFirstPrep) {
        const item: ClipboardTextSnapshot = {
          ...draft,
          sequence: directFirstPrep.authorSequence,
        }
        const delivered = manager.broadcastClipboardChange({
          sequence: directFirstPrep.authorSequence,
          type: 'upsert',
          item,
          directOnly: true,
          directFirstPrep,
        })
        if (delivered !== coverage.destinationDeviceIds.length) {
          // El checkpoint ya existe: no inventamos otro item. La pérdida de peer
          // disparará reconciliación cloud; sin una entrega completa no fingimos éxito.
          throw new Error('La ruta directa cambió durante el envío')
        }
        return {
          version: 1,
          item,
          created: true,
          changeSequence: 0,
          delivery: 'direct',
        }
      }
    }

    const cloudFallbackNeeded = manager.hasCloudFallbackPeers()
    const result = await cloudClipboardBoundary.createText(roomId, text)
    const directFirstPrep = await directFirstShadowOutbound
      .prepareUpsert(
        roomId,
        result.item,
        manager.getValidatedPeerIds(),
        { cloudCommitted: true },
      )
      .catch(() => null)

    manager.broadcastClipboardChange({
      sequence: result.changeSequence,
      type: 'upsert',
      item: result.item,
      ...(directFirstPrep ? { directFirstPrep } : {}),
    })
    if (cloudFallbackNeeded || manager.hasCloudFallbackPeers()) manager.notifyCloudFallbackChange()
    return { ...result, delivery: 'cloud' }
  },

  async deleteText(roomId, itemId, options = {}) {
    const manager = ensureLan(roomId)
    assertClipboardRoomConnectivityActive(roomId)
    const localDeviceId = await transportLocalDeviceId()

    if (options.directOnly && options.fallbackSeed) {
      const coverage = await resolveAllDirectCoverage(roomId, manager, localDeviceId)
      if (coverage) {
        const directFirstPrep = await directFirstShadowOutbound.prepareDelete(
          roomId,
          localDeviceId,
          itemId,
          coverage.destinationDeviceIds,
          { deleteFallbackSeed: options.fallbackSeed },
        )
        if (directFirstPrep) {
          const delivered = manager.broadcastClipboardChange({
            sequence: directFirstPrep.authorSequence,
            type: 'delete',
            itemId,
            directOnly: true,
            directFirstPrep,
          })
          if (delivered !== coverage.destinationDeviceIds.length) {
            throw new Error('La ruta directa cambió durante el borrado')
          }
          return {
            version: 1,
            itemId,
            deleted: true,
            deletedAt: directFirstPrep.createdAt,
            changeSequence: 0,
            delivery: 'direct',
          }
        }
      }
    }

    const cloudFallbackNeeded = manager.hasCloudFallbackPeers()
    if (options.directOnly && options.fallbackSeed) {
      const fallback = await deleteDirectOnlyThroughCloud(roomId, itemId, options.fallbackSeed)
      if (fallback.status === 'expired') {
        const deletedAt = Date.now()
        await directFirstShadowOutbound.observeCloudDeletedItems(
          roomId,
          localDeviceId,
          [itemId],
          deletedAt,
        )
        return {
          version: 1,
          itemId,
          deleted: true,
          deletedAt,
          changeSequence: 0,
          delivery: 'cloud',
        }
      }

      const result = fallback.result
      await directFirstShadowOutbound.observeCloudDeletedItems(
        roomId,
        localDeviceId,
        [result.itemId],
      )
      const destinations = manager.getValidatedPeerIds()
      const directFirstPrep = destinations.length === 0
        ? null
        : await directFirstShadowOutbound
          .prepareDelete(
            roomId,
            localDeviceId,
            result.itemId,
            destinations,
            { cloudCommitted: true },
          )
          .catch(() => null)

      manager.broadcastClipboardChange({
        sequence: result.changeSequence,
        type: 'delete',
        itemId: result.itemId,
        ...(directFirstPrep ? { directFirstPrep } : {}),
      })
      if (cloudFallbackNeeded || manager.hasCloudFallbackPeers()) manager.notifyCloudFallbackChange()
      return { ...result, delivery: 'cloud' }
    }

    const result = await cloudClipboardBoundary.deleteText(roomId, itemId)
    const destinations = manager.getValidatedPeerIds()
    const directFirstPrep = destinations.length === 0
      ? null
      : await directFirstShadowOutbound
        .prepareDelete(
          roomId,
          localDeviceId,
          result.itemId,
          destinations,
          { cloudCommitted: true },
        )
        .catch(() => null)

    manager.broadcastClipboardChange({
      sequence: result.changeSequence,
      type: 'delete',
      itemId: result.itemId,
      ...(directFirstPrep ? { directFirstPrep } : {}),
    })
    if (cloudFallbackNeeded || manager.hasCloudFallbackPeers()) manager.notifyCloudFallbackChange()
    return { ...result, delivery: 'cloud' }
  },

  async listChanges(roomId, after) {
    ensureLan(roomId)
    assertClipboardRoomConnectivityActive(roomId)
    const result = await cloudClipboardBoundary.listChanges(roomId, after)
    const deletedItemIds = result.changes
      .filter((change) => change.type === 'delete')
      .map((change) => change.itemId)
    if (deletedItemIds.length > 0) {
      const localDeviceId = await transportLocalDeviceId()
      await directFirstShadowOutbound.observeCloudDeletedItems(
        roomId,
        localDeviceId,
        deletedItemIds,
      )
    }
    return result
  },

  subscribeDirectChanges(roomId, listener) {
    ensureLan(roomId)
    let listeners = directProductListenersByRoom.get(roomId)
    if (!listeners) {
      listeners = new Set()
      directProductListenersByRoom.set(roomId, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) directProductListenersByRoom.delete(roomId)
    }
  },

  subscribeCloudSyncHints(roomId, listener) {
    ensureLan(roomId)
    return subscribeCloudSyncHints(roomId, listener)
  },
}
