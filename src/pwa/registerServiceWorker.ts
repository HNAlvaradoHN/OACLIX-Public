import { OACLIX_BUILD_VERSION } from './appVersion'

const UPDATE_EVENT = 'oaclix:update-available'
const VERSION_URL = '/version.json'
const UPDATE_READY_TIMEOUT_MS = 15_000
let refreshing = false

function announceUpdate() {
  window.dispatchEvent(new Event(UPDATE_EVENT))
}

async function checkPublishedVersion() {
  const url = new URL(VERSION_URL, window.location.origin)
  url.searchParams.set('t', String(Date.now()))
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) return
  const payload = await response.json() as { version?: unknown }
  if (typeof payload.version === 'string' && payload.version !== OACLIX_BUILD_VERSION) {
    announceUpdate()
  }
}

function waitForInstalledWorker(worker: ServiceWorker) {
  if (worker.state === 'installed') return Promise.resolve()
  if (worker.state === 'redundant') return Promise.reject(new Error('La actualización dejó de estar disponible'))

  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      worker.removeEventListener('statechange', handleStateChange)
      reject(new Error('La actualización tardó demasiado en prepararse'))
    }, UPDATE_READY_TIMEOUT_MS)

    const finish = (error?: Error) => {
      window.clearTimeout(timeoutId)
      worker.removeEventListener('statechange', handleStateChange)
      if (error) reject(error)
      else resolve()
    }

    const handleStateChange = () => {
      if (worker.state === 'installed') finish()
      else if (worker.state === 'redundant') finish(new Error('La actualización dejó de estar disponible'))
    }

    worker.addEventListener('statechange', handleStateChange)
  })
}

export function registerServiceWorker() {
  const checkVersionWhenVisible = () => {
    if (document.visibilityState === 'visible') void checkPublishedVersion().catch(() => undefined)
  }
  window.addEventListener('load', checkVersionWhenVisible)
  document.addEventListener('visibilitychange', checkVersionWhenVisible)

  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js')

      if (registration.waiting && navigator.serviceWorker.controller) announceUpdate()

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        if (!worker) return

        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) announceUpdate()
        })
      })

      const checkForUpdate = () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => undefined)
      }

      document.addEventListener('visibilitychange', checkForUpdate)
    } catch {
      // La PWA sigue funcionando en línea aunque el registro no esté disponible.
    }
  })
}

export async function activateWaitingServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    window.location.reload()
    return
  }

  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) {
    window.location.reload()
    return
  }

  let worker = registration.waiting
  if (!worker) {
    await registration.update()
    worker = registration.waiting
  }

  if (!worker) {
    const installing = registration.installing
    if (!installing) throw new Error('La actualización todavía no está lista')
    await waitForInstalledWorker(installing)
    worker = registration.waiting ?? (installing.state === 'installed' ? installing : null)
  }

  if (!worker) throw new Error('No se pudo preparar la actualización')
  worker.postMessage({ type: 'SKIP_WAITING' })
}

export const serviceWorkerUpdateEvent = UPDATE_EVENT
