import type { MapConfig, PropConfig } from './types.js';

/*
 * The space station: a long pressurised deck in orbit, the Earth rolling by outside its windows. At
 * the forward end is the bridge, a raised deck under a wall of glass with the captain's chair on it,
 * where you sit; the workers sit at the benches down both sides, and line up before the chair when
 * they're done or need you. The First Officer stands at your left and brings a new worker aboard
 * when you speak to them. The boards are displays on the side walls, a board agent at a console
 * under each. Aft is the hatch workers come in through, and in the starboard wall, between two big
 * observation windows, the airlock: a worker sent home is marched to it by Security and blown out
 * into space, and everyone ever ejected is still adrift out there, to be seen from those windows.
 *
 * It's all data, like the castle (./castle.ts): moving something is changing a number here, or a
 * map of your own that `extends: 'station'` in the office's .agent-office/maps/ (docs/maps.md).
 *
 * The deck runs forward (-z, the bridge) to aft (+z, the hatch); x is across it, port (-x) to starboard.
 */

const W = 30;
const L = 58;
const H = 7.6;
/** Just off the inside of each side wall. */
const WALL_X = W / 2 - 0.08;
/** The benches' rows, either side of the middle of the deck. */
const BENCH_X = 7.6;
/** Where the boards hang along the side walls, and the windows between and beyond them. */
const BOARDS_Z = [-14, -3];
const SIDE_WINDOWS: [z: number, width: number][] = [
  [-21, 5],
  [-8.5, 4],
  [7, 6],
  [19.5, 6],
];
/** The airlock, in the starboard wall between its two observation windows. */
const AIRLOCK_Z = 13;
const facing = (side: number) => (side < 0 ? Math.PI / 2 : -Math.PI / 2);

const props: PropConfig[] = [
  // The hull's ribs, clear of the windows and the boards.
  ...[-26, -17.4, -11.15, -5.85, 1.5, 15.6, 24].map((z) => ({ kind: 'rib', x: 0, z })),
  // The bridge's wall of glass, forward, and the windows down both sides.
  ...[-8.6, 0, 8.6].map((x) => ({ kind: 'viewport', x, z: -L / 2, y: 1.5, width: 7.6, height: 4.6, rotY: 0 })),
  ...SIDE_WINDOWS.flatMap(([z, width]) => [-1, 1].map((side) => ({ kind: 'viewport', x: side * (W / 2), z, y: 1.1, width, height: 3.8, rotY: facing(side) }))),
  // Light: pods over the bridge, the benches and the hatch, and strips in the deck down the middle.
  { kind: 'lamp', x: 0, z: -24.5, y: H - 0.9, light: true },
  ...[-8, 6].flatMap((z) => [-1, 1].map((side) => ({ kind: 'lamp', x: side * BENCH_X, z, y: H - 0.9, light: true }))),
  { kind: 'lamp', x: 0, z: 21, y: H - 0.9, light: true },
  ...[-15, 8].map((z) => ({ kind: 'lamp', x: 0, z, y: H - 0.9 })),
  ...[-1, 1].map((side) => ({ kind: 'strip', x: side * 2.4, z: 3.3, width: 0.3, length: 46 })),
  // A holo-table in the middle of the deck, the Earth turning over it.
  { kind: 'hologram', x: 0, z: -1 },
  // Displays: across from the airlock, and either side of the hatch.
  { kind: 'screen', x: -WALL_X, z: AIRLOCK_Z, y: 2.9, width: 4, height: 2.2, rotY: Math.PI / 2 },
  ...[-1, 1].map((side) => ({ kind: 'screen', x: side * 6.4, z: L / 2 - 0.08, y: 2.8, width: 3.2, height: 1.8, rotY: Math.PI })),
  // Something green under a window each side, cargo by the hatch.
  ...[-1, 1].map((side) => ({ kind: 'planter', x: side * (W / 2 - 0.45), z: -8.5, rotY: facing(side) })),
  { kind: 'crate', x: -5.6, z: 27.6 },
  { kind: 'crate', x: -7.3, z: 27.5, scale: 0.75, rotY: 0.4 },
  { kind: 'crate', x: 5.3, z: 27.7, rotY: -0.2 },
  // The merge gong, port of the bridge; something hot to drink, aft.
  { kind: 'gong', x: -9.6, z: -19.6, rotY: Math.PI / 2 },
  { kind: 'dispenser', x: -W / 2 + 0.45, z: 25.5, rotY: Math.PI / 2 },
];

export const STATION: MapConfig = {
  id: 'station',
  name: 'Space station',
  icon: '🚀',
  description:
    'A space station in orbit, the Earth rolling by outside its windows. Workers sit at the benches down either side and line up before your captain’s chair on the bridge when they’re done or need you. Speak to the First Officer to bring a new one aboard; send one home, and Security marches it to the airlock and blows it out into space, where everyone ever ejected is still adrift.',
  style: 'station',
  hall: { width: W, length: L, height: H },
  spawn: { x: -2.6, z: -17.5, rotY: Math.PI },
  door: { x: 0, z: L / 2 - 1.4 },
  // The bridge: a raised deck right up to the forward windows, the captain's chair on it.
  throne: { x: 0, z: -24.2, rotY: 0, dais: { width: 14, depth: 7.2, height: 0.6, steps: 2 }, label: '🚀 Captain’s chair' },
  herald: { x: 3.2, z: -23.2, rotY: -0.35, name: 'First Officer', says: 'Speak to me to bring a new worker aboard', ask: 'What’s their mission, Captain?', button: 'Make it so 🚀' },
  lineup: { x: 0, z: -22.4, rotY: Math.PI, step: [0, 1.3], count: 8 },
  tables: [
    { name: 'Port forward bench', x: -BENCH_X, z: -8, length: 10, seats: 4 },
    { name: 'Starboard forward bench', x: BENCH_X, z: -8, length: 10, seats: 4 },
    { name: 'Port aft bench', x: -BENCH_X, z: 6, length: 10, seats: 4 },
    { name: 'Starboard aft bench', x: BENCH_X, z: 6, length: 10, seats: 4 },
  ],
  stations: {
    issues: { x: -13.2, z: BOARDS_Z[0], rotY: -Math.PI / 2 },
    queue: { x: -13.2, z: BOARDS_Z[1], rotY: -Math.PI / 2 },
    pulls: { x: 13.2, z: BOARDS_Z[0], rotY: Math.PI / 2 },
  },
  // The briefing table, aft on the starboard side.
  council: { x: 10, z: 24.8, rotY: Math.PI },
  boards: {
    issues: { x: -WALL_X, y: 3.3, z: BOARDS_Z[0], rotY: Math.PI / 2, width: 4.4, height: 2.6, label: '📡 Incoming signals' },
    queue: { x: -WALL_X, y: 3.3, z: BOARDS_Z[1], rotY: Math.PI / 2, width: 4.4, height: 2.6, label: '📋 Mission queue' },
    pulls: { x: WALL_X, y: 3.3, z: BOARDS_Z[0], rotY: -Math.PI / 2, width: 4.4, height: 2.6, label: '🔀 Docking requests' },
    services: { x: WALL_X, y: 3.3, z: BOARDS_Z[1], rotY: -Math.PI / 2, width: 4.4, height: 2.6, label: '🌐 Subsystems' },
  },
  props,
  agents: { outfit: 'none', ageMinutes: 0 },
  palette: { hull: '#dfe5ee', deck: '#3d4858', panel: '#aeb8c8', metal: '#56627a', glow: '#35d6ff' },
  airlock: { x: W / 2 - 0.4, z: AIRLOCK_Z },
  // Sent home, a worker's marched to the airlock by Security and blown out into space, for good.
  sendHome: {
    escort: { name: 'Security', post: { x: 13.3, z: AIRLOCK_Z + 2.3, rotY: -Math.PI / 2 }, color: '#27313f' },
    steps: [
      { do: 'fetch' },
      { do: 'say', who: 'escort', text: ['Captain’s orders. You’re off the crew.', 'On your feet. Your shift ends at the airlock.', 'You’ve been reassigned. To space.', 'Come quietly. Mind the vacuum.'] },
      { do: 'pack' },
      { do: 'say', text: ['😨 Not the airlock!', '😰 But my pull request…', '😭 I was nearly done!', '🥺 Just one more commit!', '🫠 I didn’t pack a suit…', '😶 …'] },
      { do: 'walk', to: 'airlock' },
      { do: 'eject' },
      { do: 'say', who: 'escort', text: ['🚀 Bon voyage.', '🫡 Thank you for your service.', '🌌 Mind the gap.', '👋 Should have shipped it.'] },
      { do: 'return' },
    ],
    starveHours: 1,
    rotHours: 12,
  },
};
