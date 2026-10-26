import * as THREE from 'three';
import type { WorkerProfile } from '../../../shared/worker-profiles';
import { waitingProfiles } from '../../../shared/roster-presence';
import { deskBuilt } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { h } from '../../ui/dom';
import { openWorkerProfiles } from '../../ui/worker-profiles';
import { Worker } from '../../world/character';
import type { Interactable } from '../../world/types';
import './ui.css';

declare module '../../world/types' {
  interface InteractKinds { roster: true; }
}

/** Shows the whole configured team without starting terminals, charging tokens or releasing holds. */
export function installRoster(ctx: Ctx) {
  const group = new THREE.Group();
  group.name = 'named-team-presence';
  ctx.scene.add(group);
  let profiles: WorkerProfile[] = [];
  let generation = 0;
  let drawn = '';
  const models: Worker[] = [];
  let items: Interactable[] = [];
  const people = new WeakMap<Interactable, WorkerProfile>();
  const badge = h('button.btn.dock-btn', { id: 'roster-team', type: 'button', hidden: true, onclick: () => openWorkerProfiles() }) as HTMLButtonElement;
  document.getElementById('hud')!.append(badge);

  function clear() {
    for (const model of models) { model.root.removeFromParent(); model.dispose(); }
    models.length = 0;
    items = [];
  }

  function draw() {
    const signature = JSON.stringify([store.floor, ctx.plan().id, store.floorPlan.wing, store.theme.active, profiles, [...store.workers.values()].map(worker => [worker.name, worker.deskId])]);
    if (signature === drawn) return;
    drawn = signature;
    clear();
    badge.hidden = !profiles.length;
    badge.textContent = `👔 Team ${profiles.length}`;
    badge.title = `${profiles.filter(profile => profile.enabled).length} available · ${profiles.filter(profile => !profile.enabled).length} held · assigned workers shown separately under Workers`;
    group.userData.rosterCount = profiles.length;
    if (!ctx.inOffice()) return;
    const seats = [...ctx.world().desks.values()].filter(desk => !desk.def.station && !desk.def.room && !desk.def.beanbag && deskBuilt(desk.def, store.floorPlan.wing) && !store.workerAtDesk(desk.def.id));
    waitingProfiles(profiles, store.workers.values()).forEach((profile, index) => {
      const model = new Worker(profile.name, profile.enabled ? '#06a877' : '#b88748');
      model.setStatus('idle', false);
      model.setCostume(store.theme.active);
      model.setTask({ name: profile.enabled ? 'Available · give a task' : 'Held by source', summary: profile.holds.join('; ') || profile.description });
      const seat = seats[index];
      if (seat) {
        seat.seatAnchor.updateWorldMatrix(true, false);
        seat.seatAnchor.getWorldPosition(model.root.position);
        seat.seatAnchor.getWorldQuaternion(model.root.quaternion);
      } else {
        // The open aisle east of the desk pods: a standing team area once the desks fill up.
        const slot = index - seats.length;
        model.root.position.set(4.4 + (slot % 2) * 2, 0, -7 + Math.floor(slot / 2) * 2.1);
      }
      const it: Interactable = { kind: 'roster', x: model.root.position.x, z: model.root.position.z, radius: 0.9 };
      model.root.userData.interact = it;
      people.set(it, profile);
      items.push(it);
      group.add(model.root);
      models.push(model);
    });
    group.userData.waitingCount = models.length;
  }

  async function load() {
    const current = ++generation;
    profiles = [];
    draw();
    if (!store.floor) return;
    try {
      const response = await fetch(`/api/worker-profiles?floor=${encodeURIComponent(store.floor)}`, { cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      if (current !== generation) return;
      profiles = result.profiles;
      draw();
    } catch { /* The team's window can retry; an unavailable roster never spawns a default worker. */ }
  }

  store.on('floor', () => void load());
  store.on('workers', draw);
  store.on('theme', draw);
  store.on('floorPlan', draw);
  ctx.ticks.add('others', ({ dt, t }) => {
    group.visible = ctx.inOffice();
    for (const model of models) model.update(dt, t);
  });
  ctx.usables.add({ usable: () => items, pickable: () => group });
  ctx.interactions.define('roster', {
    reach: 3.5,
    hint: it => {
      const profile = people.get(it);
      return { k: profile?.id ?? '', parts: [hintTitle(profile?.name ?? 'Team member'), aside(profile?.enabled ? 'Available · no task running' : 'Held by source'), key('E', 'View profile')] };
    },
    use: onE(it => openWorkerProfiles(people.get(it)?.id)),
  });
}
