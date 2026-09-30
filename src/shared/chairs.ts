// Musical chairs, in the open floor south of the desks: where the ring of chairs stands, the rules of
// the game the office plays for the workers on a floor, and everything everyone is told while it runs.
//
// The office runs the rounds (see server/chairs.ts) and every page on the floor plays them out the
// same way from the state below: the chairs and the workers dancing round them (see
// client/world/chairs.ts), the tune (see client/chairstune.ts) and the PA (see client/pa.ts). The
// music is timed from `phaseAt`, so it stops in everyone's ears at the same moment, which is the
// whole point of the game.

/**
 * The middle of the ring, out on the open floor south of the desks and west of the lounge: the
 * living room, as far as this office is concerned. The ring grows with the crowd but never past
 * `most` chairs, and stays well clear of the stairs, the plant and the meeting room's glass.
 */
export const RING = { x: 4.6, z: 7.1, /** How high a worker's hips go on a chair, like a desk's (see layout's seatAnchor). */ seatY: 0.42, most: 10 } as const;

/** How far out the chairs stand for `chairs` of them: a gap to walk through between any two. */
export function ringRadius(chairs: number): number {
  return 1.15 + Math.max(1, Math.min(RING.most, chairs)) * 0.17;
}

/** Where chair `i` of `chairs` stands and which way it faces: out from the middle, back to the ring. */
export function chairAt(i: number, chairs: number): { x: number; z: number; rotY: number } {
  const a = (i / Math.max(1, chairs)) * Math.PI * 2;
  const r = ringRadius(chairs);
  return { x: RING.x + Math.sin(a) * r, z: RING.z + Math.cos(a) * r, rotY: a };
}

/** Where the `i`th of `n` players dances it out: out past the chairs, facing the middle of the ring. */
export function ringSpot(i: number, n: number, chairs: number): { x: number; z: number; rotY: number } {
  const a = (i / Math.max(1, n)) * Math.PI * 2;
  const r = ringRadius(chairs) + 1.1;
  return { x: RING.x + Math.sin(a) * r, z: RING.z + Math.cos(a) * r, rotY: a + Math.PI };
}

/** Where a worker goes when it's out of the game: out of the circle, where the chairs were stacked. */
export const EXIT = { x: RING.x - 4.4, z: RING.z - 1.4 } as const;

// ---- The game ---------------------------------------------------------------------------------------

/** Where a game has got to: everyone gathering, a round of music, the rush, the one without a chair, the last one standing. */
export type ChairsPhase = 'idle' | 'gathering' | 'music' | 'scramble' | 'react' | 'over';

/** One worker playing: who it is, and which chair it went for (null when it got none and is out). */
export interface ChairsPlayer {
  id: string;
  name: string;
  color: string;
  chair: number | null;
  /** The round it was left out of the game in, or nothing while it's still playing. */
  outIn?: number;
}

/** The game on a floor, as the office tells it. Times are on the office's clock (ms since 1970). */
export interface ChairsState {
  phase: ChairsPhase;
  /** Which round of music, from 1. */
  round: number;
  /** How many chairs are out: one fewer than there are players left in the game. */
  chairs: number;
  players: ChairsPlayer[];
  /** The one left on their chair, once there's one. */
  winner?: string;
  /** Who called the game. */
  by?: string;
  /** When it began. */
  startedAt: number;
  /** When this phase began: the music is timed from here, so everyone hears it stop together. */
  phaseAt: number;
}

/** No game on. */
export const NO_CHAIRS: ChairsState = { phase: 'idle', round: 0, chairs: 0, players: [], startedAt: 0, phaseAt: 0 };

/** How long each part of a game runs, in ms. A game reads its timings from here, so a test can play a whole one out fast. */
export interface ChairsTiming {
  /** The announcement, and everyone getting to the ring. */
  gather: number;
  /** The first round of music; each round after it is `step` shorter, to `floor`. */
  music: number;
  musicStep: number;
  musicFloor: number;
  /** The rush for the chairs once the music stops. */
  scramble: number;
  /** The one without a chair falling over, and the others settling down. */
  react: number;
  /** The winner's victory lap before the chairs are put away. */
  over: number;
}

/** The default timings: a round of music long enough to dance to, and shorter ones as the ring shrinks. */
export const TIMING: ChairsTiming = { gather: 9000, music: 15000, musicStep: 2000, musicFloor: 8000, scramble: 3500, react: 4000, over: 11000 };

/** How long the music of round `round` runs, in ms. */
export function musicMs(round: number, t: ChairsTiming = TIMING): number {
  return Math.max(t.musicFloor, t.music - (round - 1) * t.musicStep);
}

/** A game is on (a phase beyond gathering, or gathering itself). */
export function playing(state: ChairsState): boolean {
  return state.phase !== 'idle';
}

/** Whether the music is playing right now, from this phase: the gathering and every round of it. */
export function musicOn(state: ChairsState): boolean {
  return state.phase === 'gathering' || state.phase === 'music';
}

/** The players still in the game, in the order the ring gave them. */
export function inGame(state: ChairsState): ChairsPlayer[] {
  return state.players.filter((p) => p.outIn === undefined);
}

/** The players who got a chair this round. */
export function seated(state: ChairsState): ChairsPlayer[] {
  return state.players.filter((p) => p.outIn === undefined && p.chair !== null);
}

/** The player left without a chair this round, if there is one. */
export function stranded(state: ChairsState): ChairsPlayer | undefined {
  return state.players.find((p) => p.outIn === state.round);
}

/** The fewest workers a game needs. */
export const MIN_PLAYERS = 2;

// ---- What everyone is told ---------------------------------------------------------------------------
// The office's PA reads these out (see client/pa.ts), and the same words go up on the board over the
// ring, so the game reads the same to everyone whether or not they can hear the room.

/** The announcement the game opens with, word for word. */
export const GATHER_LINE = 'Attention everyone! The musical chairs game is starting! Everyone, please gather in the living room and get ready to play!';

/** The music's first bar of a round. */
export function musicLine(round: number): string {
  return round === 1 ? 'Music on! Dance while you can!' : `Round ${round}! Music on — dance while you can!`;
}

/** The music stopping dead. */
export const SCRAMBLE_LINE = "Music off! Grab a chair!";

/** How it goes for whoever's left standing. */
const QUIPS = [
  'no chair for it this time',
  'out-danced by a beanbag',
  'the music always wins',
  'back to the desk, then',
  'still the office’s best worker',
  'it will get the next one',
] as const;

/** The same line for the same worker, whichever page is asking. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The line about the worker that got left out of this round. */
export function outLine(p: ChairsPlayer): string {
  return `${p.name} is out! ${QUIPS[hash(p.id) % QUIPS.length]}.`;
}

/** The winner's line, and the last one of the game. */
export function winnerLine(name: string): string {
  return `${name} wins musical chairs!`;
}

/** The game is over and the chairs go back against the wall. */
export const END_LINE = "That's the game! Everyone back to work.";

/** The line for the board over the ring (and the toast) in this phase. */
export function caption(state: ChairsState): string {
  if (state.phase === 'gathering') return GATHER_LINE;
  if (state.phase === 'music') return musicLine(state.round);
  if (state.phase === 'scramble') return SCRAMBLE_LINE;
  if (state.phase === 'react') {
    const out = stranded(state);
    return out ? outLine(out) : END_LINE;
  }
  if (state.phase === 'over') {
    const winner = state.players.find((p) => p.id === state.winner);
    return winner ? winnerLine(winner.name) : END_LINE;
  }
  return '';
}

/** The short line on the top bar while a game is on: the round, the chairs, and what's happening. */
export function statusLine(state: ChairsState): string {
  if (state.phase === 'gathering') return `🪑 gathering · ${inGame(state).length} in`;
  if (state.phase === 'music') return `🪑 round ${state.round} · ${state.chairs} chairs · music on`;
  if (state.phase === 'scramble') return '🪑 music off!';
  if (state.phase === 'react') {
    const out = stranded(state);
    return out ? `🪑 ${out.name} is out` : '🪑 over';
  }
  if (state.phase === 'over') {
    const winner = state.players.find((p) => p.id === state.winner);
    return `🪑 ${winner ? `${winner.name} wins!` : 'over'}`;
  }
  return '🪑 musical chairs';
}
