import { CAST, type Coworker } from './cast';
import { SCENES, type Scene } from './scenes';
import { perform, type Performance, type GestureCue } from './choreography';

export const DAY_MS = 40 * 60 * 1000;
export const SLOT_MS = 120 * 1000;
const START = 8 * 60 + 30;
const WORK_MINUTES = 9 * 60;
export const PLACES = {
  reception: [2, -7.5], bullpen: [-7.5, 0], kitchen: [-13.5, 9.6],
  meeting: [10.7, 9.1], annex: [-8, 7.4],
} satisfies Record<Scene['place'], [number, number]>;

export interface AmbientState {
  person: Coworker;
  present: boolean;
  activity: string;
  target: [number, number];
  line?: string;
  seat?: { hips: number; facing: number };
  attention?: string;
  gesture?: GestureCue;
}
export interface Snapshot {
  sampledAt: number;
  day: number;
  minute: number;
  clock: string;
  phase: 'arrival' | 'work' | 'lunch' | 'departure' | 'after-hours';
  scene?: Scene;
  performance?: Performance;
  people: AmbientState[];
  memories: string[];
}

function hash(seed: string): number {
  let n = 2166136261;
  for (const c of seed) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}

export function sceneFor(day: number, slot: number, floor: string): Scene {
  // One occasional ritual per five days; no fabricated birthday or holiday dates.
  if (slot === 11 && day % 5 === 0) return SCENES.find((s) => s.id === 'pretzels')!;
  if (slot === 11 && day % 5 === 3) return SCENES.find((s) => s.id === 'dundies')!;
  const ordinary = SCENES.filter((s) => !s.ritual);
  return ordinary[(hash(floor) + day * 7 + slot * 5) % ordinary.length];
}

/** Pure, wall-clock driven schedule: works offscreen, survives reloads and costs no model calls.
 * All browsers on a floor get the same beats; assistance and visual movement stay local. */
export function sampleOffice(timestamp: number, floor: string): Snapshot {
  const day = Math.floor(timestamp / DAY_MS);
  const within = ((timestamp % DAY_MS) + DAY_MS) % DAY_MS;
  const minute = START + within / DAY_MS * WORK_MINUTES;
  const slot = Math.floor(within / SLOT_MS);
  const elapsed = within % SLOT_MS;
  const phase = minute < 9 * 60 ? 'arrival' : minute < 12 * 60 ? 'work' : minute < 13 * 60 ? 'lunch' : minute < 16 * 60 + 45 ? 'work' : minute < 17 * 60 + 15 ? 'departure' : 'after-hours';
  const selected = sceneFor(day, slot, floor);
  const event = (phase === 'work' || phase === 'lunch') && elapsed < 82000 ? selected : undefined;
  const participants = event ? [...new Set(event.beats.map((b) => b.who))] : [];
  const performance = event ? perform(event, elapsed, day * 20 + slot) : undefined;
  const beat = event && elapsed >= 35000 && elapsed < 35000 + event.beats.length * 6000 ? event.beats[Math.floor((elapsed - 35000) / 6000)] : undefined;
  const people = CAST.map((p, i): AmbientState => {
    const member = participants.indexOf(p.id);
    const arrived = minute >= START + i * 0.7;
    const left = minute >= 17 * 60 + (p.id === 'stanley' ? 0 : i * 0.55);
    const present = arrived && !left && (!p.visitor || member >= 0 || (p.id === 'darryl' && slot % 4 === 2));
    let activity = p.routine[(day + slot + i) % p.routine.length];
    let target: [number, number] = [...p.home];
    if (member >= 0 && event) {
      const center = PLACES[event.place];
      const angle = member / participants.length * Math.PI * 2;
      target = [center[0] + Math.cos(angle) * 1.1, center[1] + Math.sin(angle) * 1.1];
      activity = event.title;
    } else if (phase === 'lunch' && (slot + i) % 3 === 0) {
      target = [PLACES.kitchen[0] + (i % 3 - 1) * 1.2, PLACES.kitchen[1] - Math.floor(i % 6 / 3) * 1.3];
      activity = 'Taking a lunch break';
    } else if (phase === 'arrival') activity = 'Settling in for the day';
    else if (phase === 'departure') {
      activity = 'Wrapping up and heading home';
      target = [7.8 + (i % 3 - 1) * 0.65, -9.4 + (i % 4) * 0.6];
    }
    if (!present) activity = p.visitor ? (p.id === 'darryl' ? 'Working downstairs' : 'Away from the branch') : 'Off shift';
    const attention = member < 0 ? undefined : performance?.speaker === p.id ? performance.listener : performance?.speaker;
    return { person: p, present, activity, target, line: performance?.stage === 'dialogue' && beat?.who === p.id ? beat.text : undefined,
      attention, gesture: performance?.cues[p.id] };
  });
  const memories: string[] = [];
  // Completed work slots, including yesterday: continuity does not depend on watching a scene.
  for (let n = 0; n < 25 && memories.length < 3; n++) {
    const absoluteSlot = day * 20 + slot - n;
    const d = Math.floor(absoluteSlot / 20);
    const s = ((absoluteSlot % 20) + 20) % 20;
    const m = START + (s * SLOT_MS + 82000) / DAY_MS * WORK_MINUTES;
    if (m < 9 * 60 || m >= 16 * 60 + 45 || (n === 0 && elapsed < 82000)) continue;
    memories.push(sceneFor(d, s, floor).aftermath);
  }
  const clock = `${Math.floor(minute / 60)}:${String(Math.floor(minute % 60)).padStart(2, '0')}`;
  return { sampledAt: timestamp, day, minute, clock, phase, scene: event, performance, people, memories };
}
