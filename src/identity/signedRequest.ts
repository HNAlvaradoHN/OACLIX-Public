import { signDeviceAction } from './deviceIdentity'

type SignedRequestOptions = {
  timeoutMs?: number
}

export async function postSigned<TPayload, TResult>(
  path: string,
  action: string,
  payload: TPayload,
  options: SignedRequestOptions = {},
) {
  const envelope = await signDeviceAction(action, payload)
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 0
  const timeout = timeoutMs > 0
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null

  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    })

    const data = await response.json().catch(() => ({})) as TResult & { error?: string }
    if (!response.ok) throw new Error(data.error || `Solicitud rechazada (${response.status})`)
    return data
  } catch (error) {
    if (controller.signal.aborted) throw new Error('La conexión tardó demasiado en responder')
    throw error
  } finally {
    if (timeout != null) window.clearTimeout(timeout)
  }
}
