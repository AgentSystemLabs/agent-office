import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DESKS, DESK_SIZE, LOFT, STAIRS } from '../src/shared/layout';
import { Interactions, Usables } from '../src/client/core/registry';
import type { Ctx, OfficeInteraction } from '../src/client/core/context';
import { installPocketMaster, MASTER_LOFT } from '../src/client/features/pocket-master';
import { PocketOverlay } from '../src/client/shared/pocket/overlay';
import { validPocketMaster, pocketWelcome, type PocketSnapshot } from '../src/client/shared/pocket/wire';
import type { textPlane } from '../src/client/world/toon';
import type { Interactable } from '../src/client/world/types';

const snapshot = (busy = false): PocketSnapshot => ({ source: 10, title: 'Root', cwd: '/project', you: 'me', peers: [], chat: [], workers: [],
  master: { workerId: 'pocket-master-10', title: 'Root master title', busy } });

test('Master stays separate from all 16 regular desks and uses the existing elevated platform and stairs', () => {
  assert.equal(DESKS.length, 16);
  assert.ok(MASTER_LOFT.y > DESK_SIZE.height + 2);
  assert.equal(MASTER_LOFT.y, LOFT.y);
  assert.ok(MASTER_LOFT.x - 1.3 > LOFT.minX);
  assert.ok(MASTER_LOFT.x + 1.3 < LOFT.maxX);
  assert.ok(MASTER_LOFT.z - 0.6 > LOFT.minZ);
  assert.ok(MASTER_LOFT.z + 0.6 < LOFT.maxZ);
  assert.equal(STAIRS.toX, LOFT.minX);
  const welcome = pocketWelcome(snapshot());
  assert.equal(welcome.workers.length, 0);
  assert.equal(welcome.floors[0].workers, 0);
  assert.equal(validPocketMaster(snapshot()), true);
  assert.equal(validPocketMaster({ ...snapshot(), master: undefined }), true);
  assert.equal(validPocketMaster({ ...snapshot(), master: { workerId: 'pocket-master-10', title: 'Old SDK' } }), true);
  assert.equal(validPocketMaster({ ...snapshot(), master: { ...snapshot().master!, workerId: 'pocket-master-20' } }), false);
});

test('Master registry opens only the root inspector, updates live status, and restores the original loft on disposal', () => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    const group = new THREE.Group();
    const desk = new THREE.Group();
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    const oldSeat: Interactable = { kind: 'seat', seatId: 'boss-chair', x: MASTER_LOFT.x, y: LOFT.y, z: MASTER_LOFT.z + 1, radius: 1.2 };
    screen.userData.interact = oldSeat;
    desk.add(screen); group.add(desk);
    for (const name of ['loft-desk-label', 'loft-inside-label', 'loft-outside-label']) {
      const label = new THREE.Group(); label.name = name; group.add(label);
    }
    const interactions = new Interactions<OfficeInteraction>();
    const usables = new Usables<Interactable, THREE.Object3D>();
    const calls: string[] = [];
    let watch: ((s: PocketSnapshot) => void) | undefined;
    let stopped = false;
    const ctx = { office: { group, bossScreen: screen, interactables: [oldSeat] }, interactions, usables,
      net: { openPocketSession: (id: string) => calls.push(id) }, hint: { invalidate() {} } } as unknown as Ctx;
    const feature = installPocketMaster(ctx, { initial: snapshot(),
      text: ((label: string) => {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.5), new THREE.MeshBasicMaterial());
        plane.name = label; return plane;
      }) as typeof textPlane,
      watch: fn => { watch = fn; return () => { stopped = true; }; },
    });
    assert.deepEqual(calls, [], 'rendering must not open or start model work');
    assert.equal(oldSeat.off, true);
    assert.equal(group.getObjectByName('loft-desk-label')!.visible, false);
    assert.ok(group.getObjectByName('MASTER · IDLE'));
    const it = usables.lists()[0][0];
    assert.equal(it.kind, 'pocketmaster');
    assert.equal(it.deskId, undefined);
    assert.equal(screen.userData.interact, it);
    interactions.use(it, 'X', null);
    interactions.use(it, 'P', null);
    assert.deepEqual(calls, []);
    interactions.use(it, 'E', null);
    assert.deepEqual(calls, ['pocket-master-10']);
    watch!(snapshot(true));
    assert.ok(group.getObjectByName('MASTER · WORKING'));
    assert.equal(group.getObjectByName('MASTER · IDLE'), undefined);
    watch!({ ...snapshot(), source: 20, master: { workerId: 'pocket-master-20', title: 'Other root', busy: false } });
    interactions.use(it, 'E', null);
    assert.deepEqual(calls, ['pocket-master-10', 'pocket-master-10']);
    watch!({ ...snapshot(), master: { workerId: 'pocket-master-10', title: 'Old SDK' } });
    assert.ok(group.getObjectByName('MASTER · STATUS UNKNOWN'));
    assert.equal(group.getObjectByName('MASTER · IDLE'), undefined);
    watch!({ ...snapshot(), master: undefined });
    assert.equal(usables.lists()[0].length, 0);
    assert.equal(oldSeat.off, undefined);
    assert.equal(screen.userData.interact, oldSeat);
    feature.dispose();
    assert.equal(stopped, true);
    assert.equal(interactions.has('pocketmaster'), false);
    assert.equal(group.getObjectByName('pocket-master-loft'), undefined);
    assert.equal(group.getObjectByName('loft-desk-label')!.visible, true);
  } finally {
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('parent overlay sentinel has an idempotent modal lifecycle and closes on disposal', () => {
  let opens = 0;
  let closes = 0;
  const overlay = new PocketOverlay(() => { opens++; return { close: () => { closes++; } }; });
  overlay.set(false);
  overlay.set(true); overlay.set(true);
  assert.equal(opens, 1);
  overlay.set(false); overlay.set(false);
  assert.equal(closes, 1);
  overlay.set(true); overlay.close(); overlay.close();
  assert.equal(opens, 2);
  assert.equal(closes, 2);
});
