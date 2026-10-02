import { DESKS, deskSeat, type SeatDef } from './layout.js';
import { OFFICE_PLAN, type MapPlan } from './maps/index.js';
import type { FloorInfo } from './protocol.js';

/** A permanent public space in this building, independent of its project checkouts. */
export const LOBBY = '@lobby';
export const LOBBY_NAME = 'Public Lobby';
export const LOBBY_DESCRIPTION = 'Ground floor · shared coworking space';

export const LOBBY_SEATING: SeatDef[] = DESKS.map((d) => ({
  id: `cowork-${d.id}`, label: '🪑 Coworking desk', ...deskSeat(d, 0.93),
  y: 0, rotY: d.rotY + Math.PI, places: [0], hips: 0.5, depth: 0, out: -0.8,
}));

/** The lobby always uses the office layout, even when projects use another map. */
export const LOBBY_PLAN: MapPlan = {
  ...OFFICE_PLAN, name: LOBBY_NAME, description: LOBBY_DESCRIPTION,
  stations: [], meeting: [],
  seating: [...OFFICE_PLAN.seating, ...LOBBY_SEATING],
  seatingById: new Map([...OFFICE_PLAN.seating, ...LOBBY_SEATING].map((s) => [s.id, s])),
};

export function lobbyInfo(people: number): FloorInfo {
  return { id: LOBBY, name: LOBBY_NAME, kind: 'lobby', dir: '', palette: 1,
    addedBy: 'the office', addedAt: 0, workers: 0, busy: 0, waiting: 0, people, wing: 0 };
}

/** Directory labels: the lobby is G, projects start at 1. */
export const floorNumber = (floor: FloorInfo, index: number): string => floor.id === LOBBY ? 'G' : String(index);
