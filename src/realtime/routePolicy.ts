export type ClipboardRouteLabel = 'Directo local' | 'Nube' | 'Desconectado'

export function clipboardRouteLabel(directAvailable: boolean, cloudConnected: boolean): ClipboardRouteLabel {
  if (directAvailable) return 'Directo local'
  if (cloudConnected) return 'Nube'
  return 'Desconectado'
}
