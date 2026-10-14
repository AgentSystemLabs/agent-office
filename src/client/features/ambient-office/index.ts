import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { CAST_BY_ID } from './cast';
import { readPreferences } from './notes';
import { sampleOffice } from './simulation';
import { ambientPanel } from './ui';
import { AmbientWorld, type AmbientSpace } from './world';

declare module '../../world/types' {
  interface InteractKinds {
    ambientnpc: true;
  }
}

export function installAmbientOffice(ctx: Ctx, space?: AmbientSpace) {
  const preferences = readPreferences();
  const world = new AmbientWorld(space);
  ctx.scene.add(world.root);
  let busy: string | null = null;
  const sample = () => {
    const next = sampleOffice(Date.now(), store.floor ?? 'office');
    return space?.adapt(next) ?? next;
  };
  let snapshot = sample();
  let sampledAt = 0;
  const panel = ambientPanel({ snapshot: () => snapshot, floor: () => store.floor ?? 'office', preferences, busy: (id) => { busy = id; } });

  ctx.usables.add({ usable: () => world.usable(), pickable: () => world.root });
  ctx.interactions.define('ambientnpc', {
    reach: 3.5,
    hint: (it) => {
      const p = CAST_BY_ID.get(it.decorId ?? '');
      return { k: `ambient:${p?.id}`, parts: [hintTitle(p?.name ?? 'Coworker'), aside('optional · their day continues'), key('E', 'Say hello / work scratchpad')] };
    },
    use: onE((it) => panel.open(it.decorId)),
  });
  store.on('floor', () => {
    panel.close();
    sampledAt = 0;
    busy = null;
  });
  ctx.ticks.add('world', ({ dt, t }) => {
    const now = Date.now();
    if (now - sampledAt >= 300 || sampledAt === 0) {
      sampledAt = now;
      snapshot = sample();
      panel.paint();
    }
    const available = !!store.floor && ctx.inOffice() && !ctx.upTop() && !ctx.trip() && ctx.player.pos.y > -1;
    panel.badge.hidden = !available;
    world.update(snapshot, dt, t, available && preferences.enabled, preferences.quiet, busy, ctx.player.pos, ctx.me.emoteId);
  });
}
