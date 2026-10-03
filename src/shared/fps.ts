/** Shared arena geometry: rendering, movement and server hit tests use the same solids. */
import type { BotDifficulty, BotProfile } from './fps-bots.js';
export const FPS = { magazine: 30, reserve: 90, reload: 1800, shot: 120, round: 90000, wins: 5, eye: 1.55 } as const;
export interface Solid { x: number; y: number; z: number; w: number; h: number; d: number; kind: 'wall' | 'crate' | 'container' }
export const ARENA: readonly Solid[] = [
  { x: 0, y: 2.5, z: -12, w: 33, h: 5, d: 1, kind: 'wall' },
  { x: 0, y: 2.5, z: 12, w: 33, h: 5, d: 1, kind: 'wall' },
  { x: -16, y: 2.5, z: 0, w: 1, h: 5, d: 24, kind: 'wall' },
  { x: 16, y: 2.5, z: 0, w: 1, h: 5, d: 24, kind: 'wall' },
  { x: -5.5, y: 1.5, z: -3, w: 3, h: 3, d: 8, kind: 'container' },
  { x: 5.5, y: 1.5, z: 3, w: 3, h: 3, d: 8, kind: 'container' },
  { x: 0, y: 1.15, z: 0, w: 3, h: 2.3, d: 3, kind: 'crate' },
  { x: -11, y: 1.05, z: 3, w: 2.5, h: 2.1, d: 3, kind: 'crate' },
  { x: 11, y: 1.05, z: -3, w: 2.5, h: 2.1, d: 3, kind: 'crate' },
  { x: -1, y: .6, z: -7.5, w: 3, h: 1.2, d: 1.5, kind: 'crate' },
  { x: 1, y: .6, z: 7.5, w: 3, h: 1.2, d: 1.5, kind: 'crate' },
];
export interface FpsInput { forward: number; side: number; yaw: number; pitch: number; walk: boolean; jump: boolean; fire: boolean }
export const idleInput = (): FpsInput => ({ forward: 0, side: 0, yaw: 0, pitch: 0, walk: false, jump: false, fire: false });
export interface FpsPlayer {
  id: string; name: string; x: number; y: number; z: number; vy: number; yaw: number; pitch: number;
  hp: number; ammo: number; reserve: number; score: number; reloadUntil: number; ready: boolean;
  bot?: BotProfile; difficulty?: BotDifficulty;
}
export type FpsPhase = 'waiting' | 'countdown' | 'live' | 'intermission' | 'finished';
export interface FpsState { players: FpsPlayer[]; phase: FpsPhase; round: number; until: number; now: number; winner: string | null; reason: string }
export interface FpsShot { shooter: string; from: Point; to: Point; hit: string | null; headshot: boolean }
export interface Point { x: number; y: number; z: number }

/** Reject malformed wire input rather than silently converting NaN or strings to movement. */
export function validInput(v: FpsInput): boolean {
  return !!v && typeof v === 'object' && [-1, 0, 1].includes(v.forward) && [-1, 0, 1].includes(v.side)
    && Number.isFinite(v.yaw) && Math.abs(v.yaw) <= Math.PI * 2 && Number.isFinite(v.pitch) && Math.abs(v.pitch) <= 1.45
    && typeof v.walk === 'boolean' && typeof v.jump === 'boolean' && typeof v.fire === 'boolean';
}

function blocked(x: number, z: number, y: number): boolean {
  return ARENA.some(b => y < b.y + b.h / 2 && y + 1.7 > b.y - b.h / 2
    && Math.abs(x - b.x) < b.w / 2 + .3 && Math.abs(z - b.z) < b.d / 2 + .3);
}

/** Small swept steps prevent walking or jumping through cover, even after a slow frame. */
export function moveFps(p: FpsPlayer, input: FpsInput, seconds: number): void {
  const dt = Math.max(0, Math.min(.1, seconds));
  p.yaw = input.yaw; p.pitch = input.pitch;
  if (!p.hp) return;
  const n = Math.max(1, Math.hypot(input.forward, input.side));
  const speed = input.walk ? 2.3 : 4.8;
  const dx = (input.side * Math.cos(p.yaw) - input.forward * Math.sin(p.yaw)) / n * speed * dt;
  const dz = (-input.side * Math.sin(p.yaw) - input.forward * Math.cos(p.yaw)) / n * speed * dt;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .1));
  for (let i = 0; i < steps; i++) {
    if (!blocked(p.x + dx / steps, p.z, p.y)) p.x += dx / steps;
    if (!blocked(p.x, p.z + dz / steps, p.y)) p.z += dz / steps;
  }
  const floor = ARENA.reduce((y, b) => Math.abs(p.x - b.x) < b.w / 2 + .25 && Math.abs(p.z - b.z) < b.d / 2 + .25 && b.y + b.h / 2 <= p.y + .01 ? Math.max(y, b.y + b.h / 2) : y, 0);
  if (input.jump && p.y <= floor + .01 && p.vy <= 0) p.vy = 5.8;
  p.vy -= 18 * dt;
  const nextY = Math.max(floor, p.y + p.vy * dt);
  if (nextY > p.y && blocked(p.x, p.z, nextY)) p.vy = 0;
  else p.y = nextY;
  if (p.y === floor) p.vy = 0;
}

/** Ray/AABB slab intersection, including rays parallel to a face. */
export function rayBox(origin: Point, direction: Point, b: Solid): number | null {
  let near = 0, far = 80;
  for (const [axis, size] of [['x', 'w'], ['y', 'h'], ['z', 'd']] as const) {
    const min = b[axis] - b[size] / 2, max = b[axis] + b[size] / 2;
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < min || origin[axis] > max) return null;
    } else {
      const a = (min - origin[axis]) / direction[axis], c = (max - origin[axis]) / direction[axis];
      near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c));
      if (near > far) return null;
    }
  }
  return far >= 0 ? near : null;
}

export function traceShot(p: FpsPlayer, opponent: FpsPlayer | undefined): FpsShot {
  const from = { x: p.x, y: p.y + FPS.eye, z: p.z };
  const direction = { x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
  let distance = 80;
  for (const b of ARENA) distance = Math.min(distance, rayBox(from, direction, b) ?? 80);
  let hit: string | null = null, headshot = false;
  if (opponent?.hp) {
    const body = rayBox(from, direction, { x: opponent.x, y: opponent.y + .77, z: opponent.z, w: .64, h: 1.54, d: .64, kind: 'crate' });
    const head = rayBox(from, direction, { x: opponent.x, y: opponent.y + 1.57, z: opponent.z, w: .42, h: .32, d: .42, kind: 'crate' });
    const target = Math.min(body ?? 80, head ?? 80);
    if (target < distance) { distance = target; hit = opponent.id; headshot = head !== null && head <= (body ?? 80); }
  }
  return { shooter: p.id, from, to: { x: from.x + direction.x * distance, y: from.y + direction.y * distance, z: from.z + direction.z * distance }, hit, headshot };
}
