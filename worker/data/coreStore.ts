export type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>
  run(): Promise<unknown>
}

export type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatementLike
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>
}

type PersistIdentityInput = {
  derivedPersonId: string
  deviceId: string
  deviceLabel: string
  publicKeyJson: string
  now: number
}

type DeviceRow = {
  person_id: string
  label: string
  last_seen_at: number
  revoked_at: number | null
}

export type DevicePrincipal = {
  personId: string
  deviceId: string
  label: string
  requiresStandaloneMigration: boolean
}

export type PersonDevice = {
  id: string
  label: string
  createdAt: number
  lastSeenAt: number
}

export type UnlinkedDevice = {
  personId: string
  generalRoomId: string
}

// D1 is not used as a presence heartbeat. A normal app open performs one
// indexed lookup and usually zero writes. We refresh last_seen only a few
// times per day so identity checks cannot consume the write quota by polling.
const LAST_SEEN_WRITE_INTERVAL_MS = 6 * 60 * 60 * 1000

export function generalRoomId(personId: string) {
  return `gen_${personId.replace(/^per_/, '')}`
}

function standaloneGroupIds() {
  const suffix = crypto.randomUUID().replace(/-/g, '')
  return {
    personId: `per_${suffix}`,
    generalRoomId: `gen_${suffix}`,
  }
}

async function moveDeviceToStandaloneGroup(
  database: D1DatabaseLike,
  currentPersonId: string,
  deviceId: string,
  now: number,
  touchLastSeen: boolean,
) {
  const standalone = standaloneGroupIds()
  const updateDevice = touchLastSeen
    ? database
      .prepare(`UPDATE devices
        SET person_id = ?1, revoked_at = NULL, last_seen_at = ?4
        WHERE id = ?2 AND person_id = ?3`)
      .bind(standalone.personId, deviceId, currentPersonId, now)
    : database
      .prepare(`UPDATE devices
        SET person_id = ?1, revoked_at = NULL
        WHERE id = ?2 AND person_id = ?3`)
      .bind(standalone.personId, deviceId, currentPersonId)

  await database.batch([
    database
      .prepare('INSERT INTO persons (id, created_at) VALUES (?1, ?2)')
      .bind(standalone.personId, now),
    database
      .prepare(`INSERT INTO rooms (id, owner_person_id, name, kind, retention_seconds, created_at, closed_at)
        VALUES (?1, ?2, 'General', 'general', 21600, ?3, NULL)`)
      .bind(standalone.generalRoomId, standalone.personId, now),
    database
      .prepare(`INSERT INTO room_memberships (room_id, person_id, role, can_clear, created_at)
        VALUES (?1, ?2, 'owner', 1, ?3)`)
      .bind(standalone.generalRoomId, standalone.personId, now),
    updateDevice,
    database
      .prepare('DELETE FROM device_link_codes WHERE source_device_id = ?1')
      .bind(deviceId),
  ])

  return standalone
}

export async function getDevicePrincipal(database: D1DatabaseLike, deviceId: string) {
  const row = await database
    .prepare('SELECT person_id, label, revoked_at FROM devices WHERE id = ?1 LIMIT 1')
    .bind(deviceId)
    .first<{ person_id: string; label: string; revoked_at: number | null }>()

  if (!row) return null
  return {
    personId: row.person_id,
    deviceId,
    label: row.label,
    // `revoked_at` existed in the already deployed schema. New code never sets it.
    // A non-null value only marks an old record that must be safely split once.
    requiresStandaloneMigration: row.revoked_at != null,
  } satisfies DevicePrincipal
}

export async function listPersonDevices(database: D1DatabaseLike, personId: string) {
  const result = await database
    .prepare(`SELECT id, label, created_at, last_seen_at
      FROM devices
      WHERE person_id = ?1 AND revoked_at IS NULL
      ORDER BY created_at ASC`)
    .bind(personId)
    .all<{ id: string; label: string; created_at: number; last_seen_at: number }>()

  return (result.results ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  } satisfies PersonDevice))
}

export async function listActivePersonRoomIds(database: D1DatabaseLike, personId: string) {
  const result = await database
    .prepare(`SELECT r.id
      FROM rooms r
      INNER JOIN room_memberships m ON m.room_id = r.id
      WHERE m.person_id = ?1 AND r.closed_at IS NULL`)
    .bind(personId)
    .all<{ id: string }>()

  return (result.results ?? []).map((row) => row.id)
}

export async function renamePersonDevice(
  database: D1DatabaseLike,
  personId: string,
  deviceId: string,
  label: string,
) {
  const target = await database
    .prepare(`SELECT id
      FROM devices
      WHERE id = ?1 AND person_id = ?2 AND revoked_at IS NULL
      LIMIT 1`)
    .bind(deviceId, personId)
    .first<{ id: string }>()

  if (!target) return false

  await database
    .prepare('UPDATE devices SET label = ?1 WHERE id = ?2 AND person_id = ?3 AND revoked_at IS NULL')
    .bind(label, deviceId, personId)
    .run()

  return true
}

export async function unlinkPersonDevice(
  database: D1DatabaseLike,
  personId: string,
  deviceId: string,
  now: number,
): Promise<UnlinkedDevice | null> {
  const target = await database
    .prepare(`SELECT id
      FROM devices
      WHERE id = ?1 AND person_id = ?2 AND revoked_at IS NULL
      LIMIT 1`)
    .bind(deviceId, personId)
    .first<{ id: string }>()

  if (!target) return null
  return moveDeviceToStandaloneGroup(database, personId, deviceId, now, false)
}

export async function persistDeviceIdentity(database: D1DatabaseLike, input: PersistIdentityInput) {
  const existing = await database
    .prepare('SELECT person_id, label, last_seen_at, revoked_at FROM devices WHERE id = ?1 LIMIT 1')
    .bind(input.deviceId)
    .first<DeviceRow>()

  if (existing?.revoked_at != null) {
    const standalone = await moveDeviceToStandaloneGroup(
      database,
      existing.person_id,
      input.deviceId,
      input.now,
      true,
    )
    return {
      personId: standalone.personId,
      deviceLabel: existing.label,
      generalRoomId: standalone.generalRoomId,
    }
  }

  if (existing) {
    if (input.now - existing.last_seen_at >= LAST_SEEN_WRITE_INTERVAL_MS) {
      await database
        .prepare('UPDATE devices SET last_seen_at = ?1 WHERE id = ?2 AND last_seen_at < ?3')
        .bind(input.now, input.deviceId, input.now - LAST_SEEN_WRITE_INTERVAL_MS)
        .run()
    }

    return {
      personId: existing.person_id,
      deviceLabel: existing.label,
      generalRoomId: generalRoomId(existing.person_id),
    }
  }

  const personId = input.derivedPersonId
  const roomId = generalRoomId(personId)

  // First registration is intentionally the only normal path that creates the base
  // person/device/General records. Reopening OACLIX does not repeat these writes.
  await database.batch([
    database
      .prepare('INSERT INTO persons (id, created_at) VALUES (?1, ?2) ON CONFLICT(id) DO NOTHING')
      .bind(personId, input.now),
    database
      .prepare(`INSERT INTO devices (id, person_id, public_key_json, label, created_at, last_seen_at, revoked_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL)`)
      .bind(input.deviceId, personId, input.publicKeyJson, input.deviceLabel, input.now),
    database
      .prepare(`INSERT INTO rooms (id, owner_person_id, name, kind, retention_seconds, created_at, closed_at)
        VALUES (?1, ?2, 'General', 'general', 21600, ?3, NULL)
        ON CONFLICT(id) DO NOTHING`)
      .bind(roomId, personId, input.now),
    database
      .prepare(`INSERT INTO room_memberships (room_id, person_id, role, can_clear, created_at)
        VALUES (?1, ?2, 'owner', 1, ?3)
        ON CONFLICT(room_id, person_id) DO NOTHING`)
      .bind(roomId, personId, input.now),
  ])

  return { personId, deviceLabel: input.deviceLabel, generalRoomId: roomId }
}
