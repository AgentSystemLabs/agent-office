/**
 * The merge gong: E bangs it, and the office rings it for everyone on the floor when a pull request
 * merges (a dance party under a confetti rain) or the task queue empties (three strokes and a party).
 */
import * as THREE from 'three';
import type { GongWhy } from '../../../shared/protocol';
import { isAsleep } from '../../../shared/status';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store, workerForPull } from '../../state';
import type { Stage, Worker } from '../../world/character';
import type { Area } from '../../world/confetti';
import type { Court } from '../../world/court';
import type { DeskView } from '../../world/types';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    gong: true;
  }
}

export interface GongDeps {
  /** Confetti over a desk: above its worker's head, wherever it is (see burstOver in features/workers/views.ts). */
  burstOver(deskId: string, n: number): void;
  /** The workers on this floor, as they're drawn at their desks. */
  workerViews: ReadonlyMap<string, { deskId: string; model: Worker }>;
  /** On a castle-style map, its workers walking between their seats and the line for the throne (see Court). */
  court(): Court | null;
  /** The board agents waiting by their boards on this map. */
  idleAgents(): readonly { model: Worker; view: DeskView }[];
}

export function installGong(ctx: Ctx, deps: GongDeps) {
  let lastHit = 0;
  /** E at the gong. The office rings it for everyone on the floor, you included (see gongRang). */
  function hitGong() {
    const now = performance.now();
    if (now - lastHit < 500) return;
    lastHit = now;
    ctx.net.send({ t: 'gong' });
  }

  ctx.interactions.define('gong', {
    reach: 3.5,
    hint: () => ({ k: '', parts: [hintTitle('🎉 Merge gong'), aside('rings when a PR merges'), key('E', 'Bang it')] }),
    use: onE(() => hitGong()),
  });

  /** Where a worker at `desk` climbs up to dance, in the frame of whatever it sits or stands in. */
  function stageOf(desk: DeskView, model: Worker): Stage {
    const seat = model.root.parent!;
    seat.updateWorldMatrix(true, false);
    desk.stage.updateWorldMatrix(true, false);
    const m = seat.matrixWorld.clone().invert().multiply(desk.stage.matrixWorld);
    const pos = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    m.decompose(pos, turn, new THREE.Vector3());
    const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(turn);
    return { pos, yaw: Math.atan2(ahead.x, ahead.z) };
  }

  /** A pull request merged: every worker awake on the floor gets up on its desk and dances. */
  function danceParty() {
    const court = deps.court();
    for (const [id, v] of deps.workerViews) {
      const desk = ctx.world().desks.get(v.deskId);
      if (!desk || isAsleep(store.workers.get(id)?.status ?? 'offline')) continue;
      // Up and about, away from its desk: a jump for joy where it stands.
      if (court?.away(id)) v.model.cheer(4);
      else v.model.dance(stageOf(desk, v.model));
    }
    // The board agents still waiting to be asked, too.
    for (const a of deps.idleAgents()) if (a.view.vacancy.visible) a.model.dance(stageOf(a.view, a.model));
  }

  /** Confetti a square meter of floor gets when a pull request merges, and the most there is in all. */
  const CONFETTI_DENSITY = 3.5;
  const CONFETTI_MOST = 4000;
  const floorArea = (a: Area) => (a.maxX - a.minX) * (a.maxZ - a.minZ);

  ctx.messages.on('gong', (msg) => gongRang(msg.why, msg.pr));
  /** Someone hit the gong, a pull request merged (a dance party under a confetti rain), or the queue emptied (a party). */
  function gongRang(why: GongWhy, pr?: number) {
    const world = ctx.world();
    const confetti = ctx.confetti;
    const gong = world.gong;
    gong?.strike(why === 'hit' ? 0.7 : 1);
    ctx.sound.gong(why);
    // Where confetti bursts from: over the gong, or with no gong, over where you are.
    const player = ctx.player;
    const top = gong?.top ?? new THREE.Vector3(player.pos.x, player.pos.y + 3, player.pos.z);
    if (why === 'merged') {
      // Confetti rains down all over the floor, and pops over the desk the PR came from while its worker's still there.
      const area = world.rain.reduce((n, r) => n + floorArea(r.area), 0);
      const density = Math.min(CONFETTI_DENSITY, CONFETTI_MOST / Math.max(1, area));
      for (const r of world.rain) confetti.rain(r.area, floorArea(r.area) * density, 3, r.top);
      const it = store.pulls.items.find((p) => p.number === pr);
      const w = pr === undefined ? undefined : workerForPull(store.workers.values(), it ?? { number: pr, headRefName: '' });
      if (w && deps.workerViews.has(w.id)) deps.burstOver(w.deskId, 220);
      else confetti.burst(top.x, top.y, top.z, 220);
      danceParty();
    } else if (why === 'queue') {
      // Three strokes (sound.gong plays them): a burst at the gong, then every desk, then a cannon.
      confetti.burst(top.x, top.y, top.z, 160);
      setTimeout(() => {
        gong?.strike(0.85);
        for (const [id, v] of deps.workerViews) {
          deps.burstOver(v.deskId, 120);
          if (!isAsleep(store.workers.get(id)?.status ?? 'offline')) v.model.cheer(4);
        }
      }, 850);
      setTimeout(() => {
        gong?.strike(1.2);
        confetti.burst(top.x, top.y, top.z, 450, 1.5);
      }, 1700);
    }
  }
}
