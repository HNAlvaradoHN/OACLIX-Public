const STORAGE_KEY = 'oaclix-default-room'
export const LOCAL_CLIPBOARD_ROOM_ID = 'local'

export function resolveDefaultRoomId(savedRoomId: string | null, availableRoomIds: Iterable<string>) {
  const available = new Set(availableRoomIds)
  if (savedRoomId && available.has(savedRoomId)) return savedRoomId
  if (available.has(LOCAL_CLIPBOARD_ROOM_ID)) return LOCAL_CLIPBOARD_ROOM_ID
  return available.values().next().value ?? LOCAL_CLIPBOARD_ROOM_ID
}

export function readDefaultRoomId(availableRoomIds: Iterable<string>) {
  let savedRoomId: string | null = null
  try {
    savedRoomId = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Una preferencia no debe bloquear el uso local si el navegador restringe localStorage.
  }
  return resolveDefaultRoomId(savedRoomId, availableRoomIds)
}

export function saveDefaultRoomId(roomId: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, roomId)
  } catch {
    // La selección sigue vigente durante la sesión aunque no pueda persistirse.
  }
}
