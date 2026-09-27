import { BALCONY, DANCE_FLOOR, FIRE_PIT, FLOOR, LOFT, MEETING_ROOM, ROOF_BAR, ROOF_TABLES, SEATING_BY_ID, STAGE, seatAt } from '../../shared/layout';
import type { PeerInfo } from '../../shared/protocol';
import { ROOF } from '../../shared/rooftop';

/**
 * What a teammate is up to, for the line under their name tag and in the sidebar: whatever they have
 * open ("💻 in Pixel's terminal", "🔀 reading PR #12"), else somewhere worth saying they are ("🌇 on
 * the balcony", "🛋️ on the couch"). Nothing while they're just walking around the office.
 */
export function whereabouts(p: PeerInfo): string | undefined {
  if (p.doing) return p.doing;
  if (p.smoking) return '🚬 on a smoke break';
  const place = p.seat ? seatAt(p.seat) : undefined;
  const seat = place && SEATING_BY_ID.get(place.seatId);
  if (seat) {
    // "🛋️ Couch" -> "🛋️ on the couch".
    const [icon, ...name] = seat.label.split(' ');
    return `${icon} ${seat.game ? 'in' : 'on'} the ${name.join(' ').toLowerCase()}`;
  }
  // The roof is the office's size, but none of its rooms are up there.
  if (p.floor === ROOF) return onTheRoof(p);
  // Down on the street, or out the back door on the stairs down to it.
  if (p.y < -1 || p.x < FLOOR.minX || p.x > FLOOR.maxX || p.z < FLOOR.minZ) return '🚶 outside';
  if (p.z > FLOOR.maxZ) return p.x >= BALCONY.minX && p.x <= BALCONY.maxX ? '🌇 on the balcony' : '🚶 outside';
  if (p.y > LOFT.y - 0.5 && p.x > LOFT.minX && p.z > LOFT.minZ) return "👔 in the boss's office";
  if (p.x > MEETING_ROOM.minX && p.z > MEETING_ROOM.minZ) return '🤝 in the meeting room';
  return undefined;
}

/** Somewhere on the rooftop bar worth saying they are, standing up. */
function onTheRoof(p: PeerInfo): string | undefined {
  if (p.x > STAGE.minX && p.x < STAGE.maxX && p.z < STAGE.maxZ) return '🎧 up on the stage';
  if (p.x > DANCE_FLOOR.minX && p.x < DANCE_FLOOR.maxX && p.z > DANCE_FLOOR.minZ && p.z < DANCE_FLOOR.maxZ) return '🪩 on the dance floor';
  if (p.x > ROOF_BAR.x - 2.5 && p.z > ROOF_BAR.minZ - 0.5 && p.z < ROOF_BAR.maxZ + 0.5) return '🍸 at the bar';
  if (ROOF_TABLES.some((t) => Math.hypot(p.x - t.x, p.z - t.z) < 1.3)) return '🕯️ at a tall table';
  if (Math.hypot(p.x - FIRE_PIT.x, p.z - FIRE_PIT.z) < 3.5) return '🔥 by the fire';
  return undefined;
}
