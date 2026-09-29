import type { MapConfig, PropConfig } from './types.js';

/*
 * The castle: a long, high hall with tables down both sides where the workers sit, and at the far
 * end, up on a dais, a throne of iron blades where you sit. Workers waiting on you (done, or stuck
 * on a question) come and line up in front of it. The Hand of the King stands at your left, and
 * speaking to him sends a new worker off to a free seat at the tables. The boards hang on the side
 * walls, each with a scribe at a lectern below it.
 *
 * This is all data: moving something is changing a number here, or (without touching the code)
 * a map of your own that `extends: 'castle'` in the office's .agent-office/maps/ (docs/maps.md).
 *
 * The hall runs north (-z, the throne) to south (+z, the doors); x is across it, west (-x) to east.
 */

const W = 26;
const L = 60;
/** The pillars down each side, every 6 m, and the bays between them where the boards and windows go. */
const PILLAR_X = 10.4;
const PILLARS_Z = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
const BAYS_Z = [-21, -15, -9, -3, 3, 9, 15, 21];
/** Just off the inside of each side wall. */
const WALL_X = W / 2 - 0.08;
/** Where the hearth is on the west wall. */
const HEARTH_Z = 15;

const props: PropConfig[] = [
  // Pillars down both sides, a torch on every other one, banners on the rest.
  ...PILLARS_Z.flatMap((z) => [-1, 1].map((side) => ({ kind: 'pillar', x: side * PILLAR_X, z }))),
  ...[-24, -12, 0, 12, 24].flatMap((z) =>
    [-1, 1].map((side) => ({ kind: 'torch', x: side * (PILLAR_X - 0.68), z, y: 2.7, rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2, light: z === -12 || z === 12 })),
  ),
  ...[-18, -6, 6, 18].flatMap((z) =>
    [-1, 1].map((side) => ({ kind: 'banner', x: side * (PILLAR_X - 0.67), z, y: 11.2, width: 1.25, height: 5, rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2 })),
  ),
  // Tall stained glass high up in every bay, and a rose window over the throne and over the doors.
  // (Not over the hearth, whose chimney goes up the west wall there.)
  ...BAYS_Z.flatMap((z) => [-1, 1].filter((side) => !(side < 0 && z === HEARTH_Z)).map((side) => ({ kind: 'window', x: side * WALL_X, z, y: 6.4, width: 2.3, height: 5.2, rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2 }))),
  { kind: 'rose', x: 0, z: -L / 2 + 0.08, y: 10.4, width: 4.6, rotY: 0 },
  { kind: 'rose', x: 0, z: L / 2 - 0.08, y: 10.3, width: 4.2, rotY: Math.PI },
  // The great banner behind the throne.
  { kind: 'banner', x: 0, z: -L / 2 + 0.1, y: 7.7, width: 3.4, height: 6, rotY: 0 },
  // Shields and crossed swords in the bays that have no board.
  ...[-21, -9, 9, 21].flatMap((z) => [-1, 1].map((side) => ({ kind: 'shield', x: side * WALL_X, z, y: 3.6, rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2 }))),
  // The red carpet from the doors to the foot of the dais.
  { kind: 'carpet', x: 0, z: 3.35, width: 3.6, length: 52.5 },
  // Fire: braziers by the dais steps and down by the doors, the hearth, candles by the throne.
  { kind: 'brazier', x: -3.7, z: -21.4, light: true },
  { kind: 'brazier', x: 3.7, z: -21.4, light: true },
  { kind: 'brazier', x: -3.7, z: 17 },
  { kind: 'brazier', x: 3.7, z: 17 },
  { kind: 'hearth', x: -W / 2 + 0.55, z: HEARTH_Z, rotY: Math.PI / 2, light: true },
  { kind: 'candles', x: -2.1, z: -28.9 },
  { kind: 'candles', x: 2.1, z: -28.9 },
  // Chandeliers down the middle.
  ...[-15, -3, 9, 21].map((z) => ({ kind: 'chandelier', x: 0, z, y: 9.2 })),
  // Stone knights either side of the throne, and armour by the doors.
  { kind: 'statue', x: -5, z: -28.6 },
  { kind: 'statue', x: 5, z: -28.6 },
  { kind: 'armor', x: -4.2, z: 28.4, rotY: Math.PI },
  { kind: 'armor', x: 4.2, z: 28.4, rotY: Math.PI },
  { kind: 'armor', x: -12.1, z: 24.5, rotY: Math.PI / 2 },
  { kind: 'armor', x: 12.1, z: 24.5, rotY: -Math.PI / 2 },
  // The merge gong, west of the dais; ale on the east wall.
  { kind: 'gong', x: -7.6, z: -19.6, rotY: Math.PI / 2 },
  { kind: 'cask', x: W / 2 - 0.65, z: 15, rotY: -Math.PI / 2 },
];

export const CASTLE: MapConfig = {
  id: 'castle',
  name: 'Castle',
  icon: '🏰',
  description: 'A great hall with a throne of iron blades. Workers sit at the long tables, line up before your throne when they’re done or need you, and grow long grey beards the longer they work. Speak to the Hand of the King to send out a new one.',
  style: 'castle',
  hall: { width: W, length: L, height: 13 },
  spawn: { x: -2.6, z: -21, rotY: Math.PI },
  door: { x: 0, z: L / 2 - 1.4 },
  throne: { x: 0, z: -27.4, rotY: 0, dais: { width: 12, depth: 5, height: 0.9, steps: 3 } },
  herald: { x: 3.3, z: -26.3, rotY: -0.35, name: 'Hand of the King', says: 'Speak to me to send out a new worker', ask: 'What shall they toil on, my liege?', button: 'Send them out ⚔️' },
  lineup: { x: 0, z: -25.6, rotY: Math.PI, step: [0, 1.3], count: 8 },
  tables: [
    { name: 'North-west table', x: -6.8, z: -8, length: 10, seats: 4 },
    { name: 'North-east table', x: 6.8, z: -8, length: 10, seats: 4 },
    { name: 'South-west table', x: -6.8, z: 6, length: 10, seats: 4 },
    { name: 'South-east table', x: 6.8, z: 6, length: 10, seats: 4 },
  ],
  stations: {
    issues: { x: -11.3, z: -15, rotY: -Math.PI / 2 },
    queue: { x: -11.3, z: -3, rotY: -Math.PI / 2 },
    pulls: { x: 11.3, z: -15, rotY: Math.PI / 2 },
  },
  council: { x: 7.2, z: -18.8, rotY: 0 },
  boards: {
    issues: { x: -WALL_X, y: 3.5, z: -15, rotY: Math.PI / 2, width: 4.4, height: 2.6, label: '📜 Petitions' },
    queue: { x: -WALL_X, y: 3.5, z: -3, rotY: Math.PI / 2, width: 4.4, height: 2.6, label: '📋 Orders of the day' },
    pulls: { x: WALL_X, y: 3.5, z: -15, rotY: -Math.PI / 2, width: 4.4, height: 2.6, label: '🔀 Decrees for the seal' },
    services: { x: WALL_X, y: 3.5, z: -3, rotY: -Math.PI / 2, width: 4.4, height: 2.6, label: '🌐 Services' },
  },
  props,
  agents: { outfit: 'peasant', ageMinutes: 30 },
  palette: { stone: '#8c847a', floor: '#6f685f', carpet: '#8e1b1b', wood: '#6b4526', trim: '#d9ab2e' },
};
