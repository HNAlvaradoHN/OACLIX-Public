import assert from 'node:assert/strict'
import test from 'node:test'
import { clipboardRouteLabel } from '../src/realtime/routePolicy.ts'

test('route label prioritizes a validated direct path over cloud', () => {
  assert.equal(clipboardRouteLabel(true, true), 'Directo local')
})

test('route label uses cloud only when direct is unavailable', () => {
  assert.equal(clipboardRouteLabel(false, true), 'Nube')
})

test('route label reports disconnected when no transport is usable', () => {
  assert.equal(clipboardRouteLabel(false, false), 'Desconectado')
})
