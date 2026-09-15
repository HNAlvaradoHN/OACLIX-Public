from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str):
    if old not in text:
        raise SystemExit(f"Expected anchor not found: {label}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str):
    updated, count = re.subn(pattern, lambda _: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"Expected regex block not found: {label}")
    return updated


app_path = Path('src/App.tsx')
app = app_path.read_text()
app = replace_once(
    app,
    "import { GeneralCard } from './components/GeneralCard'\n",
    "import { GeneralCard } from './components/GeneralCard'\nimport { GeneralDestinationPanel } from './components/GeneralDestinationPanel'\n",
    'GeneralDestinationPanel import',
)
app = replace_once(
    app,
    "import { createClipboardText, deleteClipboardText, ensureClipboardRoomConnectivity, ensureClipboardRoomControlConnectivity, listClipboardChanges, subscribeCloudClipboardSyncHints, subscribeDirectClipboardChanges, suspendClipboardRoomConnectivity, type ClipboardChange, type ClipboardTextSnapshot } from './data/clipboardApi'\n",
    "import { deleteClipboardText, ensureClipboardRoomConnectivity, ensureClipboardRoomControlConnectivity, ensureClipboardRoomForegroundReception, listClipboardChanges, subscribeCloudClipboardSyncHints, subscribeDirectClipboardChanges, suspendClipboardRoomConnectivity, suspendClipboardRoomForegroundReception, type ClipboardChange, type ClipboardTextSnapshot } from './data/clipboardApi'\n",
    'clipboardApi import',
)
app = replace_once(
    app,
    "import { selectRecentGeneralTexts } from './data/generalClipboardView'\n",
    "import { selectRecentGeneralTexts } from './data/generalClipboardView'\nimport { deleteGeneralTargetedInboxItem, readGeneralTargetedInbox, type GeneralTargetedInboxItem } from './data/generalTargetedInbox'\n",
    'targeted inbox import',
)
app = replace_once(
    app,
    "import { classifyDirectSequence } from './transport/directCursorPolicy'\n",
    "import { classifyDirectSequence } from './transport/directCursorPolicy'\nimport { subscribeGeneralTargetedReceipts } from './transport/generalTargetedReceiptBus'\nimport { sendGeneralTargetedText } from './transport/generalTargetedTextTransport'\n",
    'targeted transport imports',
)
app = replace_once(
    app,
    "  const [generalItems, setGeneralItems] = useState<ClipboardTextSnapshot[]>([])\n",
    "  const [generalItems, setGeneralItems] = useState<ClipboardTextSnapshot[]>([])\n  const [generalTargetedItems, setGeneralTargetedItems] = useState<GeneralTargetedInboxItem[]>([])\n  const [generalDestinationOpen, setGeneralDestinationOpen] = useState(false)\n  const [pendingGeneralText, setPendingGeneralText] = useState<string | null>(null)\n  const [generalComposerResetKey, setGeneralComposerResetKey] = useState(0)\n",
    'General targeted state',
)

app = sub_once(
    app,
    r"  const sendGeneralText = useCallback\(async \(text: string\) => \{.*?\n  const deleteGeneralText = useCallback",
    """  const stageGeneralText = useCallback(async (text: string) => {
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

  const deleteGeneralText = useCallback""",
    'legacy General send callback',
)

app = replace_once(
    app,
    "  const preserveGeneralItem = useCallback(async (item: ClipboardItem, target: PreserveTarget) => {\n",
    """  const deleteGeneralVisibleText = useCallback(async (itemId: string) => {
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
""",
    'local targeted delete callback',
)
app = replace_once(
    app,
    """    const snapshot = generalItemsRef.current.find((entry) => entry.id === item.id)
      ?? localPreservedItems.find((entry) => entry.id === item.id)
    if (!snapshot) throw new Error('Este contenido ya no está disponible para conservar')
""",
    """    const targeted = generalTargetedItems.find((entry) => entry.id === item.id)
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
""",
    'preserve targeted snapshot',
)
app = replace_once(
    app,
    "  }, [flash, identity?.generalRoomId, identity?.persisted, localPreservedItems])\n\n  const releaseGeneralItem",
    "  }, [flash, generalTargetedItems, identity?.generalRoomId, identity?.persisted, identity?.personId, localPreservedItems])\n\n  const releaseGeneralItem",
    'preserve dependencies',
)

image_effect = """  useEffect(() => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted) return
    return subscribeLocalImageDirectReceipts(roomId, () => {
      flash('Imagen recibida por Directo local')
    })
  }, [flash, identity?.generalRoomId, identity?.persisted])
"""
targeted_effect = """

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
"""
app = replace_once(app, image_effect, image_effect + targeted_effect, 'targeted inbox effect')

connectivity_effect = """  useEffect(() => {
    const roomId = identity?.generalRoomId
    if (!connectedSurfaceMode || !roomId || !identity.persisted) return

    if (connectedSurfaceMode === 'content') ensureClipboardRoomConnectivity(roomId)
    else ensureClipboardRoomControlConnectivity(roomId)
    return () => suspendClipboardRoomConnectivity(roomId)
  }, [connectedSurfaceMode, identity?.generalRoomId, identity?.persisted])
"""
foreground_effect = """

  useEffect(() => {
    const roomId = identity?.generalRoomId
    if (!roomId || !identity.persisted) return
    ensureClipboardRoomForegroundReception(roomId)
    return () => suspendClipboardRoomForegroundReception(roomId)
  }, [identity?.generalRoomId, identity?.persisted])
"""
app = replace_once(app, connectivity_effect, connectivity_effect + foreground_effect, 'foreground receiver effect')

app = sub_once(
    app,
    r"  const recentGeneralCardItems = useMemo<ClipboardItem\[]>\(.*?\n\n  const syncLabel =",
    """  const recentGeneralCardItems = useMemo<ClipboardItem[]>(() => {
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

  const syncLabel =""",
    'General recent cards',
)
app = replace_once(
    app,
    """            {isGeneralView && (
              <ClipboardComposer
                disabled={!canSyncRealGeneral}
                cloudConnected={visibleCloudConnectivity === 'online'}
                onSend={sendGeneralText}
              />
            )}
""",
    """            {isGeneralView && (
              <ClipboardComposer
                disabled={!canUseRealGeneral}
                cloudConnected={visibleCloudConnectivity === 'online'}
                routeText="Elige un dispositivo al enviar"
                resetKey={generalComposerResetKey}
                onSend={stageGeneralText}
              />
            )}
""",
    'General composer',
)
app = replace_once(
    app,
    "onDelete={isLocalView ? deleteLocalText : isGeneralView ? deleteGeneralText : (id) => setMockItems((current) => current.filter((entry) => entry.id !== id))}",
    "onDelete={isLocalView ? deleteLocalText : isGeneralView ? deleteGeneralVisibleText : (id) => setMockItems((current) => current.filter((entry) => entry.id !== id))}",
    'General delete handler',
)
app = replace_once(
    app,
    "      <LocalClipboardSharePanel\n",
    """      <GeneralDestinationPanel
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
""",
    'General destination panel render',
)
app_path.write_text(app)

composer_path = Path('src/components/ClipboardComposer.tsx')
composer = composer_path.read_text()
composer = replace_once(
    composer,
    "import { ClipboardEvent, FormEvent, useState, useSyncExternalStore } from 'react'",
    "import { ClipboardEvent, FormEvent, useEffect, useState, useSyncExternalStore } from 'react'",
    'composer useEffect import',
)
composer = replace_once(
    composer,
    "  textareaId = 'general-text',\n  onSend,",
    "  textareaId = 'general-text',\n  resetKey = 0,\n  onSend,",
    'composer resetKey argument',
)
composer = replace_once(
    composer,
    "  textareaId?: string\n  onSend: (text: string) => Promise<void>",
    "  textareaId?: string\n  resetKey?: number\n  onSend: (text: string) => Promise<void | boolean>",
    'composer callback type',
)
composer = replace_once(
    composer,
    "  const localClipboard = textareaId === 'local-text'\n\n  const submit",
    """  const localClipboard = textareaId === 'local-text'

  useEffect(() => {
    setText('')
    setError(null)
  }, [resetKey])

  const submit""",
    'composer reset effect',
)
composer = replace_once(
    composer,
    "      await onSend(text)\n      setText('')",
    "      const shouldClear = await onSend(text)\n      if (shouldClear !== false) setText('')",
    'composer retain staged text',
)
composer_path.write_text(composer)

Path('tests/generalTargetedUiWiring.test.ts').write_text(r"""import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appPath = new URL('../src/App.tsx', import.meta.url)
const composerPath = new URL('../src/components/ClipboardComposer.tsx', import.meta.url)

test('General exige destino explícito y conserva el texto si se cancela el selector', async () => {
  const app = await readFile(appPath, 'utf8')
  const composer = await readFile(composerPath, 'utf8')
  assert.match(app, /GeneralDestinationPanel/)
  assert.match(app, /sendGeneralTargetedText\(roomId, deviceId, text\)/)
  assert.match(app, /routeText="Elige un dispositivo al enviar"/)
  assert.match(app, /return false/)
  assert.match(composer, /shouldClear !== false/)
  assert.match(composer, /resetKey/)
})

test('General mantiene recepción dirigida mientras OACLIX está abierta', async () => {
  const app = await readFile(appPath, 'utf8')
  assert.match(app, /ensureClipboardRoomForegroundReception\(roomId\)/)
  assert.match(app, /suspendClipboardRoomForegroundReception\(roomId\)/)
  assert.match(app, /subscribeGeneralTargetedReceipts/)
  assert.match(app, /readGeneralTargetedInbox\(roomId\)/)
})

test('los textos dirigidos se borran localmente sin emitir delete compartido', async () => {
  const app = await readFile(appPath, 'utf8')
  assert.match(app, /generalTargetedItems\.some/)
  assert.match(app, /deleteGeneralTargetedInboxItem\(roomId, itemId\)/)
  assert.match(app, /await deleteGeneralText\(itemId\)/)
})
""")
