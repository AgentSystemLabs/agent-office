import type { MapConfig, PropConfig } from './types.js';

/*
 * Night City Plaza: a neon cyberpunk concourse. A rain-slick street runs the length of the map, lined
 * with tower facades, holographic billboards and shopfronts, and the workers sit at console benches in
 * the open arcade under the overpasses. At the far end, up on a chrome dais, is the boss's chair, with
 * a fixer beside it who sends out new crews — workers waiting on you line up in front of the dais, and
 * one sent home is walked out to the street by a corporate security escort.
 *
 * Beams of neon frame everything; every sign, screen and hologram is a prop you can move, so a map of
 * your own can `extends: 'cyberpunk'` and light the place however it likes (docs/maps.md).
 *
 * The concourse runs north (-z, the dais) to south (+z, the street door); x is across it, west (-x) to
 * east. `enclosed: true`: it is one roofed volume, with the city only ever seen through the glass.
 */

const W = 34;
const L = 70;
/** Just off the inside of each side wall: the boards, the signs and the shop fronts hang here. */
const WALL_X = W / 2 - 0.08;
/** Against the side walls: the vending machines and service cabinets. */
const SERVICE_X = W / 2 - 0.8;
/** The boss's dais, at the north end. Its front is 2.4 m south of the chair (see buildDais). */
const THRONE_Z = -L / 2 + 3.4;
const DAIS_FRONT = THRONE_Z + 2.4;
const DOOR_Z = L / 2 - 1.4;

/** A neon sign, its top at `y`, hanging on the side wall of the concourse. */
const sign = (side: -1 | 1, z: number, y: number, text: string, color: string, width = 0.5, light = false): PropConfig => ({
  kind: 'sign',
  x: side * (WALL_X - 0.12),
  z,
  y,
  text,
  color,
  width,
  height: 0.9,
  rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
  ...(light ? { light: true } : {}),
});

/** A holographic billboard high on a side wall. */
const screen = (side: -1 | 1, z: number, y: number, width: number, height: number): PropConfig => ({
  kind: 'screen',
  x: side * (WALL_X - 0.14),
  z,
  y,
  width,
  height,
  rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
});

/** A shopfront sign over a doorway in a side wall, facing the concourse. */
const shopSign = (side: -1 | 1, z: number, text: string, color: string): PropConfig => ({
  kind: 'sign',
  x: side * (WALL_X - 0.12),
  z,
  y: 3.6,
  text,
  color,
  width: 2.6,
  height: 0.7,
  rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
});

/** The plaza's neon strips and signs. */
const props: PropConfig[] = [
  // ---- Neon on the walls, down both sides (the tall frames the boards hang between) ----
  sign(-1, -30, 6.2, 'NOODLES', '#ff2c9c', 0.7),
  sign(1, -30, 6.2, '24H', '#2de2e6', 0.7),
  sign(-1, -25, 5.4, 'CHROME', '#ffd60a'),
  sign(1, -25, 5.4, 'SYNTH', '#ff2c9c'),
  sign(-1, 20, 5.6, 'RAMEN', '#ff6b35', 0.7, true),
  sign(1, 20, 5.6, 'DATA', '#2de2e6', 0.7, true),
  sign(-1, 26, 4.8, 'OPEN', '#39ff88'),
  sign(1, 26, 4.8, 'JACK IN', '#ff2c9c'),
  // ---- The north wall, behind the dais: a wall of neon ----
  { kind: 'sign', x: -5.5, z: -L / 2 + 0.12, y: 7.4, text: 'NIGHT CITY', color: '#ff2c9c', width: 0.8, height: 1.2, rotY: 0 },
  { kind: 'sign', x: 5.5, z: -L / 2 + 0.12, y: 7.4, text: 'TRANSIT', color: '#2de2e6', width: 0.8, height: 1.2, rotY: 0 },
  { kind: 'sign', x: 0, z: -L / 2 + 0.12, y: 9.6, text: 'GRID', color: '#ffd60a', width: 1.1, height: 1.4, rotY: 0, light: true },
  // ---- Holographic billboards over the shopfronts ----
  screen(-1, -18, 6.2, 4.2, 2.4),
  screen(1, -18, 6.2, 4.2, 2.4),
  screen(-1, 8, 6.2, 4.2, 2.4),
  screen(1, 8, 6.2, 4.2, 2.4),
  screen(-1, 28, 5.4, 3.6, 2.1),
  screen(1, 28, 5.4, 3.6, 2.1),
  // ---- Shopfront signs, over a doorway in each side wall ----
  shopSign(-1, -24.5, 'BAR', '#ff2c9c'),
  shopSign(-1, -12, 'CLINIC', '#2de2e6'),
  shopSign(-1, 2, 'PAWN', '#ffd60a'),
  shopSign(-1, 18.5, 'SUSHI', '#ff6b35'),
  shopSign(1, -24.5, 'ARMS', '#ff2c9c'),
  shopSign(1, -12, 'CHIPS', '#39ff88'),
  shopSign(1, 2, 'MOTEL', '#2de2e6'),
  shopSign(1, 18.5, 'NET CAFÉ', '#ffd60a'),
  // ---- Hologram projectors out on the floor, at the corners of the arcade ----
  { kind: 'holo', x: -10.4, z: -DAIS_FRONT - 1.6, color: '#2de2e6' },
  { kind: 'holo', x: 10.4, z: -DAIS_FRONT - 1.6, color: '#ff2c9c' },
  { kind: 'holo', x: -10.4, z: 15.4, color: '#ffd60a' },
  { kind: 'holo', x: 10.4, z: 15.4, color: '#ff2c9c' },
  { kind: 'holo', x: 0, z: 24, color: '#2de2e6', scale: 1.35 },
  // ---- Steel columns down each side, with the gantry over them (see the builder) ----
  ...[-30, -22, -14, -6, 2, 10, 18, 26].flatMap((z) => [-1, 1].map((side) => ({ kind: 'pillar', x: side * 12.6, z }))),
  // ---- Vending machines (E for a drink) and service cabinets ----
  { kind: 'machine', x: -SERVICE_X, z: -6, rotY: Math.PI / 2, color: '#ff2c9c' },
  { kind: 'machine', x: SERVICE_X, z: -6, rotY: -Math.PI / 2, color: '#2de2e6' },
  { kind: 'machine', x: -SERVICE_X, z: 18.4, rotY: Math.PI / 2, color: '#ffd60a' },
  { kind: 'machine', x: SERVICE_X, z: 18.4, rotY: -Math.PI / 2, color: '#39ff88' },
  // ---- Stacked cases, and the plaza's clutter ----
  { kind: 'crate', x: -14.6, z: -L / 2 + 3.4, scale: 1.05 },
  { kind: 'crate', x: -13.2, z: -L / 2 + 2.5, scale: 0.8 },
  { kind: 'crate', x: 14.6, z: -L / 2 + 3.4, scale: 1.05 },
  { kind: 'crate', x: 13.2, z: -L / 2 + 2.5, scale: 0.8 },
  { kind: 'crate', x: -16.2, z: 30.6, scale: 0.9 },
  { kind: 'crate', x: -15.1, z: 29.4, scale: 0.7 },
  { kind: 'crate', x: 16.2, z: 30.6, scale: 0.9 },
  { kind: 'crate', x: 15.1, z: 29.4, scale: 0.7 },
  // ---- Steam vents along the kerb ----
  { kind: 'vent', x: -14, z: -24.6, color: '#9fb4c8' },
  { kind: 'vent', x: 14, z: -24.6, color: '#9fb4c8' },
  { kind: 'vent', x: -14, z: -7.5, color: '#9fb4c8' },
  { kind: 'vent', x: 14, z: -7.5, color: '#9fb4c8' },
  { kind: 'vent', x: -14, z: 10.5, color: '#9fb4c8' },
  { kind: 'vent', x: 14, z: 10.5, color: '#9fb4c8' },
  { kind: 'vent', x: -4.5, z: 21.5, color: '#9fb4c8' },
  { kind: 'vent', x: 4.5, z: 21.5, color: '#9fb4c8' },
  // ---- Low barriers, lighting the kerb and keeping the traffic off ----
  { kind: 'barrier', x: 0, z: 19.2, width: 12, color: '#ff2c9c' },
  { kind: 'barrier', x: -13.6, z: 25.4, width: 3.6, rotY: Math.PI / 2, color: '#2de2e6' },
  { kind: 'barrier', x: 13.6, z: 25.4, width: 3.6, rotY: Math.PI / 2, color: '#2de2e6' },
  // ---- A neon guide strip down the middle, and one across at the kerb ----
  { kind: 'carpet', x: 0, z: -4, width: 1.6, length: 60, color: '#2de2e6', y: 0 },
  // ---- The merge gong: a chrome bell by the dais ----
  { kind: 'gong', x: -8.6, z: DAIS_FRONT - 1.4, rotY: Math.PI / 2 },
];

export const CYBERPUNK: MapConfig = {
  id: 'cyberpunk',
  name: 'Night City',
  icon: '🌃',
  description:
    'A neon cyberpunk concourse: a rain-slick street lined with tower facades, holographic billboards and vending machines, with console benches in the arcade under the overpasses. A chrome dais at the far end holds the boss’s chair, its fixer beside it, and a wall of neon behind. Workers line up in front of the dais when they need you, and one sent home is walked out to the street by corporate security.',
  style: 'cyberpunk',
  hall: { width: W, length: L, height: 14 },
  spawn: { x: 0, z: DOOR_Z - 4.5, rotY: Math.PI },
  door: { x: 0, z: DOOR_Z },
  throne: { x: 0, z: THRONE_Z, rotY: 0, dais: { width: 11, depth: 5, height: 0.8, steps: 3 }, label: '🪑 The boss’s chair' },
  herald: {
    x: 4.1,
    z: THRONE_Z + 2.9,
    rotY: -0.35,
    name: 'Fixer',
    says: 'Talk to me to put a crew on a job',
    ask: 'What’s the gig?',
    button: 'Send them out 🌆',
  },
  lineup: { x: 0, z: DAIS_FRONT + 2.2, rotY: Math.PI, step: [0, 1.4], count: 8 },
  tables: [
    { name: 'North-west deck', x: -8, z: -10, length: 12, seats: 5 },
    { name: 'North-east deck', x: 8, z: -10, length: 12, seats: 5 },
    { name: 'South-west deck', x: -8, z: 6, length: 12, seats: 5 },
    { name: 'South-east deck', x: 8, z: 6, length: 12, seats: 5 },
  ],
  stations: {
    issues: { x: -15.3, z: -20, rotY: -Math.PI / 2 },
    queue: { x: -15.3, z: 14, rotY: -Math.PI / 2 },
    pulls: { x: 15.3, z: -20, rotY: Math.PI / 2 },
  },
  council: { x: 9.6, z: -24.4, rotY: 0 },
  boards: {
    issues: { x: -WALL_X, y: 3.7, z: -20, rotY: Math.PI / 2, width: 4.6, height: 2.8, label: '📟 Gigs' },
    queue: { x: -WALL_X, y: 3.7, z: 14, rotY: Math.PI / 2, width: 4.6, height: 2.8, label: '📋 Fixer board' },
    pulls: { x: WALL_X, y: 3.7, z: -20, rotY: -Math.PI / 2, width: 4.6, height: 2.8, label: '🔀 Upgrades' },
    services: { x: WALL_X, y: 3.7, z: 14, rotY: -Math.PI / 2, width: 4.6, height: 2.8, label: '🌐 Grid' },
  },
  props,
  agents: { outfit: 'none', ageMinutes: 0 },
  palette: { stone: '#2b323e', floor: '#1b1f28', carpet: '#ff2c9c', wood: '#3a2b46', trim: '#2de2e6' },
  // Sent home, a worker is marched out to the street by corporate security and left there.
  sendHome: {
    escort: { name: 'CorpSec', post: { x: 13.4, z: 24.5, rotY: -Math.PI / 2 }, color: '#ffd60a' },
    steps: [
      { do: 'fetch' },
      { do: 'say', who: 'escort', text: ['Contract’s terminated. On your feet.', 'Your access is revoked. Come with me.', 'Corpo wants you gone. Move.'] },
      { do: 'pack' },
      { do: 'say', text: ['😰 My chrome…', '🥺 I was in the middle of a run!', '😶 Fine. Whatever.', '😤 You’ll need me again.'] },
      { do: 'walk', to: 'door' },
      { do: 'leave' },
      { do: 'return' },
    ],
  },
};
