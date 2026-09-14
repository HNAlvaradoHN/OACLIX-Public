import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { OACLIX_BUILD_VERSION } from '../src/pwa/appVersion.ts'

test('versión visible, versión publicada y service worker permanecen sincronizados', () => {
  const published = JSON.parse(readFileSync(new URL('../public/version.json', import.meta.url), 'utf8')) as { version?: string }
  const serviceWorker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  const updater = readFileSync(new URL('../src/pwa/registerServiceWorker.ts', import.meta.url), 'utf8')

  assert.match(OACLIX_BUILD_VERSION, /^v\d+$/)
  assert.equal(published.version, OACLIX_BUILD_VERSION)
  assert.match(serviceWorker, new RegExp(`oaclix-shell-${OACLIX_BUILD_VERSION}`))
  assert.match(serviceWorker, /url\.pathname === '\/version\.json'/)
  assert.match(main, /<BuildVersionBadge \/>/)
  assert.match(updater, /payload\.version !== OACLIX_BUILD_VERSION/)
})

test('el activador espera al worker nuevo y permite reintentar si aún no está listo', () => {
  const updater = readFileSync(new URL('../src/pwa/registerServiceWorker.ts', import.meta.url), 'utf8')
  const updatePrompt = readFileSync(new URL('../src/components/UpdatePrompt.tsx', import.meta.url), 'utf8')

  assert.match(updater, /waitForInstalledWorker/)
  assert.match(updater, /registration\.installing/)
  assert.match(updater, /worker\.postMessage\(\{ type: 'SKIP_WAITING' \}\)/)
  assert.match(updater, /La actualización todavía no está lista/)
  assert.match(updatePrompt, /setFailed\(true\)/)
  assert.match(updatePrompt, /Reintentar/)
})
