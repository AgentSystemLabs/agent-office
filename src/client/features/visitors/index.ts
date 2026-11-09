/**
 * Visitors: Claude Code sessions the office didn't start (the Claude desktop app, a terminal, an
 * IDE), waiting by the elevator of the floor whose repository they work in (or of the building's
 * first floor, its lobby, when no floor's is theirs), each with a card saying what it's called and
 * what it's on, and its subagents round it. Only to look at: nothing here can drive them, and the
 * office never writes to their files (see server/visitors/).
 */
import * as THREE from 'three';
import type { Visitor, VisitorApp } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { aside, hintTitle } from '../../core/hint';
import { noOutline } from '../../core/outline';
import { store } from '../../state';
import { SubagentCrowd, Worker, subagentColor } from '../../world/character';
import { VISITOR_SPOTS, subagentSpot } from './spots';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    visitor: true;
  }
}

/** How big a visitor's subagents are, next to it. */
const SUBAGENT_SIZE = 0.5;

const APP: Record<VisitorApp, string> = {
  desktop: '🖥️ Claude app',
  cli: '⌨️ Terminal',
  ide: '🧩 IDE',
  other: '🤖 Claude Code',
};

interface VisitorView {
  model: Worker;
  holder: THREE.Group;
  crowd: SubagentCrowd;
  status: string;
}

/** What a visitor's card says: its title, and where it is and what it's doing. */
export function visitorCard(v: Visitor): { name: string; summary: string } {
  const where = `${v.lobby ? '🛎️ ' : ''}${v.folder}${v.branch ? ` (${v.branch})` : ''}`;
  return { name: v.title, summary: v.activity ? `${where} · ${v.activity}` : where };
}

/** Follows the floor's visitors (the 'visitors' topic), and their tick ('others'). */
export function installVisitors(ctx: Ctx) {
  const views = new Map<string, VisitorView>();
  const group = new THREE.Group();
  ctx.scene.add(group);
  noOutline(group);

  function drop(id: string) {
    const v = views.get(id);
    if (!v) return;
    v.crowd.dispose();
    v.holder.removeFromParent();
    v.model.dispose();
    views.delete(id);
  }

  function sync() {
    const list = store.visitors.visitors.slice(0, VISITOR_SPOTS.length);
    const ids = new Set(list.map((v) => v.id));
    for (const id of [...views.keys()]) if (!ids.has(id)) drop(id);
    list.forEach((v, i) => {
      let view = views.get(v.id);
      if (!view) {
        const holder = new THREE.Group();
        const model = new Worker(APP[v.app], subagentColor(v.id));
        holder.add(model.root);
        group.add(holder);
        view = { model, holder, crowd: new SubagentCrowd(holder, subagentSpot, SUBAGENT_SIZE), status: '' };
        views.set(v.id, view);
      }
      const [x, z, rotY] = VISITOR_SPOTS[i];
      view.holder.position.set(x, 0, z);
      view.holder.rotation.y = rotY;
      if (view.status !== v.status) {
        view.status = v.status;
        // Waiting on you in its own app: it hops, the way a worker that needs you does.
        view.model.setStatus(v.status, v.status === 'needs_input');
      }
      view.model.setTask(visitorCard(v));
      view.crowd.sync(v.subagents, v.subagentCount - v.subagents.length);
    });
    group.visible = ctx.inOffice();
  }
  store.on('visitors', sync);

  ctx.ticks.add('others', ({ dt, t }) => {
    if (!group.visible) return;
    for (const v of views.values()) {
      v.model.update(dt, t);
      v.crowd.update(dt, t);
    }
  });

  // Aimed at, a visitor says who it is; there's nothing to press: it's someone else's session.
  ctx.usables.add({
    usable: () => (group.visible ? store.visitors.visitors.slice(0, VISITOR_SPOTS.length).map((v, i) => ({ kind: 'visitor' as const, x: VISITOR_SPOTS[i][0], z: VISITOR_SPOTS[i][1], radius: 0.6, seatId: v.id })) : []),
    pickable: () => group,
  });
  ctx.interactions.define('visitor', {
    reach: 4,
    hint: (it) => {
      const v = store.visitors.visitors.find((x) => x.id === it.seatId);
      if (!v) return { k: 'visitor', parts: [hintTitle('👋 A visitor')] };
      const subs = v.subagentCount ? ` · ${v.subagentCount} subagent${v.subagentCount === 1 ? '' : 's'}` : '';
      return { k: `visitor|${v.id}|${v.status}|${v.subagentCount}`, parts: [hintTitle(`👋 ${v.title}`), aside(`${APP[v.app]} · ${v.folder}${subs} · only to look at`)] };
    },
    use: () => {},
  });
}
