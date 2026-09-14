export type RoomKind = 'local' | 'general' | 'shared'

export type Room = {
  id: string
  name: string
  members: number
  kind: RoomKind
  private?: boolean
  favorite?: boolean
  accent: 'violet' | 'cyan' | 'emerald' | 'rose'
}

export type PreserveTarget = 'device' | 'devices' | 'cloud'

export type ClipboardItem = {
  id: string
  type: 'text' | 'image'
  author: string
  text?: string
  imageLabel?: string
  imageUrl?: string
  imageMimeType?: string
  imageByteSize?: number
  ownedByMe?: boolean
  preserveTarget?: PreserveTarget
}

export type LinkedPerson = {
  id: string
  name: string
  me?: boolean
  canClear?: boolean
  devices: { id: string; name: string; online: boolean; local?: boolean }[]
}
