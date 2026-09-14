import type { Room } from '../types'
import { Icon } from './Icon'

export function GeneralCard({ room, onOpen }: { room: Room; onOpen: (room: Room) => void }) {
  const local = room.kind === 'local'
  const shared = room.kind === 'shared'
  const eyebrow = local ? 'Tu espacio local' : shared ? 'Tu sala predeterminada' : 'Tu espacio privado'
  const detail = local
    ? 'Solo este dispositivo · Predeterminada'
    : shared
      ? `${room.members} participantes · Predeterminada`
      : 'Tus dispositivos · Predeterminada'

  return (
    <button className="general-card" type="button" onClick={() => onOpen(room)}>
      <span className="general-card__glow" aria-hidden="true" />
      <span className="general-card__icon"><Icon name={local ? 'clipboard' : room.private ? 'lock' : 'users'} /></span>
      <span className="general-card__content">
        <span className="eyebrow">{eyebrow}</span>
        <strong>{room.name}</strong>
        <small>{detail}</small>
      </span>
      <span className="general-card__status"><span className="status-dot" /> Lista</span>
      <span className="general-card__arrow"><Icon name="chevron-right" /></span>
    </button>
  )
}
