import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanupExpiredClipboardData } from '../worker/data/clipboardCleanup.ts'
import type { D1DatabaseLike, D1PreparedStatementLike } from '../worker/data/coreStore.ts'

type CapturedStatement = {
  query: string
  values: unknown[]
}

class FakeStatement implements D1PreparedStatementLike {
  readonly captured: CapturedStatement

  constructor(query: string) {
    this.captured = { query, values: [] }
  }

  bind(...values: unknown[]) {
    this.captured.values = values
    return this
  }

  async first<T>() {
    return null as T | null
  }

  async all<T>() {
    return { results: [] as T[] }
  }

  async run() {
    return undefined
  }
}

class FakeDatabase implements D1DatabaseLike {
  readonly prepared: FakeStatement[] = []
  batched: FakeStatement[] = []

  prepare(query: string) {
    const statement = new FakeStatement(query)
    this.prepared.push(statement)
    return statement
  }

  async batch(statements: D1PreparedStatementLike[]) {
    this.batched = statements as FakeStatement[]
    return statements.map(() => undefined)
  }
}

const HOUR = 60 * 60 * 1000

test('limpieza usa dos pasadas acotadas con retención de cambios una hora mayor', async () => {
  const database = new FakeDatabase()
  const now = 10 * HOUR

  await cleanupExpiredClipboardData(database, now)

  assert.equal(database.prepared.length, 4)
  assert.equal(database.batched.length, 4)

  const itemStatements = database.prepared.filter((statement) => statement.captured.query.includes('clipboard_items'))
  const changeStatements = database.prepared.filter((statement) => statement.captured.query.includes('clipboard_changes'))

  assert.equal(itemStatements.length, 2)
  assert.equal(changeStatements.length, 2)

  for (const statement of itemStatements) {
    assert.match(statement.captured.query, /expires_at <= \?1/)
    assert.match(statement.captured.query, /LIMIT \?2/)
    assert.deepEqual(statement.captured.values, [now, 128])
  }

  for (const statement of changeStatements) {
    assert.match(statement.captured.query, /changed_at <= \?1/)
    assert.match(statement.captured.query, /LIMIT \?2/)
    assert.deepEqual(statement.captured.values, [now - 7 * HOUR, 256])
  }
})

test('limpieza delega todas las eliminaciones en un único batch D1', async () => {
  const database = new FakeDatabase()

  await cleanupExpiredClipboardData(database, 20 * HOUR)

  assert.deepEqual(database.batched, database.prepared)
  assert.equal(database.batched.every((statement) => /^DELETE FROM clipboard_(items|changes)/.test(statement.captured.query.trim())), true)
})
