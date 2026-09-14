import assert from 'node:assert/strict'
import test from 'node:test'
import {
  persistDeviceIdentity,
  renamePersonDevice,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
} from '../worker/data/coreStore.ts'

type DeviceRow = {
  id: string
  personId: string
  label: string
  lastSeenAt: number
  revokedAt: number | null
}

class DeviceStatement implements D1PreparedStatementLike {
  private values: unknown[] = []
  private readonly database: DeviceDatabase
  private readonly query: string

  constructor(database: DeviceDatabase, query: string) {
    this.database = database
    this.query = query
  }

  bind(...values: unknown[]) {
    this.values = values
    return this
  }

  async first<T>() {
    if (this.query.includes('SELECT id') && this.query.includes('FROM devices')) {
      const [deviceId, personId] = this.values as [string, string]
      const row = this.database.device
      const result = row.id === deviceId && row.personId === personId && row.revokedAt == null
        ? { id: row.id }
        : null
      return result as T | null
    }

    if (this.query.includes('SELECT person_id, label, last_seen_at, revoked_at FROM devices')) {
      const [deviceId] = this.values as [string]
      const row = this.database.device
      const result = row.id === deviceId
        ? {
            person_id: row.personId,
            label: row.label,
            last_seen_at: row.lastSeenAt,
            revoked_at: row.revokedAt,
          }
        : null
      return result as T | null
    }

    throw new Error(`Consulta first() inesperada: ${this.query}`)
  }

  async all<T>() {
    return { results: [] as T[] }
  }

  async run() {
    if (this.query.includes('UPDATE devices SET label = ?1')) {
      const [label, deviceId, personId] = this.values as [string, string, string]
      const row = this.database.device
      if (row.id === deviceId && row.personId === personId && row.revokedAt == null) row.label = label
      return undefined
    }

    if (this.query.includes('UPDATE devices SET last_seen_at')) {
      const [lastSeenAt, deviceId] = this.values as [number, string]
      if (this.database.device.id === deviceId) this.database.device.lastSeenAt = lastSeenAt
      return undefined
    }

    throw new Error(`Consulta run() inesperada: ${this.query}`)
  }
}

class DeviceDatabase implements D1DatabaseLike {
  readonly device: DeviceRow

  constructor(device: DeviceRow) {
    this.device = device
  }

  prepare(query: string) {
    return new DeviceStatement(this, query)
  }

  async batch(_statements: D1PreparedStatementLike[]) {
    throw new Error('No debe crear identidad nueva en este escenario')
  }
}

const deviceId = 'dev_abcdefghijklmnop'
const personId = 'per_abcdefghijklmnop'

function database() {
  return new DeviceDatabase({
    id: deviceId,
    personId,
    label: 'Este dispositivo',
    lastSeenAt: 1_000_000,
    revokedAt: null,
  })
}

test('nombre renombrado sobrevive a un bootstrap que vuelve a enviar la etiqueta por defecto', async () => {
  const db = database()

  assert.equal(await renamePersonDevice(db, personId, deviceId, 'Mi celular'), true)
  assert.equal(db.device.label, 'Mi celular')

  const reopened = await persistDeviceIdentity(db, {
    derivedPersonId: personId,
    deviceId,
    deviceLabel: 'Este dispositivo',
    publicKeyJson: '{}',
    now: db.device.lastSeenAt + 1_000,
  })

  assert.equal(reopened.deviceLabel, 'Mi celular')
  assert.equal(db.device.label, 'Mi celular')
})

test('otra persona no puede renombrar el dispositivo', async () => {
  const db = database()

  assert.equal(await renamePersonDevice(db, 'per_otrapersona12345', deviceId, 'Intruso'), false)
  assert.equal(db.device.label, 'Este dispositivo')
})

test('un dispositivo revocado no puede renombrarse', async () => {
  const db = database()
  db.device.revokedAt = 2_000_000

  assert.equal(await renamePersonDevice(db, personId, deviceId, 'Revive'), false)
  assert.equal(db.device.label, 'Este dispositivo')
})
