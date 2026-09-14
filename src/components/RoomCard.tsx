import type { Room } from '../types'
import { Icon } from './Icon'

export function RoomCard({ room, onOpen }: { room: Room; onOpen: (room: Room) => void }) {
  const local = room.kind === 'local'
  const detail = local
    ? 'Solo este dispositivo'
    : room.kind === 'general'
      ? 'Tus dispositivos'
      : `${room.members} participantes`

  return (
    <button className={`room-card room-card--${room.accent}`} type="button" onClick={() => onOpen(room)}>
      <span className="room-card__glow" aria-hidden="true" />
      <span className="room-card__topline">
        <span className="room-card__icon" style={{ transform: 'translateY(-6px)' }}><Icon name={local ? 'clipboard' : room.private ? 'lock' : 'users'} /></span>
      </span>
      <span className="room-card__content">
        <strong>{room.name}</strong>
        <span>{detail}</span>
      </span>
      <span className="room-card__arrow"><Icon name="chevron-right" /></span>
    </button>
  )
}
