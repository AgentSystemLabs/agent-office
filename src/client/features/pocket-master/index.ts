/** Pocket's root conversation owns the existing elevated loft desk, never a regular worker seat. */
import * as THREE from 'three';
import { LOFT } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { hintTitle, key, onE } from '../../core/hint';
import { readPocketBootstrap } from '../../shared/pocket/bootstrap';
import { onPocketSnapshot } from '../../shared/pocket/native';
import { validPocketMaster, type PocketSnapshot } from '../../shared/pocket/wire';
import { mesh, textPlane, toonUnique } from '../../world/toon';
import type { Interactable } from '../../world/types';

// The kind owns only E/click. It has no hire, dismiss, model, or standalone terminal actions.
declare module '../../world/types' {
  interface InteractKinds {
    pocketmaster: true;
  }
}

export const MASTER_LOFT = {
  x: (LOFT.minX + LOFT.maxX) / 2 + 0.5,
  y: LOFT.y,
  z: (LOFT.minZ + LOFT.maxZ) / 2 - 0.3,
} as const;

interface Options {
  initial?: PocketSnapshot | null;
  text?: typeof textPlane;
  watch?: typeof onPocketSnapshot;
}

export function installPocketMaster(ctx: Ctx, options: Options = {}): { dispose(): void } {
  let snapshot = options.initial === undefined ? readPocketBootstrap()?.snapshot : options.initial;
  const source = snapshot?.source;
  const text = options.text ?? textPlane;
  const decorations = new THREE.Group();
  decorations.name = 'pocket-master-loft';
  const it: Interactable = { kind: 'pocketmaster', ...MASTER_LOFT, radius: 2.7, off: true };
  const offInteraction = ctx.interactions.define('pocketmaster', {
    reach: 3.5,
    hint: () => ({ k: `${snapshot?.master?.title}:${snapshot?.master?.busy}`, parts: [
      hintTitle(`Master · ${snapshot?.master?.title ?? 'Root conversation'}`), key('E', 'Open root conversation'),
    ] }),
    use: onE(() => { if (!it.off && snapshot?.master) ctx.net.openPocketSession(snapshot.master.workerId); }),
  });
  if (source === undefined) return { dispose: offInteraction };

  const office = ctx.office;
  const desk = office.bossScreen.parent!;
  const oldSeat = office.interactables.find(i => i.seatId === 'boss-chair');
  const oldSeatOff = oldSeat?.off;
  const oldLabels = ['loft-desk-label', 'loft-inside-label', 'loft-outside-label']
    .map(name => office.group.getObjectByName(name)).filter((o): o is THREE.Object3D => !!o);
  const previousInteractions = new Map<THREE.Object3D, unknown>();
  desk.traverse(o => {
    if (o.userData.interact) previousInteractions.set(o, o.userData.interact);
  });
  previousInteractions.set(desk, desk.userData.interact);
  office.group.add(decorations);
  const offUsable = ctx.usables.add({ usable: () => it.off ? [] : [it] });

  const clear = () => {
    decorations.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
        const map = (material as THREE.MeshBasicMaterial).map;
        map?.dispose();
        material.dispose();
      }
    });
    decorations.clear();
  };
  const update = (next: PocketSnapshot) => {
    if (next.source !== source || !validPocketMaster(next)) return;
    const before = JSON.stringify(snapshot?.master);
    snapshot = next;
    const master = next.master;
    if (!it.off && before === JSON.stringify(master)) return;
    it.off = !master;
    for (const label of oldLabels) label.visible = !master;
    if (oldSeat) oldSeat.off = master ? true : oldSeatOff;
    for (const [object, previous] of previousInteractions) object.userData.interact = master ? it : previous;
    clear();
    ctx.hint.invalidate();
    if (!master) return;
    const addText = (label: string, x: number, y: number, z: number, scale: number, bg = '#ffd166') => {
      const plane = text(label.slice(0, 160), { bg, color: '#242638', size: 64 });
      plane.scale.multiplyScalar(Math.min(scale, 7 / plane.geometry.parameters.width));
      plane.position.set(x, y, z);
      plane.rotation.y = Math.PI;
      plane.userData.interact = it;
      decorations.add(plane);
    };
    // The existing loft slab and stair colliders are the raised platform. No lower desk is moved.
    addText('MASTER · ROOT CHAT', (LOFT.minX + LOFT.maxX) / 2, LOFT.y + LOFT.height + 0.2, LOFT.minZ - 0.09, 1.3);
    addText('MASTER', MASTER_LOFT.x, LOFT.y + 0.5, MASTER_LOFT.z - 0.56, 0.55);
    addText(master.title, LOFT.maxX - 3, LOFT.y + 2.35, LOFT.maxZ - 0.05, 0.8, '#fffaf3');
    const status = master.busy === undefined ? 'STATUS UNKNOWN' : master.busy ? 'WORKING' : 'IDLE';
    addText(`MASTER · ${status}`, MASTER_LOFT.x, LOFT.y + 1.65, MASTER_LOFT.z - 0.3, 0.55,
      master.busy === undefined ? '#d8dce2' : master.busy ? '#a7e5b0' : '#f6df9d');
    const indicator = mesh(new THREE.SphereGeometry(0.1, 12, 8), toonUnique(master.busy === undefined ? '#8f99a6' : master.busy ? '#28b463' : '#e9b949'),
      MASTER_LOFT.x + 0.62, LOFT.y + 1.2, MASTER_LOFT.z - 0.22);
    indicator.userData.interact = it;
    decorations.add(indicator);
    ctx.hint.invalidate();
  };
  update(snapshot!);
  const offSnapshot = (options.watch ?? onPocketSnapshot)(update);
  const dispose = () => {
    offSnapshot(); offUsable(); offInteraction();
    for (const label of oldLabels) label.visible = true;
    if (oldSeat) oldSeat.off = oldSeatOff;
    for (const [object, previous] of previousInteractions) object.userData.interact = previous;
    decorations.removeFromParent(); clear();
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return { dispose };
}
