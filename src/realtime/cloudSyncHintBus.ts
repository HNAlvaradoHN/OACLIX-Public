type CloudSyncHintListener = () => void

export type CloudConnectivityStatus = 'checking' | 'online' | 'offline'
type CloudConnectivityListener = (status: CloudConnectivityStatus) => void

const listenersByRoom = new Map<string, Set<CloudSyncHintListener>>()
const connectivityListenersByRoom = new Map<string, Set<CloudConnectivityListener>>()
const connectivityByRoom = new Map<string, CloudConnectivityStatus>()

export function publishCloudSyncHint(roomId: string) {
  const listeners = listenersByRoom.get(roomId)
  if (!listeners) return
  for (const listener of listeners) listener()
}

export function subscribeCloudSyncHints(roomId: string, listener: CloudSyncHintListener) {
  let listeners = listenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    listenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)

  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) listenersByRoom.delete(roomId)
  }
}

export function publishCloudConnectivity(roomId: string, status: CloudConnectivityStatus) {
  if (connectivityByRoom.get(roomId) === status) return
  connectivityByRoom.set(roomId, status)
  const listeners = connectivityListenersByRoom.get(roomId)
  if (!listeners) return
  for (const listener of listeners) listener(status)
}

export function getCloudConnectivityStatus(roomId: string): CloudConnectivityStatus {
  return connectivityByRoom.get(roomId) ?? 'checking'
}

export function subscribeCloudConnectivity(roomId: string, listener: CloudConnectivityListener) {
  let listeners = connectivityListenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    connectivityListenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)
  listener(connectivityByRoom.get(roomId) ?? 'checking')

  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) connectivityListenersByRoom.delete(roomId)
  }
}
