import type { CarriedObject, CarryPose } from './protocol.js';

/** Pose/coffee-level updates need no board or people-list redraw. */
export function sameCarry(a: CarriedObject | null | undefined, b: CarriedObject | null | undefined): boolean {
  if (!a?.pose || !b?.pose) return false;
  if (a.kind === 'coffee' || b.kind === 'coffee') return a.kind === b.kind;
  return a.issue === b.issue && a.title === b.title;
}

/** Untrusted carry messages: null clears, undefined rejects without changing the last state. */
export function readCarry(value: unknown, peer: { x: number; y: number; z: number }): CarriedObject | null | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const msg = value as Record<string, unknown>;
  let pose: CarryPose | undefined;
  if (msg.pose !== undefined) {
    if (!msg.pose || typeof msg.pose !== 'object') return undefined;
    const p = msg.pose as Record<string, unknown>;
    if (p.hand !== 'left' && p.hand !== 'right') return undefined;
    if (!tuple(p.position, 3) || !tuple(p.quaternion, 4)) return undefined;
    const [x, y, z] = p.position;
    if (Math.abs(x) > 10000 || Math.abs(z) > 10000 || Math.abs(y) > 1000) return undefined;
    if (p.placed !== undefined && typeof p.placed !== 'boolean') return undefined;
    // A held pose stays by its owner. Placed mugs stay world-fixed as the owner walks away.
    if (!p.placed && Math.hypot(x - peer.x, y - peer.y, z - peer.z) > 5) return undefined;
    const length = Math.hypot(...p.quaternion);
    if (length < 0.5 || length > 1.5) return undefined;
    pose = {
      hand: p.hand,
      position: [x, y, z],
      quaternion: p.quaternion.map((n) => n / length) as CarryPose['quaternion'],
      ...(p.placed ? { placed: true } : {}),
    };
  }
  if (msg.kind === 'coffee') {
    if (!pose || typeof msg.empty !== 'boolean') return undefined;
    return { kind: 'coffee', empty: msg.empty, pose };
  }
  if (msg.kind !== undefined && msg.kind !== 'issue') return undefined;
  if (msg.issue === undefined && !pose && msg.kind === undefined) return null;
  if (typeof msg.issue !== 'number' || !Number.isSafeInteger(msg.issue) || msg.issue <= 0 || typeof msg.title !== 'string' || pose?.placed) return undefined;
  return { issue: msg.issue, title: msg.title.slice(0, 200), ...(pose ? { pose } : {}) };
}

function tuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}
