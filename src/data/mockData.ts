import type { ClipboardItem, LinkedPerson, Room } from '../types'

export const rooms: Room[] = [
  { id: 'local', name: 'Mi portapapeles', members: 1, private: true, kind: 'local', accent: 'violet' },
  { id: 'general', name: 'General', members: 1, private: true, kind: 'general', accent: 'cyan' },
  { id: 'studio', name: 'Studio', members: 4, kind: 'shared', accent: 'cyan' },
  { id: 'equipo', name: 'Equipo', members: 7, kind: 'shared', accent: 'emerald' },
  { id: 'ideas', name: 'Ideas', members: 3, kind: 'shared', accent: 'rose' },
]

export const clipboardItems: ClipboardItem[] = [
  {
    id: 'c1',
    type: 'text',
    author: 'Ing.',
    text: 'Diseñar rápido, cambiar sin romper nada y mantener el portapapeles como protagonista.',
    ownedByMe: true,
  },
  {
    id: 'c2',
    type: 'image',
    author: 'Laptop',
    imageLabel: 'Concepto visual · 1440 × 900',
    ownedByMe: true,
  },
  {
    id: 'c3',
    type: 'text',
    author: 'Teléfono',
    text: 'https://example.com/oaclix-demo/gradient-motion',
    ownedByMe: true,
  },
]

export const linkedPeople: LinkedPerson[] = [
  {
    id: 'me',
    name: 'Ing.',
    me: true,
    devices: [
      { id: 'phone', name: 'Pixel · Android', online: true, local: true },
      { id: 'pc', name: 'PC · Windows', online: true, local: true },
      { id: 'tablet', name: 'Tablet', online: false },
    ],
  },
  {
    id: 'ana',
    name: 'Ana',
    canClear: false,
    devices: [
      { id: 'ana-phone', name: 'Galaxy', online: true },
      { id: 'ana-pc', name: 'Portátil', online: false },
    ],
  },
]
