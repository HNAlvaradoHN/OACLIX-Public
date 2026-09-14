import type { ClipboardTextSnapshot } from '../data/clipboardCloudApi'
import type { LanClipboardContentChange } from '../realtime/lanClipboardBus'
import type { LanDirectFirstPrepMeta } from '../realtime/lanDirectFirstPrep'

const DIRECT_TEXT_RETENTION_MS = 21_600_000

export type GeneralExplicitDirectDeliveryDependencies = {
  getLocalDeviceId: () => Promise<string>
  getPersonId: () => Promise<string>
  prepareUpsert: (
    roomId: string,
    item: ClipboardTextSnapshot,
    destinationDeviceIds: Iterable<string>,
  ) => Promise<LanDirectFirstPrepMeta | null>
  sendToPeer: (targetDeviceId: string, change: LanClipboardContentChange) => boolean
  now?: () => number
  createItemId?: () => string
}

function randomItemId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `itm_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

export async function deliverGeneralTextDirectlyToDevice(
  roomId: string,
  targetDeviceId: string,
  text: string,
  dependencies: GeneralExplicitDirectDeliveryDependencies,
) {
  const localDeviceId = await dependencies.getLocalDeviceId()
  if (targetDeviceId === localDeviceId) throw new Error('El destino debe ser otro dispositivo')

  const now = (dependencies.now ?? Date.now)()
  const draft: ClipboardTextSnapshot = {
    sequence: 1,
    id: (dependencies.createItemId ?? randomItemId)(),
    authorPersonId: await dependencies.getPersonId(),
    authorDeviceId: localDeviceId,
    text,
    createdAt: now,
    expiresAt: now + DIRECT_TEXT_RETENTION_MS,
    directOnly: true,
  }

  // prepareUpsert escribe el checkpoint durable antes de que salga un byte al peer.
  const directFirstPrep = await dependencies.prepareUpsert(roomId, draft, [targetDeviceId])
  if (!directFirstPrep) throw new Error('No se pudo preparar el envío Directo')

  const item: ClipboardTextSnapshot = {
    ...draft,
    sequence: directFirstPrep.authorSequence,
  }
  const change: LanClipboardContentChange = {
    sequence: directFirstPrep.authorSequence,
    type: 'upsert',
    item,
    directOnly: true,
    directFirstPrep,
  }

  if (!dependencies.sendToPeer(targetDeviceId, change)) {
    throw new Error('La ruta Directo cambió durante el envío')
  }

  return item
}
