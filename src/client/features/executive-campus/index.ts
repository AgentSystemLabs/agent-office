/** Executive World campus selection and floor-routing boundary. */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { $, h, toast } from '../../ui/dom';
import { EXECUTIVE_FLOOR_MAP, EXECUTIVE_SHARED_RUNTIME_LABEL, executiveFloorFor } from '../../../shared/executive-floor-map';
import { EXECUTIVE_MAP } from '../../../shared/maps';
import type { Interactable } from '../../world/types';

declare module '../../world/types' {
  interface InteractKinds {
    executivebuilding: true;
  }
}

function districtName(id: string): string {
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function entryFor(it: Interactable) {
  return it.decorId ? executiveFloorFor(it.decorId) : undefined;
}

export function installExecutiveCampus(ctx: Ctx) {
  const returnButton = h('button.btn', {
    id: 'executive-return-campus',
    type: 'button',
    title: 'Return to the Executive World campus map',
    onclick: () => {
      ctx.net.send({ t: 'map.set', map: EXECUTIVE_MAP });
      toast('Executive World campus restored', 'info');
    },
  }, '↩ Return to Executive World');
  returnButton.hidden = true;
  $('hud').append(returnButton);
  const syncReturnButton = () => {
    returnButton.hidden = store.floor !== 'agent-office-executive-world';
  };
  store.on('floor', syncReturnButton);
  store.on('map', syncReturnButton);
  syncReturnButton();

  const useLocation = (it: Interactable) => {
    const buildingId = it.decorId ?? '';
    if (buildingId.startsWith('district:')) {
      const id = buildingId.slice('district:'.length);
      const rooms = EXECUTIVE_FLOOR_MAP.filter((entry) => entry.districtId === id);
      toast(`${districtName(id)} · ${rooms.length} planned location${rooms.length === 1 ? '' : 's'} · select a building to inspect`, 'info');
      return;
    }
    const entry = entryFor(it);
    if (!entry) return;
    if (!entry.connected || !entry.agentOfficeFloorId) {
      toast(`${entry.displayName} · Planned / Not Connected`, 'warn');
      return;
    }
    toast(entry.destinationLabel ?? EXECUTIVE_SHARED_RUNTIME_LABEL, 'info');
    ctx.player.setView('first');
    ctx.net.send({ t: 'floor.go', floor: entry.agentOfficeFloorId });
  };

  ctx.interactions.define('executivebuilding', {
    reach: 12,
    hint: (it) => {
      const buildingId = it.decorId ?? '';
      if (buildingId.startsWith('district:')) {
        return { k: buildingId, parts: [hintTitle(districtName(buildingId.slice('district:'.length))), aside('Executive World district'), key('E', 'Inspect')] };
      }
      const entry = entryFor(it);
      const name = entry?.displayName ?? it.label ?? 'Executive World location';
      const status = entry?.connected ? 'Connected' : 'Planned / Not Connected';
      return { k: `${name}|${status}`, parts: [hintTitle(name), aside(status), key('E', entry?.connected ? 'Enter floor' : 'Inspect')] };
    },
    use: onE(useLocation),
  });

  return { entryFor };
}
