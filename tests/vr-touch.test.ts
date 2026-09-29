import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VRSession, type VRHooks } from '../src/client/vr/session.js';
import { pickTouchTarget } from '../src/client/world/touch.js';
import { buildCoffeeMachine } from '../src/client/world/coffee.js';
import { buildGong } from '../src/client/world/gong.js';
import type { Interactable } from '../src/client/world/office.js';
import { GONG } from '../src/shared/layout.js';

function canvasStub(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = {
    measureText: (text: string) => ({ width: text.length * 26 }),
    setTransform() {},
    clearRect() {},
    fillText() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    stroke() {},
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
}

function coffeeFixture() {
  const it: Interactable = { kind: 'coffee', x: -15.7, z: 10.9, radius: 1.4 };
  const { machine: group, cup } = buildCoffeeMachine(it);
  group.position.set(-15.7, 1.03, 12.2);
  return { it, group, cup };
}

test('the coffee machine has no hand contact: VR coffee comes from grabbing its cup', () => {
  const { it, group, cup } = coffeeFixture();
  assert.equal(it.touch, undefined);
  for (const [x, y, z] of [
    [0, 0.35, -0.27],
    [0.18, 0.55, 0.33],
    [0, 0.1, 0.12],
  ]) {
    assert.equal(pickTouchTarget(group.localToWorld(new THREE.Vector3(x, y, z)), [[it]]), null, `casing/button/cup at ${x},${y},${z}`);
  }
  assert.equal(cup.userData.grabbable, 'coffee');
  assert.equal(cup.parent, group);
  assert.equal(it.radius, 1.4, 'desktop radius is unchanged');
});

test('touch volumes respect parent transforms, hidden floors and disabled targets', (t) => {
  canvasStub(t);
  const gong = buildGong();
  const it = gong.interactable;
  const local = new THREE.Vector3(0, GONG.height - 0.34 - 1.02, 0.1);
  const pick = () => pickTouchTarget(gong.group.localToWorld(local.clone()), [[it]]);
  const parent = new THREE.Group();
  parent.position.set(4, 3, -2);
  parent.rotation.y = 1.2;
  parent.add(gong.group);
  parent.updateMatrixWorld(true);
  assert.equal(pick(), it, 'world-space joints respect parent transforms');
  parent.visible = false;
  assert.equal(pick(), null, 'hidden floor');
  parent.visible = true;
  it.off = true;
  assert.equal(pick(), null, 'disabled target');
  it.off = false;
  assert.equal(pickTouchTarget(gong.group.localToWorld(local.clone()), [[]]), null, 'other floors do not participate');
});

test('gong contact is limited to the disc and its swing cannot rearm a stationary hand', (t) => {
  canvasStub(t);
  const gong = buildGong();
  const discY = GONG.height - 0.34 - 1.02;
  const point = gong.group.localToWorld(new THREE.Vector3(0, discY, 0.1));
  const pick = (x: number, y: number, z: number) => pickTouchTarget(gong.group.localToWorld(new THREE.Vector3(x, y, z)), [[gong.interactable]]);
  assert.equal(pickTouchTarget(point, [[gong.interactable]]), gong.interactable);
  assert.equal(pick(0.6, discY, 0.04), gong.interactable, 'disc rim');
  assert.equal(pick(0.6, discY + 0.6, 0.04), null, 'not the empty corners of a bounding box');
  assert.equal(pick(GONG.width / 2, discY, 0), null, 'frame');
  assert.equal(pick(0, discY, 0.3), null, 'walking in front is not contact');
  gong.strike();
  for (let i = 0; i < 180; i++) {
    gong.update(1 / 60);
    assert.equal(pickTouchTarget(point, [[gong.interactable]]), gong.interactable);
  }
  gong.group.visible = false;
  assert.equal(pickTouchTarget(point, [[gong.interactable]]), null);
});

test('physical models keep their existing ray-pickable interactables', (t) => {
  canvasStub(t);
  const { group, it } = coffeeFixture();
  const gong = buildGong();
  for (const [object, expected, center] of [
    [group, it, new THREE.Vector3(0, 0.35, 0)],
    [gong.group, gong.interactable, new THREE.Vector3(0, GONG.height - 1.36, 0)],
  ] as const) {
    const target = object.localToWorld(center);
    object.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(target.clone().add(new THREE.Vector3(0, 0, 2)), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(object, true)[0];
    assert.ok(hit);
    let found: Interactable | undefined;
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) found ??= o.userData.interact;
    assert.equal(found, expected);
  }
});

/** Drive the real session input methods with tracked Three joints, without a WebGL renderer. */
type SessionUnderTest = Pick<VRSession, 'active' | 'update'> & {
  rays: VRSession['rays'];
  fade: VRSession['fade'];
  onConnected: VRSession['onConnected'];
  onDisconnected: VRSession['onDisconnected'];
  onSelectStart: VRSession['onSelectStart'];
  updateTouches: VRSession['updateTouches'];
  updateHolds: VRSession['updateHolds'];
  grab: Pick<NonNullable<VRSession['grab']>, 'owns'> | null;
};

function sessionFixture(t: TestContext) {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const hands = [0, 1].map(() => {
    const hand = Object.assign(new THREE.Group(), { joints: {} }) as THREE.XRHandSpace;
    for (const name of ['index-finger-tip', 'middle-finger-metacarpal'] as const) {
      const joint = new THREE.Group() as THREE.XRJointSpace;
      joint.position.set(100, 100, 100);
      hand.joints[name] = joint;
      hand.add(joint);
    }
    return hand;
  });
  const renderer = {
    xr: {
      getController: () => new THREE.Group(),
      getControllerGrip: () => new THREE.Group(),
      getHand: (i: number) => hands[i],
    },
  } as unknown as THREE.WebGLRenderer;
  const calls: Interactable[] = [];
  const target: Interactable = { kind: 'gong', x: 0, z: 0, radius: 1.5 };
  const hooks = {
    player: { rig: null },
    useE: (it: Interactable) => calls.push(it),
    touchTarget: (point: THREE.Vector3) => (point.distanceTo(new THREE.Vector3(0, 1, 0)) < 0.1 ? target : null),
    reachAnim() {},
    noteUnder: () => null,
    carrying: () => null,
  } as unknown as VRHooks;
  const session = new VRSession(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), hooks) as unknown as SessionUnderTest;
  session.active = true;
  for (let i = 0; i < 2; i++) session.onConnected(i, { hand: {}, handedness: i === 0 ? 'left' : 'right' } as XRInputSource);
  const rays = session.rays;
  const move = (i: number, touching: boolean, name: 'index-finger-tip' | 'middle-finger-metacarpal' = 'index-finger-tip') => hands[i].joints[name]!.position.set(touching ? 0 : 1, 1, 0);
  const tick = (time: number) => {
    now = time;
    session.updateTouches();
    session.updateHolds();
  };
  return { session, hands, rays, hooks, target, calls, move, tick };
}

test('session touch dispatches once for either hand, sharing the latch until both withdraw', (t) => {
  const { calls, move, tick, target } = sessionFixture(t);
  move(0, true);
  tick(0);
  assert.deepEqual(calls, [target]);
  move(1, true, 'middle-finger-metacarpal');
  tick(200);
  move(0, false);
  tick(400);
  tick(800);
  assert.equal(calls.length, 1, 'second hand and held contact never repeat');
  move(1, false, 'middle-finger-metacarpal');
  tick(900);
  move(0, true);
  tick(950);
  assert.equal(calls.length, 1, 'edge jitter does not rearm');
  move(0, false);
  tick(1000);
  tick(1120);
  move(1, true, 'middle-finger-metacarpal');
  tick(1200);
  assert.deepEqual(calls, [target, target], 'palm contact works after both hands withdraw');
});

test('a hand holding a grabbed object touches nothing; the free hand still does', (t) => {
  const { session, calls, move, tick, target } = sessionFixture(t);
  session.grab = { owns: (ray) => ray === 0 };
  move(0, true);
  tick(0);
  tick(200);
  assert.equal(calls.length, 0, 'the held object brushing a touch zone does not activate it');
  move(1, true);
  tick(400);
  assert.deepEqual(calls, [target]);
});

test('hidden or missing joints never fire, and tracking loss alone never rearms contact', (t) => {
  const { hands, rays, calls, move, tick } = sessionFixture(t);
  move(0, true);
  hands[0].visible = false;
  tick(0);
  assert.equal(calls.length, 0);
  hands[0].visible = true;
  hands[0].joints['index-finger-tip']!.visible = false;
  tick(200);
  assert.equal(calls.length, 0);
  hands[0].joints['index-finger-tip']!.visible = true;
  tick(400);
  assert.equal(calls.length, 1);
  hands[0].visible = false;
  tick(600);
  tick(1000);
  hands[0].visible = true;
  tick(1200);
  assert.equal(calls.length, 1, 'returning tracking is not a new approach');
  hands[0].joints['index-finger-tip']!.visible = false;
  tick(1250);
  tick(1380);
  hands[0].joints['index-finger-tip']!.visible = true;
  tick(1390);
  assert.equal(calls.length, 1, 'losing only the contacting joint does not rearm either');
  rays[1].source = { handedness: 'right' } as XRInputSource;
  move(1, true);
  tick(1400);
  assert.equal(calls.length, 1, 'controllers never synthesize a hand touch');
});

test('touch consumes a same-frame pinch and its later release, but ray taps still work after withdrawal', (t) => {
  const { session, rays, calls, target, move, tick } = sessionFixture(t);
  rays[0].hover = { it: target, near: true, hit: {} as THREE.Intersection };
  rays[0].selectHeld = true;
  move(0, true);
  tick(0);
  tick(700);
  assert.equal(rays[0].hold.isAiming, false);
  move(0, false);
  tick(800);
  tick(1000);
  rays[0].selectHeld = false;
  tick(1100);
  assert.equal(calls.length, 1, 'no extra E or teleport on release');
  rays[0].selectHeld = true;
  tick(1200);
  rays[0].selectHeld = false;
  tick(1250);
  assert.equal(calls.length, 2, 'a fresh hand ray tap still works');
  rays[0].source = { handedness: 'left' } as XRInputSource;
  session.onSelectStart(0);
  assert.equal(calls.length, 3, 'controller trigger still works');
  rays[0].hover.near = false;
  session.onSelectStart(0);
  assert.equal(calls.length, 3, 'ray reach gate is preserved');
});

test('panels, climbing and teleporting suppress contact until the hand withdraws', (t) => {
  const { session, rays, hooks, calls, move, tick } = sessionFixture(t);
  let time = 0;
  const tryBlocked = (block: () => void, unblock: () => void) => {
    block();
    move(0, true);
    tick((time += 200));
    unblock();
    tick((time += 200));
    assert.equal(calls.length, 0, 'unblocking while still in contact does not fire');
    move(0, false);
    tick((time += 200));
    tick((time += 200));
  };
  tryBlocked(
    () => (rays[0].uiConsumed = true),
    () => (rays[0].uiConsumed = false),
  );
  tryBlocked(
    () => (hooks.player.rig = () => {}),
    () => (hooks.player.rig = null),
  );
  tryBlocked(
    () => (rays[1].teleportHeld = true),
    () => (rays[1].teleportHeld = false),
  );
  tryBlocked(
    () => (session.fade = 'out'),
    () => (session.fade = 'idle'),
  );
  move(0, true);
  tick((time += 200));
  assert.equal(calls.length, 1);
  session.onDisconnected(0);
  assert.equal(rays[0].touch.active, false);
  assert.equal(rays[0].touchTarget, null);
  session.active = false;
  session.update(1 / 60);
  assert.equal(calls.length, 1, 'desktop frames never poll physical input');
});
