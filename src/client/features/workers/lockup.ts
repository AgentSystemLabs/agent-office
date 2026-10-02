import * as THREE from 'three';
import { wrap, type Sendoff, type StepHost } from './sendoff';

/*
 * A send-home script's `jail` step (see sendhome.ts): the worker, brought to its cell's door, is
 * thrown in, and the door slams behind it.
 */

/** Thrown into its cell: the door swinging open, a step up to it, the throw, and the door slamming. */
const JAIL = { open: 0.5, step: 0.35, fly: 0.75, shut: 0.3 } as const;

/** Thrown into its cell, and the door locked behind it: true once it's shut. */
export function lockUp(host: StepHost, s: Sendoff): boolean {
  const j = s.jail!;
  const d = host.world().dungeon;
  const c = d?.plan.cells[s.cell!.cell];
  if (!d || !c) {
    s.leaving = true;
    return true;
  }
  const pos = s.model.root.position;
  if (j.phase === 'go') {
    // Not at its cell's door yet (the script didn't take it there): off it goes, then.
    if (s.state === 'walk' || s.state === 'hop') return false;
    if (Math.hypot(pos.x - c.outside[0], pos.z - c.outside[1]) > 0.35 && !j.walked) {
      j.walked = true;
      host.walkTo(s, 'cell');
      return false;
    }
    j.phase = 'open';
    j.t = s.t;
    host.sounds.door(d.lock(s.cell!.cell), true);
  }
  const t = s.t - j.t;
  const face = Math.atan2(c.x - c.outside[0], c.z - c.outside[1]);
  if (j.phase === 'open') {
    d.swing(s.cell!.cell, Math.min(1, t / JAIL.open));
    s.model.root.rotation.y += wrap(face - s.model.root.rotation.y) * 0.2;
    if (t < JAIL.open) return false;
    j.phase = 'step';
    j.t = s.t;
    j.from.copy(pos);
    return false;
  }
  if (j.phase === 'step') {
    const k = Math.min(1, t / JAIL.step);
    pos.x = THREE.MathUtils.lerp(j.from.x, c.threshold[0], k);
    pos.z = THREE.MathUtils.lerp(j.from.z, c.threshold[1], k);
    s.model.walking = k < 1;
    if (k < 1) return false;
    // A shove from behind.
    s.guard?.person.reach();
    j.phase = 'fly';
    j.t = s.t;
    j.from.copy(pos);
    s.state = 'fly';
    return false;
  }
  if (j.phase === 'fly') {
    const k = Math.min(1, t / JAIL.fly);
    const spot = s.cell!.spot;
    pos.set(THREE.MathUtils.lerp(j.from.x, spot.x, k), THREE.MathUtils.lerp(j.from.y, spot.y, k) + Math.sin(k * Math.PI) * 0.9, THREE.MathUtils.lerp(j.from.z, spot.z, k));
    s.model.root.rotation.y += wrap(spot.rotY - s.model.root.rotation.y) * Math.min(1, k * 0.35);
    s.model.root.rotation.x = Math.sin(k * Math.PI) * -0.5;
    s.model.walking = false;
    if (k < 1) return false;
    // In a heap on the straw: from here on it's the jail's, sat where it landed.
    host.sounds.thud(pos.clone());
    host.jail.release(s.id);
    s.model.root.removeFromParent();
    s.model.dispose();
    s.state = 'done';
    j.phase = 'shut';
    j.t = s.t;
    return false;
  }
  // The door slams.
  const k = Math.min(1, t / JAIL.shut);
  d.swing(s.cell!.cell, 1 - k * k);
  if (k < 1) return false;
  host.sounds.door(d.lock(s.cell!.cell), false);
  s.guard?.person.holdOn(false);
  return true;
}
