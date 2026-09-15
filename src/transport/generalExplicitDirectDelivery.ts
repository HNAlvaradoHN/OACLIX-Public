import type { ClipboardTextSnapshot } from '../data/clipboardCloudApi'
import type { LanClipboardContentChange } from '../realtime/lanClipboardBus'
import {
  subscribeLanDirectFirstPrepAcks,
  type LanDirectFirstPrepMeta,
} from '../realtime/lanDirectFirstPrep.ts'

const DIRECT_TEXT_RETENTION_MS = 21_600_000
const DIRECT_ACK_TIMEOUT_MS = 8_000

type GeneralDirectAckWaiter = {
  promise: Promise<void>
  cancel: () => void
}

export type GeneralExplicitDirectDeliveryDependencies = {
  getLocalDeviceId: () => Promise<string>
  getPersonId: () => Promise<string>
  prepareUpsert: (
    roomId: string,
    item: ClipboardTextSnapshot,
    destinationDeviceIds: Iterable<string>,
  ) => Promise<LanDirectFirstPrepMeta | null>
  sendToPeer: (targetDeviceId: string, change: LanClipboardContentChange) => boolean
  createAckWaiter?: (
    roomId: string,
    targetDeviceId: string,
    prep: LanDirectFirstPrepMeta,
  ) => GeneralDirectAckWaiter
  now?: () => number
  createItemId?: () => string
}

function randomItemId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `itm_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

export function createGeneralDirectAckWaiter(
  roomId: string,
  targetDeviceId: string,
  prep: LanDirectFirstPrepMeta,
  timeoutMs = DIRECT_ACK_TIMEOUT_MS,
): GeneralDirectAckWaiter {
  let unsubscribe: () => void = () => undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  let settled = false

  const cleanup = () => {
    unsubscribe()
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const promise = new Promise<void>((resolve, reject) => {
    unsubscribe = subscribeLanDirectFirstPrepAcks(roomId, (remoteDeviceId, ack) => {
      if (
        remoteDeviceId !== targetDeviceId
        || ack.changeId !== prep.changeId
        || ack.authorDeviceId !== prep.authorDeviceId
        || ack.authorSequence !== prep.authorSequence
      ) return

      if (settled) return
      settled = true
      cleanup()
      resolve()
    })

    timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('El dispositivo no confirmó que guardó el texto por Directo'))
    }, timeoutMs)
  })

  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      cleanup()
    },
  }
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

  const ackWaiter = (dependencies.createAckWaiter ?? createGeneralDirectAckWaiter)(
    roomId,
    targetDeviceId,
    directFirstPrep,
  )

  if (!dependencies.sendToPeer(targetDeviceId, change)) {
    ackWaiter.cancel()
    throw new Error('La ruta Directo cambió durante el envío')
  }

  await ackWaiter.promise
  return item
}
