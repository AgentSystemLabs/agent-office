// The office: the room every floor of the building is (see build.ts), and the pieces of it other maps
// and the lab reuse. The world's shared types live in ../types.ts; they're re-exported here for the
// modules that take them from the office.
export { buildOffice } from './build';
export { DESK_BOOKS, FLOOR_PLANTS, coffeeTable, deskBooks, deskMug, loungeCouch, plant, plantLeaves, pouf, type PlantSpecies } from './props';
export { buildDesk, vacancyMarker } from './seats';
export type { WingView } from './wing';
export type { Collider, DeskView, InteractKind, Interactable, Office } from '../types';
