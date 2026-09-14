import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  clearRealtimePresence,
  getRealtimePresenceRevision,
  isRealtimePresenceKnown,
  publishRealtimePresence,
  subscribeDirectLanStatus,
} from '../src/realtime/lanStatus.ts'

const roomId = 'gen_presence_refresh_test'

test('realtime presence exposes known to unknown transitions without polling', () => {
  clearRealtimePresence(roomId)
  assert.equal(isRealtimePresenceKnown(roomId), false)

  let notifications = 0
  const unsubscribe = subscribeDirectLanStatus(() => { notifications += 1 })
  publishRealtimePresence(roomId, ['dev_abcdefghijklmnop'])
  assert.equal(isRealtimePresenceKnown(roomId), true)

  clearRealtimePresence(roomId)
  assert.equal(isRealtimePresenceKnown(roomId), false)
  assert.equal(notifications, 2)
  unsubscribe()
})

test('identical presence frames advance the revision so offline unlink can refresh roster', () => {
  clearRealtimePresence(roomId)
  const initialRevision = getRealtimePresenceRevision(roomId)
  let notifications = 0
  const unsubscribe = subscribeDirectLanStatus(() => { notifications += 1 })

  publishRealtimePresence(roomId, ['dev_abcdefghijklmnop'])
  const firstRevision = getRealtimePresenceRevision(roomId)
  publishRealtimePresence(roomId, ['dev_abcdefghijklmnop'])
  const secondRevision = getRealtimePresenceRevision(roomId)

  assert.equal(firstRevision, initialRevision + 1)
  assert.equal(secondRevision, firstRevision + 1)
  assert.equal(notifications, 2)

  unsubscribe()
  clearRealtimePresence(roomId)
})

test('LinkedPanel silently refreshes roster after realtime presence revision or session loss', async () => {
  const source = await readFile(new URL('../src/components/LinkedPanel.tsx', import.meta.url), 'utf8')
  assert.match(source, /getRealtimePresenceRevision/)
  assert.match(source, /presenceRevisionRef/)
  assert.match(source, /hasNewPresenceRevision/)
  assert.match(source, /lostKnownPresence/)
  assert.match(source, /if \(lostKnownPresence \|\| hasNewPresenceRevision\) void refreshDevicesSilently\(\)/)
  assert.match(source, /result\.personId !== identity\.personId/)
})
