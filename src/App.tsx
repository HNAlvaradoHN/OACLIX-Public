import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCard } from './components/ClipboardCard'
import { ClipboardComposer } from './components/ClipboardComposer'
import { ConnectionsStoragePanel } from './components/ConnectionsStoragePanel'
import { GeneralCard } from './components/GeneralCard'
import { GeneralDestinationPanel } from './components/GeneralDestinationPanel'
import { Icon } from './components/Icon'
import { LinkedPanel } from './components/LinkedPanel'
import { LocalClipboardSharePanel } from './components/LocalClipboardSharePanel'
import { LocalImageSharePanel } from './components/LocalImageSharePanel'
import { ManualRefreshButton } from './components/ManualRefreshButton'
import { PreservedPanel } from './components/PreservedPanel'
import { RoomCard } from './components/RoomCard'
import { SettingsMenu } from './components/SettingsMenu'
import { ThemePicker } from './components/ThemePicker'
import { UpdatePrompt } from './components/UpdatePrompt'
import { deleteClipboardText, ensureClipboardRoomConnectivity, ensureClipboardRoomControlConnectivity, ensureClipboardRoomForegroundReception, listClipboardChanges, subscribeCloudClipboardSyncHints, subscribeDirectClipboardChanges, suspendClipboardRoomConnectivity, suspendClipboardRoomForegroundReception, type ClipboardChange, type ClipboardTextSnapshot } from './data/clipboardApi'
import { readGeneralClipboardCache, writeGeneralClipboardCache } from './data/clipboardCache'
import { selectRecentGeneralTexts } from './data/generalClipboardView'
import { deleteGeneralTargetedInboxItem, readGeneralTargetedInbox, type GeneralTargetedInboxItem } from './data/generalTargetedInbox'
import { createLocalClipboardText, deleteLocalClipboardText, normalizeLocalClipboardTexts, readLocalClipboardTexts, type LocalClipboardTextSnapshot } from './data/localClipboard'
import { readLocalImages, type LocalImageClipboardSnapshot } from './data/localImageClipboard'
import { createLocalTextTransferChunkSource } from './data/transferSourceProviders'
import { clipboardItems as initialItems, rooms } from './data/mockData'
import { preserveTextOnThisDevice, readLocalPreservedTexts, releaseTextFromThisDevice } from './data/preservedClipboard'
import { readDefaultRoomId, saveDefaultRoomId } from './data/roomPreference'
import { bootstrapDeviceIdentity, type DeviceIdentitySnapshot, type DeviceIdentityStatus } from './identity/deviceIdentity'
import { serviceWorkerUpdateEvent } from './pwa/registerServiceWorker'
import { subscribeCloudConnectivity, type CloudConnectivityStatus } from './realtime/cloudSyncHintBus'
import { applyTheme, getThemePreference, saveThemePreference, type ThemePreference } from './theme/theme'
import { classifyDirectSequence } from './transport/directCursorPolicy'
import { subscribeGeneralTargetedReceipts } from './transport/generalTargetedReceiptBus'
import { sendGeneralTargetedText } from './transport/generalTargetedTextTransport'
import { subscribeLocalClipboardDirectReceipts } from './transport/localClipboardDirectTransport'
import { sendLocalImageDirect, subscribeLocalImageDirectReceipts } from './transport/localImageDirectTransport'
import { keepCursorMonotonic, selectChangesAfterCursor } from './transport/syncCursorPolicy'
import { createLocalTransferProductBoundary } from './transfer/localTransferProductBoundary'
import type { ClipboardItem, PreserveTarget, Room } from './types'

type GeneralSyncStatus = 'idle' | 'syncing' | 'ready' | 'error'
type StableCloudConnectivityStatus = Exclude<CloudConnectivityStatus, 'checking'>
type ConnectedSurfaceMode = 'content' | 'control' | null

function normalizeGeneralItems(items: ClipboardTextSnapshot[]) {
  const now = Date.now()
  const unique = new Map<string, ClipboardTextSnapshot>()
  for (const item of items) {
    if (item.expiresAt > now) unique.set(item.id, item)
  }
  return Array.from(unique.values()).sort((a, b) => b.createdAt - a.createdAt || b.sequence - a.sequence)
}

function App() {
  const [activeRoom, setActiveRoom] = useState<Room | null>(null)
  const [defaultRoomId, setDefaultRoomId] = useState(() => readDefaultRoomId(rooms.map((room) => room.id)))
  const [mockItems, setMockItems] = useState<ClipboardItem[]>(initialItems)
  const [localItems, setLocalItems] = useState<LocalClipboardTextSnapshot[]>([])
  const [localClipboardReady, setLocalClipboardReady] = useState(false)
  const [localShareItemId, setLocalShareItemId] = useState<string | null>(null)
  const [localImageShareItemId, setLocalImageShareItemId] = useState<string | null>(null)
  const [localImageShareItem, setLocalImageShareItem] = useState<LocalImageClipboardSnapshot | null>(null)
  const [generalItems, setGeneralItems] = useState<ClipboardTextSnapshot[]>([])
  const [generalTargetedItems, setGeneralTargetedItems] = useState<GeneralTargetedInboxItem[]>([])
  const [generalDestinationOpen, setGeneralDestinationOpen] = useState(false)
  const [pendingGeneralText, setPendingGeneralText] = useState<string | null>(null)
  const [generalComposerResetKey, setGeneralComposerResetKey] = useState(0)
  const [localPreservedItems, setLocalPreservedItems] = useState<ClipboardTextSnapshot[]>([])
  const [generalSyncStatus, setGeneralSyncStatus] = useState<GeneralSyncStatus>('idle')
  const [cloudConnectivity, setCloudConnectivity] = useState<CloudConnectivityStatus>('checking')
  const [visibleCloudConnectivity, setVisibleCloudConnectivity] = useState<StableCloudConnectivityStatus>('offline')
  const [generalCacheReady, setGeneralCacheReady] = useState(false)
  const [linkedOpen, setLinkedOpen] = useState(false)
  const [preservedOpen, setPreservedOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => getThemePreference())
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [identity, setIdentity] = useState<DeviceIdentitySnapshot | null>(null)
  const [identityStatus, setIdentityStatus] = useState<DeviceIdentityStatus>('loading')
  const generalCursorRef = useRef(0)
  const generalItemsRef = useRef<ClipboardTextSnapshot[]>([])
  const generalSyncingRef = useRef(false)
  const identityRequestRef = useRef<Promise<DeviceIdentitySnapshot> | null>(null)
  const localTransferBoundaryRef = useRef<{
    roomId: string
    boundary: ReturnType<typeof createLocalTransferProductBoundary>
  } | null>(null)

  const favorite = useMemo(
    () => rooms.find((room) => room.id === defaultRoomId) ?? rooms[0],
    [defaultRoomId],
  )
  const otherRooms = useMemo(() => rooms.filter((room) => room.id !== favorite.id), [favorite.id])
  const isLocalView = activeRoom?.kind === 'local'
  const isGeneralView = activeRoom?.kind === 'general'
  const isFavoriteView = activeRoom?.id === defaultRoomId
  const localShareItem = useMemo(
    () => localItems.find((item) => item.id === localShareItemId) ?? null,
    [localItems, localShareItemId],
  )
  const connectedSurfaceMode: ConnectedSurfaceMode = isGeneralView
    ? 'content'
    : linkedOpen || Boolean(localShareItemId) || Boolean(localImageShareItemId) ? 'control' : null
  const canUseRealGeneral = Boolean(
    isGeneralView
    && identityStatus === 'ready'
    && identity?.persisted
    && identity.generalRoomId,
  )
  const canSyncRealGeneral = canUseRealGeneral && generalCacheReady

  const flash = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 1800)
  }, [])

  const ensureIdentity = useCallback(async () => {
    if (identityStatus === 'ready' && identity) return identity
    if (identityRequestRef.current) return identityRequestRef.current

    setIdentityStatus('loading')
    const request = bootstrapDeviceIdentity()
    identityRequestRef.current = request
    try {
      const verifiedIdentity = await request
      setIdentity(verifiedIdentity)
      setIdentityStatus('ready')
      if (verifiedIdentity.createdLocally) flash('Identidad segura creada en este dispositivo')
      return verifiedIdentity
    } catch (error) {
      setIdentityStatus('error')
      throw error
    } finally {
      identityRequestRef.current = null
    }
  }, [flash, identity, identityStatus])

  const refreshIdentity = useCallback(async () => {
    identityRequestRef.current = null
    setIdentityStatus('loading')
    try {
      const verifiedIdentity = await bootstrapDeviceIdentity()
      setIdentity(verifiedIdentity)
      setIdentityStatus('ready')
    } catch (error) {
      setIdentityStatus('error')
      throw error
    }
  }, [])

  const openRoom = useCallback((room: Room) => {
    setPreservedOpen(false)
    setLocalShareItemId(null)
    setLocalImageShareItemId(null)
    setActiveRoom(room)
    if (room.kind === 'general') void ensureIdentity().catch(() => undefined)
  }, [ensureIdentity])

  const openLinked = useCallback(() => {
    setMenuOpen(false)
    setLocalShareItemId(null)
    setLocalImageShareItemId(null)
    setLinkedOpen(true)
    void ensureIdentity().catch(() => undefined)
  }, [ensureIdentity])

  const openLocalShare = useCallback((item: ClipboardItem) => {
    if (item.type !== 'text') return
    setLinkedOpen(false)
    setMenuOpen(false)
    setLocalImageShareItemId(null)
    setLocalShareItemId(item.id)
    void ensureIdentity().catch(() => undefined)
  }, [ensureIdentity])

  const openLocalImageShare = useCallback((item: ClipboardItem) => {
    if (item.type !== 'image') return
    setLinkedOpen(false)
    setMenuOpen(false)
    setLocalShareItemId(null)
    setLocalImageShareItemId(item.id)
    void ensureIdentity().catch(() => undefined)
  }, [ensureIdentity])

  const makeDefault = useCallback((room: Room) => {
    if (room.id === defaultRoomId) {
      flash(`${room.name} ya es la predeterminada`)
      return
    }
    saveDefaultRoomId(room.id)
    setDefaultRoomId(room.id)
    flash(`${room.name} será la predeterminada`)
  }, [defaultRoomId, flash])

  const commitGeneralItems = useCallback((items: ClipboardTextSnapshot[]) => {
    const normalized = normalizeGeneralItems(items)
    generalItemsRef.current = normalized
    setGeneralItems(normalized)
    return normalized
  }, [])

  const persistGeneralCache = useCallback((roomId: string, items = generalItemsRef.current) => {
    void writeGeneralClipboardCache(roomId, generalCursorRef.current, items).catch(() => undefined)
  }, [])

  const mergeGeneralItems = useCallback((incoming: ClipboardTextSnapshot[]) => {
    const merged = new Map(generalItemsRef.current.map((item) => [item.id, item]))
    for (const item of incoming) merged.set(item.id, item)
    return commitGeneralItems(Array.from(merged.values()))
  }, [commitGeneralItems])

  const removeGeneralItem = useCallback((itemId: string) => {
    return commitGeneralItems(generalItemsRef.current.filter((item) => item.id !== itemId))
  }, [commitGeneralItems])

  const applyGeneralChanges = useCallback((changes: ClipboardChange[]) => {
    const merged = new Map(generalItemsRef.current.map((item) => [item.id, item]))
    for (const change of changes) {
      if (change.type === 'delete') merged.delete(change.itemId)
      else merged.set(change.item.id, change.item)
    }
    return commitGeneralItems(Array.from(merged.values()))
  }, [commitGeneralItems])

  const syncGeneral = useCallback(async () => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted || !generalCacheReady || generalSyncingRef.current) return false

    generalSyncingRef.current = true
    setGeneralSyncStatus('syncing')
    try {
      let cursor = generalCursorRef.current
      let hasMore = true

      while (hasMore) {
        const result = await listClipboardChanges(roomId, cursor)
        applyGeneralChanges(selectChangesAfterCursor(result.changes, generalCursorRef.current))
        if (result.hasMore && result.nextCursor <= cursor) throw new Error('El cursor de sincronización no avanzó')
        cursor = keepCursorMonotonic(generalCursorRef.current, result.nextCursor)
        hasMore = result.hasMore
      }

      generalCursorRef.current = keepCursorMonotonic(generalCursorRef.current, cursor)
      const currentItems = commitGeneralItems(generalItemsRef.current)
      await writeGeneralClipboardCache(roomId, generalCursorRef.current, currentItems).catch(() => undefined)
      setCloudConnectivity('online')
      setGeneralSyncStatus('ready')
      return true
    } catch {
      setGeneralSyncStatus('error')
      return false
    } finally {
      generalSyncingRef.current = false
    }
  }, [applyGeneralChanges, commitGeneralItems, generalCacheReady, identity?.generalRoomId, identity?.persisted])

  const saveLocalText = useCallback(async (text: string) => {
    if (!localClipboardReady) throw new Error('Mi portapapeles todavía se está preparando')
    const item = await createLocalClipboardText(text)
    setLocalItems((current) => normalizeLocalClipboardTexts([...current, item]))
    flash('Guardado solo en este dispositivo')
  }, [flash, localClipboardReady])

  const deleteLocalText = useCallback(async (itemId: string) => {
    await deleteLocalClipboardText(itemId)
    setLocalItems((current) => current.filter((item) => item.id !== itemId))
    flash('Eliminado de este dispositivo')
  }, [flash])

  const sendLocalTextDirect = useCallback(async (deviceId: string) => {
    const roomId = identity?.generalRoomId
    const senderDeviceId = identity?.deviceId
    if (!roomId || !senderDeviceId || !identity.persisted) {
      throw new Error('La identidad vinculada todavía no está disponible')
    }
    const item = localItems.find((entry) => entry.id === localShareItemId)
    if (!item) throw new Error('Este texto ya no está disponible')
    const currentBoundary = localTransferBoundaryRef.current
    if (!currentBoundary || currentBoundary.roomId !== roomId) {
      throw new Error('La transferencia local todavía se está preparando')
    }

    await currentBoundary.boundary.sendLocalSource(
      senderDeviceId,
      deviceId,
      createLocalTextTransferChunkSource(item),
    )
    flash('Texto enviado por Directo local')
  }, [flash, identity?.deviceId, identity?.generalRoomId, identity?.persisted, localItems, localShareItemId])

  const sendLocalImageToDirect = useCallback(async (deviceId: string) => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted) throw new Error('La identidad vinculada todavía no está disponible')
    if (!localImageShareItem || localImageShareItem.id !== localImageShareItemId) {
      throw new Error('Esta imagen ya no está disponible')
    }

    await sendLocalImageDirect(roomId, deviceId, localImageShareItem)
    flash('Imagen enviada por Directo local')
  }, [flash, identity?.generalRoomId, identity?.persisted, localImageShareItem, localImageShareItemId])

  const stageGeneralText = useCallback(async (text: string) => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted) throw new Error('General todavía no está disponible en este dispositivo')
    setPendingGeneralText(text)
    setGeneralDestinationOpen(true)
    return false
  }, [identity?.generalRoomId, identity?.persisted])

  const sendGeneralTextToDestination = useCallback(async (deviceId: string) => {
    const roomId = identity?.generalRoomId
    const text = pendingGeneralText
    if (!roomId || !identity.persisted || !text) throw new Error('El texto de General ya no está disponible')

    const result = await sendGeneralTargetedText(roomId, deviceId, text)
    setPendingGeneralText(null)
    setGeneralDestinationOpen(false)
    setGeneralComposerResetKey((current) => current + 1)
    flash(result.delivery === 'direct'
      ? 'Texto enviado por Directo al dispositivo elegido'
      : 'Texto enviado por Nube al dispositivo elegido')
  }, [flash, identity?.generalRoomId, identity?.persisted, pendingGeneralText])

  const deleteGeneralText = useCallback(async (itemId: string) => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted || !generalCacheReady) throw new Error('General todavía no está disponible en este dispositivo')

    const snapshot = generalItemsRef.current.find((item) => item.id === itemId)
    const result = await deleteClipboardText(
      roomId,
      itemId,
      snapshot?.directOnly ? {
        directOnly: true,
        fallbackSeed: {
          text: snapshot.text,
          createdAt: snapshot.createdAt,
          expiresAt: snapshot.expiresAt,
        },
      } : undefined,
    )
    const nextItems = removeGeneralItem(itemId)
    persistGeneralCache(roomId, nextItems)
    if (result.delivery === 'direct') {
      flash('Texto eliminado por Directo local')
      return
    }

    const synced = await syncGeneral()
    flash(synced ? 'Texto eliminado de General' : 'Texto eliminado; actualización pendiente')
  }, [flash, generalCacheReady, identity?.generalRoomId, identity?.persisted, persistGeneralCache, removeGeneralItem, syncGeneral])

  const deleteGeneralVisibleText = useCallback(async (itemId: string) => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted) throw new Error('General todavía no está disponible en este dispositivo')
    if (generalTargetedItems.some((entry) => entry.id === itemId)) {
      await deleteGeneralTargetedInboxItem(roomId, itemId)
      setGeneralTargetedItems((current) => current.filter((entry) => entry.id !== itemId))
      flash('Eliminado de General en este dispositivo')
      return
    }
    await deleteGeneralText(itemId)
  }, [deleteGeneralText, flash, generalTargetedItems, identity?.generalRoomId, identity?.persisted])

  const preserveGeneralItem = useCallback(async (item: ClipboardItem, target: PreserveTarget) => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted) throw new Error('General todavía no está disponible en este dispositivo')

    if (target === 'devices') {
      throw new Error('Mis dispositivos se activará después de cerrar la prueba directa entre equipos.')
    }
    if (target === 'cloud') {
      throw new Error('Mi nube se activará cuando Google Drive esté conectado realmente.')
    }

    const targeted = generalTargetedItems.find((entry) => entry.id === item.id)
    const targetedSnapshot: ClipboardTextSnapshot | undefined = targeted && identity?.personId ? {
      sequence: 0,
      id: targeted.id,
      authorPersonId: identity.personId,
      authorDeviceId: targeted.senderDeviceId,
      text: targeted.text,
      createdAt: targeted.createdAt,
      expiresAt: targeted.expiresAt,
    } : undefined
    const snapshot = generalItemsRef.current.find((entry) => entry.id === item.id)
      ?? localPreservedItems.find((entry) => entry.id === item.id)
      ?? targetedSnapshot
    if (!snapshot) throw new Error('Este contenido ya no está disponible para conservar')

    await preserveTextOnThisDevice(roomId, snapshot)
    setLocalPreservedItems((current) => {
      const next = new Map(current.map((entry) => [entry.id, entry]))
      next.set(snapshot.id, snapshot)
      return Array.from(next.values()).sort((a, b) => b.createdAt - a.createdAt || b.sequence - a.sequence)
    })
    flash('Conservado en este dispositivo')
  }, [flash, generalTargetedItems, identity?.generalRoomId, identity?.persisted, identity?.personId, localPreservedItems])

  const releaseGeneralItem = useCallback(async (item: ClipboardItem) => {
    const roomId = identity?.generalRoomId
    if (!roomId) throw new Error('General todavía no está disponible en este dispositivo')

    await releaseTextFromThisDevice(roomId, item.id)
    setLocalPreservedItems((current) => current.filter((entry) => entry.id !== item.id))
    flash('Ya no se conserva en este dispositivo')
  }, [flash, identity?.generalRoomId])

  useEffect(() => {
    if (themePreference !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handleSystemTheme = () => applyTheme('system')
    media.addEventListener('change', handleSystemTheme)
    return () => media.removeEventListener('change', handleSystemTheme)
  }, [themePreference])

  useEffect(() => {
    const showUpdate = () => setUpdateAvailable(true)
    window.addEventListener(serviceWorkerUpdateEvent, showUpdate)
    return () => window.removeEventListener(serviceWorkerUpdateEvent, showUpdate)
  }, [])

  useEffect(() => {
    let cancelled = false
    readLocalClipboardTexts()
      .then((items) => {
        if (cancelled) return
        setLocalItems((current) => normalizeLocalClipboardTexts([...current, ...items]))
        setLocalClipboardReady(true)
      })
      .catch(() => {
        if (!cancelled) setLocalClipboardReady(true)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!localImageShareItemId) {
      setLocalImageShareItem(null)
      return
    }
    let cancelled = false
    readLocalImages()
      .then((items) => {
        if (!cancelled) setLocalImageShareItem(items.find((item) => item.id === localImageShareItemId) ?? null)
      })
      .catch(() => {
        if (!cancelled) setLocalImageShareItem(null)
      })
    return () => { cancelled = true }
  }, [localImageShareItemId])

  useEffect(() => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted) {
      const current = localTransferBoundaryRef.current
      localTransferBoundaryRef.current = null
      current?.boundary.disconnect()
      return
    }

    const boundary = createLocalTransferProductBoundary(roomId)
    localTransferBoundaryRef.current = { roomId, boundary }
    return () => {
      if (localTransferBoundaryRef.current?.boundary === boundary) {
        localTransferBoundaryRef.current = null
      }
      boundary.disconnect()
    }
  }, [identity?.generalRoomId, identity?.persisted])

  useEffect(() => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted) return

    return subscribeLocalClipboardDirectReceipts(roomId, (item) => {
      setLocalItems((current) => normalizeLocalClipboardTexts([...current, item]))
      flash('Texto recibido por Directo local')
    })
  }, [flash, identity?.generalRoomId, identity?.persisted])

  useEffect(() => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted) return
    return subscribeLocalImageDirectReceipts(roomId, () => {
      flash('Imagen recibida por Directo local')
    })
  }, [flash, identity?.generalRoomId, identity?.persisted])

  useEffect(() => {
    let cancelled = false
    const roomId = identity?.generalRoomId
    setGeneralTargetedItems([])
    if (!roomId || !identity.persisted) return () => { cancelled = true }

    const mergeTargeted = (items: GeneralTargetedInboxItem[]) => {
      setGeneralTargetedItems((current) => {
        const merged = new Map(current.map((item) => [item.id, item]))
        for (const item of items) merged.set(item.id, item)
        return Array.from(merged.values())
          .filter((item) => item.expiresAt > Date.now())
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      })
    }

    void readGeneralTargetedInbox(roomId)
      .then((items) => { if (!cancelled) mergeTargeted(items) })
      .catch(() => undefined)
    const unsubscribe = subscribeGeneralTargetedReceipts(roomId, ({ item, delivery }) => {
      if (cancelled) return
      mergeTargeted([item])
      flash(delivery === 'direct'
        ? 'Texto recibido en General por Directo'
        : 'Texto recibido en General por Nube')
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [flash, identity?.generalRoomId, identity?.persisted])

  useEffect(() => {
    if (cloudConnectivity === 'online' || cloudConnectivity === 'offline') {
      setVisibleCloudConnectivity(cloudConnectivity)
    }
  }, [cloudConnectivity])

  useEffect(() => {
    const handleOffline = () => setCloudConnectivity('offline')
    const handleOnline = () => setCloudConnectivity('checking')
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const roomId = identity?.generalRoomId

    generalCursorRef.current = 0
    generalItemsRef.current = []
    setGeneralItems([])
    setGeneralSyncStatus('idle')
    setCloudConnectivity('checking')
    setVisibleCloudConnectivity('offline')
    setGeneralCacheReady(false)

    if (!roomId) return () => { cancelled = true }

    readGeneralClipboardCache(roomId)
      .then((cached) => {
        if (cancelled) return
        if (cached) {
          generalCursorRef.current = cached.cursor
          commitGeneralItems(cached.items)
        }
        setGeneralCacheReady(true)
      })
      .catch(() => {
        if (!cancelled) setGeneralCacheReady(true)
      })

    return () => { cancelled = true }
  }, [commitGeneralItems, identity?.generalRoomId])

  useEffect(() => {
    let cancelled = false
    const roomId = identity?.generalRoomId
    setLocalPreservedItems([])
    if (!roomId) return () => { cancelled = true }

    readLocalPreservedTexts(roomId)
      .then((items) => {
        if (!cancelled) setLocalPreservedItems(items)
      })
      .catch(() => {
        if (!cancelled) setLocalPreservedItems([])
      })

    return () => { cancelled = true }
  }, [identity?.generalRoomId])

  useEffect(() => {
    const roomId = identity?.generalRoomId
    if (!connectedSurfaceMode || !roomId || !identity.persisted) return

    if (connectedSurfaceMode === 'content') ensureClipboardRoomConnectivity(roomId)
    else ensureClipboardRoomControlConnectivity(roomId)
    return () => suspendClipboardRoomConnectivity(roomId)
  }, [connectedSurfaceMode, identity?.generalRoomId, identity?.persisted])

  useEffect(() => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted) return
    ensureClipboardRoomForegroundReception(roomId)
    return () => suspendClipboardRoomForegroundReception(roomId)
  }, [identity?.generalRoomId, identity?.persisted])

  useEffect(() => {
    const roomId = identity?.generalRoomId
    if (!isGeneralView || !roomId || !identity.persisted) return
    return subscribeCloudConnectivity(roomId, setCloudConnectivity)
  }, [identity?.generalRoomId, identity?.persisted, isGeneralView])

  useEffect(() => {
    const roomId = identity?.generalRoomId
    if (!isGeneralView || !roomId || !identity.persisted || !generalCacheReady) return

    return subscribeDirectClipboardChanges(roomId, (change) => {
      if (change.directOnly) {
        const nextItems = change.type === 'delete'
          ? removeGeneralItem(change.itemId)
          : mergeGeneralItems([change.item])
        void writeGeneralClipboardCache(roomId, generalCursorRef.current, nextItems).catch(() => undefined)
        return
      }

      const decision = classifyDirectSequence(generalCursorRef.current, change.sequence)
      if (decision === 'stale') return
      if (decision === 'gap') {
        void syncGeneral().then((synced) => {
          if (!synced && generalSyncingRef.current) {
            window.setTimeout(() => void syncGeneral(), 250)
          }
        })
        return
      }

      const nextItems = change.type === 'delete'
        ? removeGeneralItem(change.itemId)
        : mergeGeneralItems([change.item])
      generalCursorRef.current = change.sequence
      void writeGeneralClipboardCache(roomId, change.sequence, nextItems).catch(() => undefined)
    })
  }, [generalCacheReady, identity?.generalRoomId, identity?.persisted, isGeneralView, mergeGeneralItems, removeGeneralItem, syncGeneral])

  useEffect(() => {
    const roomId = identity?.generalRoomId
    if (!isGeneralView || !roomId || !identity.persisted || !generalCacheReady) return

    return subscribeCloudClipboardSyncHints(roomId, () => {
      void syncGeneral().then((synced) => {
        if (!synced && generalSyncingRef.current) {
          window.setTimeout(() => void syncGeneral(), 250)
        }
      })
    })
  }, [generalCacheReady, identity?.generalRoomId, identity?.persisted, isGeneralView, syncGeneral])

  useEffect(() => {
    if (canSyncRealGeneral) void syncGeneral()
  }, [canSyncRealGeneral, syncGeneral])

  useEffect(() => {
    if (!canSyncRealGeneral) return

    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') void syncGeneral()
    }

    document.addEventListener('visibilitychange', syncWhenVisible)
    window.addEventListener('focus', syncWhenVisible)
    return () => {
      document.removeEventListener('visibilitychange', syncWhenVisible)
      window.removeEventListener('focus', syncWhenVisible)
    }
  }, [canSyncRealGeneral, syncGeneral])

  const changeTheme = (nextTheme: ThemePreference) => {
    saveThemePreference(nextTheme)
    setThemePreference(nextTheme)
  }

  const localContext = !activeRoom || isLocalView
  const identityChipLabel = localContext
    ? 'Local'
    : identityStatus === 'ready' ? 'Seguro' : identityStatus === 'error' ? 'Sin verificar' : 'Verificando'
  const identityChipMessage = localContext
    ? 'Mi portapapeles funciona en este dispositivo sin guardar contenido en D1 ni R2'
    : identityStatus === 'ready'
      ? identity?.persisted ? 'Identidad y General guardadas en el servidor' : 'Identidad verificada sin persistencia'
      : identityStatus === 'error'
        ? 'No se pudo verificar la identidad; Mi portapapeles local sigue disponible'
        : 'Verificando identidad segura'

  const localPreservedIds = useMemo(() => new Set(localPreservedItems.map((item) => item.id)), [localPreservedItems])

  const localCardItems = useMemo<ClipboardItem[]>(() => localItems.map((item) => ({
    id: item.id,
    type: 'text',
    author: item.receivedFromDeviceId ? 'Dispositivo vinculado' : 'Este dispositivo',
    text: item.text,
    ownedByMe: true,
  })), [localItems])

  const preservedGeneralCardItems = useMemo<ClipboardItem[]>(() => localPreservedItems
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt || b.sequence - a.sequence)
    .map((item) => ({
      id: item.id,
      type: 'text',
      author: item.authorDeviceId === identity?.deviceId ? 'Este dispositivo' : 'Dispositivo vinculado',
      text: item.text,
      ownedByMe: true,
      preserveTarget: 'device',
    })), [identity?.deviceId, localPreservedItems])

  const recentGeneralCardItems = useMemo<ClipboardItem[]>(() => {
    const now = Date.now()
    const entries: Array<{ createdAt: number; card: ClipboardItem }> = selectRecentGeneralTexts(
      generalItems,
      localPreservedIds,
      now,
    ).map((item) => ({
      createdAt: item.createdAt,
      card: {
        id: item.id,
        type: 'text',
        author: item.authorDeviceId === identity?.deviceId ? 'Este dispositivo' : 'Dispositivo vinculado',
        text: item.text,
        ownedByMe: true,
      },
    }))
    for (const item of generalTargetedItems) {
      if (item.expiresAt <= now || localPreservedIds.has(item.id)) continue
      entries.push({
        createdAt: item.createdAt,
        card: {
          id: item.id,
          type: 'text',
          author: 'Dispositivo vinculado',
          text: item.text,
          ownedByMe: true,
        },
      })
    }
    return entries.sort((a, b) => b.createdAt - a.createdAt).map((entry) => entry.card)
  }, [generalItems, generalTargetedItems, identity?.deviceId, localPreservedIds])

  const syncLabel = isLocalView
    ? localClipboardReady ? 'Solo en este dispositivo' : 'Cargando local…'
    : !isGeneralView
      ? 'Contenido simulado'
      : !canUseRealGeneral
        ? identityStatus === 'error' ? 'General no disponible' : 'Preparando General'
        : !generalCacheReady
          ? 'Cargando caché…'
          : visibleCloudConnectivity === 'online'
            ? 'Conectado'
            : 'Desconectado'

  const visibleItems = isLocalView
    ? localCardItems
    : isGeneralView
      ? recentGeneralCardItems
      : mockItems

  return (
    <div className="app-stage">
      <div className="ambient ambient--one" aria-hidden="true" />
      <div className="ambient ambient--two" aria-hidden="true" />
      <header className="topbar">
        <button className="brand" type="button" onClick={() => { setPreservedOpen(false); setLocalShareItemId(null); setLocalImageShareItemId(null); setActiveRoom(null) }} aria-label="Ir al inicio de OACLIX">
          <img src="/oaclix-mark-simple.svg" alt="OACLIX" />
        </button>
        <div className="topbar__actions">
          <button className="sync-chip" type="button" onClick={() => flash(identityChipMessage)}>
            <span className={`status-dot ${!localContext && identityStatus !== 'ready' ? 'is-off' : ''}`} /><Icon name={localContext ? 'clipboard' : 'devices'} /> {identityChipLabel}
          </button>
          <button className="icon-button" type="button" aria-label="Abrir vinculados" onClick={openLinked}><Icon name="devices" /></button>
          <button
            className="icon-button"
            type="button"
            aria-label="Abrir menú"
            aria-expanded={menuOpen}
            onClick={() => {
              setAppearanceOpen(false)
              setMenuOpen((current) => !current)
            }}
          ><Icon name="settings" /></button>
        </div>
      </header>

      <main className="main-shell">
        {!activeRoom ? (
          <div className="home-view view-enter">
            <section className="home-intro">
              <div>
                <span className="eyebrow"><Icon name="spark" /> Portapapeles a tu manera</span>
                <h1>Todo cerca.<br/><span>Sin rodeos.</span></h1>
              </div>
              <p>Mi portapapeles empieza local en este dispositivo. Compartir con otros equipos o usar nube es una acción aparte.</p>
            </section>

            <section className="general-section" aria-label="Espacio predeterminado">
              <GeneralCard room={favorite} onOpen={openRoom} />
            </section>

            <section className="rooms-section">
              <div className="section-head">
                <div><span className="eyebrow">Tus espacios</span><h2>Salas</h2></div>
                <div className="section-actions">
                  <button className="ghost-button" type="button"><Icon name="plus" /> Crear</button>
                  <button className="ghost-button" type="button">Entrar</button>
                </div>
              </div>
              <div className="rooms-grid">{otherRooms.map((room) => <RoomCard key={room.id} room={room} onOpen={openRoom} />)}</div>
            </section>
          </div>
        ) : (
          <div className="room-view view-enter">
            <section className="room-toolbar">
              <button className="back-button" type="button" onClick={() => { setPreservedOpen(false); setLocalShareItemId(null); setLocalImageShareItemId(null); setActiveRoom(null) }}><Icon name="arrow-left" /> Salas</button>
              <div className="room-title">
                <span className={`room-title__icon room-title__icon--${activeRoom.accent}`}><Icon name={isLocalView ? 'clipboard' : activeRoom.private ? 'lock' : 'users'} /></span>
                <div><span className="eyebrow">{isLocalView ? 'Este dispositivo' : activeRoom.private ? 'Sala privada' : 'Sala compartida'}</span><h1>{activeRoom.name}</h1></div>
              </div>
              <div className="room-toolbar__actions">
                <button className={`favorite-button ${isFavoriteView ? 'is-active' : ''}`} type="button" onClick={() => makeDefault(activeRoom)}><Icon name="star" /> {isFavoriteView ? 'Predeterminada' : 'Favorita'}</button>
                {isGeneralView && (
                  <button
                    className={`icon-button preserved-toolbar-button ${preservedGeneralCardItems.length > 0 ? 'is-active' : ''}`}
                    type="button"
                    aria-label={`Abrir conservados${preservedGeneralCardItems.length > 0 ? `, ${preservedGeneralCardItems.length}` : ''}`}
                    onClick={() => setPreservedOpen(true)}
                  >
                    <Icon name="pin" />
                    {preservedGeneralCardItems.length > 0 && <span className="preserved-toolbar-button__count">{preservedGeneralCardItems.length}</span>}
                  </button>
                )}
                <button className="icon-button" type="button" onClick={openLinked} aria-label="Vinculados"><Icon name="devices" /></button>
                <button className="icon-button" type="button" aria-label="Más opciones"><Icon name="more" /></button>
              </div>
            </section>

            <section className="clipboard-head">
              <div><span className="eyebrow">Portapapeles</span><h2>Reciente</h2></div>
              <div className="clipboard-head__status">
                <span className={`status-dot ${visibleCloudConnectivity === 'offline' && isGeneralView ? 'is-off' : ''}`} />
                <span>{syncLabel}</span>
                {isGeneralView && (
                  <ManualRefreshButton
                    disabled={!canSyncRealGeneral || generalSyncStatus === 'syncing'}
                    onRefresh={syncGeneral}
                  />
                )}
              </div>
            </section>

            {isLocalView && (
              <ClipboardComposer
                disabled={!localClipboardReady}
                label="Mi portapapeles"
                textareaId="local-text"
                submitLabel="Guardar texto"
                busyLabel="Guardando…"
                routeText="Local · sin nube"
                onSend={saveLocalText}
                onShareImage={openLocalImageShare}
              />
            )}

            {isGeneralView && (
              <ClipboardComposer
                disabled={!canUseRealGeneral}
                cloudConnected={visibleCloudConnectivity === 'online'}
                routeText="Elige un dispositivo al enviar"
                resetKey={generalComposerResetKey}
                onSend={stageGeneralText}
              />
            )}

            <section className="clip-list">
              {visibleItems.length > 0 ? visibleItems.map((item) => (
                <ClipboardCard
                  key={item.id}
                  item={item}
                  onDelete={isLocalView ? deleteLocalText : isGeneralView ? deleteGeneralVisibleText : (id) => setMockItems((current) => current.filter((entry) => entry.id !== id))}
                  onShare={isLocalView ? openLocalShare : undefined}
                  onPreserve={isGeneralView ? preserveGeneralItem : undefined}
                  onReleasePreserve={isGeneralView ? releaseGeneralItem : undefined}
                />
              )) : <div className="empty-state"><Icon name="clipboard"/><h3>Portapapeles limpio</h3><p>{isLocalView ? 'Lo que escribas o pegues se guardará solo en este dispositivo.' : isGeneralView ? 'Lo nuevo que envíes aparecerá aquí. Tus fijados están en el botón de pin.' : 'Lo próximo que copies aparecerá aquí.'}</p></div>}
            </section>
          </div>
        )}
      </main>

      <SettingsMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenConnections={() => {
          setMenuOpen(false)
          setConnectionsOpen(true)
        }}
        onOpenAppearance={() => {
          setMenuOpen(false)
          setAppearanceOpen(true)
        }}
      />
      <ConnectionsStoragePanel open={connectionsOpen} onClose={() => setConnectionsOpen(false)} />
      <ThemePicker open={appearanceOpen} value={themePreference} onChange={changeTheme} onClose={() => setAppearanceOpen(false)} />
      <GeneralDestinationPanel
        open={generalDestinationOpen}
        identity={identity}
        identityStatus={identityStatus}
        onClose={() => {
          setGeneralDestinationOpen(false)
          setPendingGeneralText(null)
        }}
        onSelect={sendGeneralTextToDestination}
      />
      <LocalClipboardSharePanel
        open={Boolean(localShareItemId)}
        item={localShareItem}
        identity={identity}
        identityStatus={identityStatus}
        onClose={() => setLocalShareItemId(null)}
        onSendDirect={sendLocalTextDirect}
      />
      <LocalImageSharePanel
        open={Boolean(localImageShareItemId)}
        item={localImageShareItem}
        identity={identity}
        identityStatus={identityStatus}
        onClose={() => setLocalImageShareItemId(null)}
        onSendDirect={sendLocalImageToDirect}
      />
      <LinkedPanel open={linkedOpen} onClose={() => setLinkedOpen(false)} identity={identity} identityStatus={identityStatus} onIdentityRefresh={refreshIdentity} />
      <PreservedPanel open={preservedOpen} items={preservedGeneralCardItems} onClose={() => setPreservedOpen(false)} onRelease={releaseGeneralItem} />
      <UpdatePrompt open={updateAvailable} />
      <div className={`toast ${toast ? 'is-visible' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  )
}

export default App