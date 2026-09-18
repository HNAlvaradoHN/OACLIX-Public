import { generalRoomId, type D1DatabaseLike, type DevicePrincipal } from './coreStore'

const LINK_TTL_MS = 10 * 60 * 1000
const MIN_REGENERATE_INTERVAL_MS = 30 * 1000
const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const LINK_CODE_LENGTH = 10
const encoder = new TextEncoder()

type LinkGroupState = {
  deviceCount: number
  sharedCount: number
}

export type LinkDestination = 'source' | 'target'

export type LinkRealtimeResetTarget = {
  roomId: string
  deviceId: string
}

export function linkRealtimeResetTargets(
  source: Pick<DevicePrincipal, 'personId' | 'deviceId'>,
  target: Pick<DevicePrincipal, 'personId' | 'deviceId'>,
): LinkRealtimeResetTarget[] {
  return [
    { roomId: generalRoomId(source.personId), deviceId: source.deviceId },
    { roomId: generalRoomId(target.personId), deviceId: target.deviceId },
  ]
}

export class LinkCodeTooFrequentError extends Error {
  constructor() {
    super('Espera antes de generar otro código')
    this.name = 'LinkCodeTooFrequentError'
  }
}

export class InvalidLinkCodeError extends Error {
  constructor() {
    super('Código inválido o vencido')
    this.name = 'InvalidLinkCodeError'
  }
}

export class DeviceMergeNotSafeError extends Error {
  constructor() {
    super('Ambos dispositivos ya pertenecen a grupos con actividad; desvincula uno antes de unirlos')
    this.name = 'DeviceMergeNotSafeError'
  }
}

function randomCode() {
  const bytes = new Uint8Array(LINK_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ''
  for (const byte of bytes) code += LINK_ALPHABET[byte % LINK_ALPHABET.length]
  return code
}

export function normalizeLinkCode(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.toUpperCase().replace(/[\s-]/g, '')
  return new RegExp(`^[${LINK_ALPHABET}]{${LINK_CODE_LENGTH}}$`).test(normalized) ? normalized : null
}

export function formatLinkCode(code: string) {
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

async function hashCode(code: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(code))
  const bytes = new Uint8Array(digest)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function isMovableStandaloneGroup(state: LinkGroupState) {
  return state.deviceCount === 1 && state.sharedCount === 0
}

export function selectLinkDestination(
  sourceState: LinkGroupState,
  targetState: LinkGroupState,
): LinkDestination | null {
  const sourceStandalone = isMovableStandaloneGroup(sourceState)
  const targetStandalone = isMovableStandaloneGroup(targetState)

  if (!sourceStandalone && targetStandalone) return 'source'
  if (sourceStandalone && !targetStandalone) return 'target'
  if (sourceStandalone && targetStandalone) return 'source'
  return null
}

async function readGroupState(database: D1DatabaseLike, personId: string): Promise<LinkGroupState> {
  const state = await database
    .prepare(`SELECT
      (SELECT COUNT(*) FROM devices WHERE person_id = ?1 AND revoked_at IS NULL) AS device_count,
      (SELECT COUNT(*)
        FROM room_memberships m
        JOIN rooms r ON r.id = m.room_id
        WHERE m.person_id = ?1 AND r.kind = 'shared' AND r.closed_at IS NULL) AS shared_count`)
    .bind(personId)
    .first<{ device_count: number; shared_count: number }>()

  return {
    deviceCount: Number(state?.device_count ?? 0),
    sharedCount: Number(state?.shared_count ?? 0),
  }
}

async function moveSingleDeviceBetweenGroups(
  database: D1DatabaseLike,
  input: {
    deviceId: string
    fromPersonId: string
    toPersonId: string
    consumedCodeHash: string
  },
) {
  await database.batch([
    database
      .prepare('UPDATE devices SET person_id = ?1 WHERE id = ?2 AND person_id = ?3 AND revoked_at IS NULL')
      .bind(input.toPersonId, input.deviceId, input.fromPersonId),
    database
      .prepare("DELETE FROM rooms WHERE owner_person_id = ?1 AND kind = 'general'")
      .bind(input.fromPersonId),
    database
      .prepare(`DELETE FROM persons
        WHERE id = ?1
          AND NOT EXISTS (SELECT 1 FROM devices WHERE person_id = ?1)
          AND NOT EXISTS (SELECT 1 FROM rooms WHERE owner_person_id = ?1)
          AND NOT EXISTS (SELECT 1 FROM room_memberships WHERE person_id = ?1)`)
      .bind(input.fromPersonId),
    database
      .prepare('DELETE FROM device_link_codes WHERE code_hash = ?1 OR source_device_id = ?2')
      .bind(input.consumedCodeHash, input.deviceId),
  ])
}

export async function createDeviceLinkCode(
  database: D1DatabaseLike,
  principal: DevicePrincipal,
  now: number,
) {
  const existing = await database
    .prepare('SELECT created_at FROM device_link_codes WHERE source_device_id = ?1 LIMIT 1')
    .bind(principal.deviceId)
    .first<{ created_at: number }>()

  if (existing && now - existing.created_at < MIN_REGENERATE_INTERVAL_MS) {
    throw new LinkCodeTooFrequentError()
  }

  const code = randomCode()
  const codeHash = await hashCode(code)
  const expiresAt = now + LINK_TTL_MS

  await database
    .prepare(`INSERT INTO device_link_codes
      (source_device_id, source_person_id, code_hash, created_at, expires_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(source_device_id) DO UPDATE SET
        source_person_id = excluded.source_person_id,
        code_hash = excluded.code_hash,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at`)
    .bind(principal.deviceId, principal.personId, codeHash, now, expiresAt)
    .run()

  return { code: formatLinkCode(code), expiresAt }
}

export async function consumeDeviceLinkCode(
  database: D1DatabaseLike,
  target: DevicePrincipal,
  normalizedCode: string,
  now: number,
) {
  const codeHash = await hashCode(normalizedCode)
  const link = await database
    .prepare(`SELECT source_device_id, source_person_id, expires_at
      FROM device_link_codes
      WHERE code_hash = ?1 AND expires_at >= ?2
      LIMIT 1`)
    .bind(codeHash, now)
    .first<{ source_device_id: string; source_person_id: string; expires_at: number }>()

  if (!link || link.source_device_id === target.deviceId) throw new InvalidLinkCodeError()

  const currentSource = await database
    .prepare(`SELECT person_id
      FROM devices
      WHERE id = ?1 AND person_id = ?2 AND revoked_at IS NULL
      LIMIT 1`)
    .bind(link.source_device_id, link.source_person_id)
    .first<{ person_id: string }>()

  if (!currentSource) {
    await database
      .prepare('DELETE FROM device_link_codes WHERE code_hash = ?1')
      .bind(codeHash)
      .run()
    throw new InvalidLinkCodeError()
  }

  const realtimeResetTargets = linkRealtimeResetTargets(
    { personId: link.source_person_id, deviceId: link.source_device_id },
    { personId: target.personId, deviceId: target.deviceId },
  )

  if (link.source_person_id === target.personId) {
    await database
      .prepare('DELETE FROM device_link_codes WHERE code_hash = ?1')
      .bind(codeHash)
      .run()
    return { personId: target.personId, alreadyLinked: true, realtimeResetTargets }
  }

  const [sourceState, targetState] = await Promise.all([
    readGroupState(database, link.source_person_id),
    readGroupState(database, target.personId),
  ])
  const destination = selectLinkDestination(sourceState, targetState)
  if (!destination) throw new DeviceMergeNotSafeError()

  if (destination === 'source') {
    await moveSingleDeviceBetweenGroups(database, {
      deviceId: target.deviceId,
      fromPersonId: target.personId,
      toPersonId: link.source_person_id,
      consumedCodeHash: codeHash,
    })
    return { personId: link.source_person_id, alreadyLinked: false, realtimeResetTargets }
  }

  await moveSingleDeviceBetweenGroups(database, {
    deviceId: link.source_device_id,
    fromPersonId: link.source_person_id,
    toPersonId: target.personId,
    consumedCodeHash: codeHash,
  })
  return { personId: target.personId, alreadyLinked: false, realtimeResetTargets }
}
