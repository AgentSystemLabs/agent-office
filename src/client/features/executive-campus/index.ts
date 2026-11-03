/** Executive World campus selection and floor-routing boundary. */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { $, h, toast } from '../../ui/dom';
import { EXECUTIVE_FLOOR_MAP, EXECUTIVE_SHARED_RUNTIME_LABEL, executiveFloorFor } from '../../../shared/executive-floor-map';
import { EXECUTIVE_MAP } from '../../../shared/maps';
import type { Interactable } from '../../world/types';

/** Review entry point for the integrated campus. This reuses Agent Office's third-person camera;
 * it is intentionally not a new camera mode or a second Executive World application. */
const EXECUTIVE_REVIEW_POSITION = { x: 0, y: 0, z: 0 } as const;
const EXECUTIVE_REVIEW_CAMERA = { yaw: 0.28, pitch: 1.02, distance: 92 } as const;

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
  const enterExecutiveOverview = () => {
    // The shared runtime can retain the connected floor ID while the map returns to Executive World.
    // The map selection, not the floor ID, determines whether the campus overview is active.
    if (store.map.pick !== EXECUTIVE_MAP) return;
    ctx.player.setView('third');
    ctx.player.pos.set(EXECUTIVE_REVIEW_POSITION.x, EXECUTIVE_REVIEW_POSITION.y, EXECUTIVE_REVIEW_POSITION.z);
    // The normal office camera keeps a player inside a building-sized room. The campus review needs
    // a larger camera envelope, while physical movement remains constrained by world colliders.
    ctx.player.room = { ...ctx.player.room, minX: -120, maxX: 120, minZ: -120, maxZ: 120, enclosed: false };
    ctx.camera.far = 180;
    ctx.player.facing = EXECUTIVE_REVIEW_CAMERA.yaw;
    ctx.player.camYaw = EXECUTIVE_REVIEW_CAMERA.yaw;
    ctx.player.camPitch = EXECUTIVE_REVIEW_CAMERA.pitch;
    ctx.player.camDist = EXECUTIVE_REVIEW_CAMERA.distance;
    ctx.player.updateCamera(true);
  };

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
  store.on('map', () => {
    syncReturnButton();
    // Store map listeners run after installMaps.applyMap(), so this is the completed map lifecycle.
    enterExecutiveOverview();
  });
  syncReturnButton();
  if (store.map.pick === EXECUTIVE_MAP && !store.floor) window.setTimeout(enterExecutiveOverview, 0);

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
    // Campus review is a wide city view; allow direct selection without requiring the Director to
    // walk to each building first. Physical movement and building collisions remain unchanged.
    reach: 36,
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
