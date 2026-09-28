import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GRAB_HOLD_MS, GRAB_REACH, VRGrab, type Grabbable } from '../src/client/vr/grab.js';
import { VRSession, type VRHooks, type VRUiSink } from '../src/client/vr/session.js';
import { HeldObjectView } from '../src/client/world/held-object.js';
import { readCarry, sameCarry } from '../src/shared/carry.js';
import type { CarriedObject, CarryPose, PeerInfo } from '../src/shared/protocol.js';
import { store, loadSettings } from '../src/client/state.js';

const pose = (): CarryPose => ({ hand: 'right', position: [0, 1, 0], quaternion: [0, 0, 0, 1] });

function canvas(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillRect() {},
          strokeRect() {},
          fillText() {},
          measureText: (text: string) => ({ width: text.length * 10 }),
        }),
      }),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
}

function rig(t: TestContext, coffee = true) {
  canvas(t);
  const scene = new THREE.Scene();
  const hand = new THREE.Group();
  hand.position.y = 1;
  scene.add(hand);
  const view = new HeldObjectView();
  t.after(() => view.dispose());
  const sent: (CarriedObject | null)[] = [];
  const used: unknown[] = [];
  const released: unknown[] = [];
  let valid = true;
  let taken = 0;
  const item: CarriedObject = coffee ? { kind: 'coffee', empty: false, pose: pose() } : { issue: 6, title: 'VR grab' };
  const target: Grabbable = {
    point: new THREE.Vector3(0, 1, 0),
    item,
    take: () => taken++,
    use: (aim) => {
      used.push(aim);
      if (item.kind === 'coffee') item.empty = true;
      else valid = false;
    },
    release: (aim) => released.push(aim),
    valid: () => valid,
    place: coffee,
    mouthUse: coffee,
  };
  const hooks = { pick: () => target, changed: (state: CarriedObject | null) => sent.push(state), ground: () => 0.75 };
  const grab = new VRGrab(scene, hooks, view);
  return { scene, hand, view, grab, target, hooks, sent, used, released, taken: () => taken, invalidate: () => (valid = false) };
}

test('grabs need physical reach, attach to the owning hand, and reject a second owner', (t) => {
  const r = rig(t);
  r.hand.position.x = GRAB_REACH + 0.01;
  assert.equal(r.grab.begin(0, 'left', r.hand), false);
  r.hand.position.x = 0.1;
  assert.equal(r.grab.begin(0, 'left', r.hand), true);
  assert.equal(r.view.root.parent, r.hand);
  assert.equal(r.grab.owns(0), true);
  assert.equal(r.grab.begin(1, 'right', r.hand), false);
  assert.equal(r.taken(), 1);
  r.hand.rotation.y = Math.PI / 2;
  r.hand.position.x = 2;
  const now = performance.now() + 100;
  r.grab.update(new THREE.Vector3(10, 10, 10), now);
  const last = r.sent.at(-1)!;
  assert.deepEqual(last.pose?.position, [2, 1, 0]);
  assert.equal(last.pose?.hand, 'left');
  assert.ok(new THREE.Quaternion().fromArray(last.pose!.quaternion).angleTo(r.hand.quaternion) < 1e-6);
  const count = r.sent.length;
  r.grab.update(new THREE.Vector3(10, 10, 10), now + 10);
  assert.equal(r.sent.length, count, 'pose sends are capped at 20Hz');
});

test('coffee is used once at the mouth, placed upright on a surface, and regrabbable empty', (t) => {
  const r = rig(t);
  r.grab.begin(1, 'right', r.hand);
  const mouth = new THREE.Vector3(0, 1, 0);
  r.grab.update(mouth, 1000);
  r.grab.update(mouth, 1349);
  assert.equal(r.used.length, 0, 'passing the face is not a sip');
  r.grab.update(mouth, 1350);
  r.grab.update(mouth, 2000);
  assert.equal(r.used.length, 1);
  assert.equal(r.sent.at(-1)?.kind, 'coffee');
  r.hand.rotation.z = 1;
  r.grab.release(0, null);
  assert.equal(r.grab.held, true, 'another hand cannot release it');
  r.grab.release(1, null);
  assert.equal(r.grab.held, false);
  assert.equal(r.view.root.parent, r.scene);
  assert.equal(r.view.root.position.y, 0.79);
  assert.deepEqual(r.view.root.quaternion.toArray(), [0, 0, 0, 1]);
  assert.equal(r.sent.at(-1)?.pose?.placed, true);
  r.hand.position.copy(r.view.root.position);
  assert.equal(r.grab.begin(0, 'left', r.hand), true);
  assert.equal(r.target.item.kind === 'coffee' && r.target.item.empty, true);
  assert.equal(r.sent.at(-1)?.pose?.placed, undefined);
  assert.equal(r.view.root.parent, r.hand);
});

test('coffee requires continuous mouth proximity and can be used by its controller trigger', (t) => {
  const r = rig(t);
  r.grab.begin(0, 'left', r.hand);
  r.grab.update(new THREE.Vector3(0, 1, 0), 1000);
  r.grab.update(new THREE.Vector3(3, 1, 0), 1300);
  r.grab.update(new THREE.Vector3(0, 1, 0), 1400);
  assert.equal(r.used.length, 0);
  assert.equal(r.grab.use(1, null), false);
  assert.equal(r.grab.use(0, null), true);
  assert.equal(r.target.item.kind === 'coffee' && r.target.item.empty, true);
});

test('issue use dispatches the aimed action and clears the physical hold when consumed', (t) => {
  const r = rig(t, false);
  r.grab.begin(0, 'left', r.hand);
  const aim = { it: { kind: 'queue' as const, x: 0, z: 0, radius: 1 }, note: null };
  assert.equal(r.grab.use(0, aim), true);
  assert.deepEqual(r.used, [aim]);
  assert.equal(r.grab.held, false);
  assert.equal(r.sent.at(-1), null);
  assert.equal(r.view.root.parent, null);
  assert.deepEqual(r.released, [], 'a completed domain action is not dispatched twice');
});

test('issue release and lifecycle cleanup run once, clear the wire, and detach geometry', (t) => {
  const r = rig(t, false);
  r.grab.begin(1, 'right', r.hand);
  const aim = { it: { kind: 'meeting' as const, x: 0, z: 0, radius: 1 }, note: null };
  r.grab.release(1, aim);
  assert.deepEqual(r.released, [aim]);
  r.grab.begin(0, 'left', r.hand);
  r.grab.clear();
  r.grab.clear();
  assert.deepEqual(r.released, [aim, null]);
  assert.equal(r.sent.at(-1), null);
  assert.equal(r.view.root.visible, false);
  assert.equal(r.view.root.parent, null);
});

test('external carry actions invalidate the hold without releasing a replacement card', (t) => {
  const r = rig(t, false);
  r.grab.begin(0, 'left', r.hand);
  r.invalidate();
  r.grab.update(new THREE.Vector3(), 1000);
  assert.equal(r.grab.held, false);
  assert.equal(r.sent.at(-1), null);
  assert.deepEqual(r.released, []);
});

test('a placed mug is cleared on lifecycle cleanup and does not block a distant new grab', (t) => {
  const r = rig(t);
  r.grab.begin(0, 'left', r.hand);
  r.grab.release(0, null);
  const next = { ...r.target, point: new THREE.Vector3(4, 1, 0) };
  r.hooks.pick = () => next;
  r.hand.position.set(4, 1, 0);
  assert.equal(r.grab.begin(1, 'right', r.hand), true);
  r.grab.release(1, null);
  r.grab.clear();
  assert.equal(r.sent.at(-1), null);
  assert.equal(r.view.root.parent, null);
});

test('peer held-object views render the transmitted pose and leave legacy cards to the avatar', (t) => {
  canvas(t);
  const view = new HeldObjectView();
  t.after(() => view.dispose());
  view.pose({ kind: 'coffee', empty: false, pose: pose() });
  assert.deepEqual(view.root.position.toArray(), [0, 1, 0]);
  assert.equal(view.root.visible, true);
  view.pose({ issue: 6, title: 'Grab', pose: { ...pose(), hand: 'left' } });
  assert.equal(view.root.visible, true);
  view.pose({ issue: 6, title: 'Grab' });
  assert.equal(view.root.visible, false);
  view.pose(null);
  assert.equal(view.root.visible, false);
});

test('carry protocol preserves desktop messages and validates coffee, poses and clear', () => {
  const peer = { x: 0, y: 0, z: 0 };
  assert.deepEqual(readCarry({ issue: 6, title: 'Grab' }, peer), { issue: 6, title: 'Grab' });
  assert.equal(readCarry({ t: 'carry' }, peer), null);
  const coffee = { kind: 'coffee' as const, empty: false, pose: pose() };
  assert.deepEqual(readCarry(coffee, peer), coffee);
  const card = { issue: 6, title: 'Grab', pose: pose() };
  assert.deepEqual(readCarry(card, peer), card);
  assert.equal(readCarry({ ...card, pose: { ...pose(), placed: true } }, peer), undefined);
  const normal = readCarry({ ...card, pose: { ...pose(), quaternion: [0, 0, 0, 1.1] } }, peer);
  assert.deepEqual(normal?.pose?.quaternion, [0, 0, 0, 1]);
  assert.equal(readCarry({ ...coffee, pose: { ...pose(), position: [8, 1, 0] } }, peer), undefined);
  assert.ok(readCarry({ ...coffee, pose: { ...pose(), position: [8, 1, 0], placed: true } }, peer));
});

test('carry protocol rejects malformed and unbounded client input', () => {
  const peer = { x: 0, y: 0, z: 0 };
  for (const value of [
    null,
    [],
    { kind: 'other' },
    { kind: 'coffee' },
    { kind: 'coffee', pose: pose(), empty: 'yes' },
    { issue: 0, title: 'No' },
    { issue: -6, title: 'No' },
    { issue: 1.2, title: 'No' },
    { issue: 6 },
    { kind: 'issue' },
    ...[
      null,
      [],
      { ...pose(), hand: 'none' },
      { ...pose(), placed: 1 },
      { ...pose(), position: [NaN, 1, 0] },
      { ...pose(), position: [Infinity, 1, 0] },
      { ...pose(), position: [0, 1] },
      { ...pose(), position: [0, 1001, 0], placed: true },
      { ...pose(), position: [10001, 0, 0], placed: true },
      { ...pose(), quaternion: [0, 0, 0, 0] },
      { ...pose(), quaternion: [0, 0, 0, 2] },
    ].map((p) => ({ kind: 'coffee', empty: false, pose: p })),
  ]) {
    assert.equal(readCarry(value, peer), undefined, JSON.stringify(value));
  }
  const truncated = readCarry({ issue: 6, title: 'x'.repeat(201), extra: 'not forwarded' }, peer);
  assert.deepEqual(truncated, { issue: 6, title: 'x'.repeat(200) });
});

test('pose-only peer updates bypass people and board redraws while keeping snapshots current', (t) => {
  let peers = 0;
  let poses = 0;
  t.after(store.on('peers', () => peers++));
  t.after(store.on('carrying', () => poses++));
  const item: CarriedObject = { issue: 6, title: 'Grab', pose: pose() };
  const peer = { id: 'other', carrying: item } as PeerInfo;
  store.apply({ t: 'peer.update', peer });
  store.apply({ t: 'peer.update', peer: { ...peer, carrying: { ...item, pose: { ...pose(), position: [1, 1, 0] } } }, carryOnly: true });
  assert.equal(peers, 1);
  assert.equal(poses, 1);
  assert.deepEqual(store.peers.get('other')?.carrying?.pose?.position, [1, 1, 0]);
  assert.equal(sameCarry(item, { ...item, pose: pose() }), true);
  assert.equal(sameCarry(item, { issue: 7, title: 'Other', pose: pose() }), false);
  assert.equal(sameCarry(item, { issue: 6, title: 'Grab' }), false);
  assert.equal(sameCarry(item, null), false);
  assert.equal(sameCarry(item, { kind: 'coffee', empty: false, pose: pose() }), false);
  assert.equal(sameCarry({ kind: 'coffee', empty: false, pose: pose() }, { kind: 'coffee', empty: true, pose: pose() }), true);
  store.apply({ t: 'peer.leave', id: 'other' });
  assert.equal(store.peers.size, 0);
});

/** Exercises the production event handlers without a WebGL context or XR hardware. */
function sessionRig(t: TestContext) {
  const r = rig(t);
  const targetRays = [new THREE.Group(), new THREE.Group()];
  const grips = [r.hand, new THREE.Group()];
  const hands = [new THREE.Group(), new THREE.Group()].map((g) => Object.assign(g, { joints: {} as Record<string, THREE.Object3D> }));
  const xr = {
    getController: (i: number) => targetRays[i],
    getControllerGrip: (i: number) => grips[i],
    getHand: (i: number) => hands[i],
  };
  let menu = 0;
  let used = 0;
  const hooks = {
    grab: r.hooks,
    player: { rig: null },
    settings: loadSettings(),
    carrying: () => null,
    closeTop: () => false,
    useE: () => used++,
    noteUnder: () => null,
  } as unknown as VRHooks;
  const session = new VRSession({ xr } as unknown as THREE.WebGLRenderer, r.scene, new THREE.PerspectiveCamera(), hooks);
  session.active = true;
  session.dolly.add(...grips, ...targetRays, ...hands);
  const ui = { toggleMenu: () => menu++, cancelRay: () => {} } as unknown as VRUiSink;
  session.setUi(ui);
  const internal = session as unknown as {
    updateHolds: () => void;
    rays: { uiConsumed: boolean; pinchHeld: boolean; hold: { isAiming: boolean; isConsumed: boolean }; pinchAnchor: THREE.Group }[];
  };
  for (const st of internal.rays) session.dolly.add(st.pinchAnchor);
  function connect(i: number, hand = false) {
    targetRays[i].dispatchEvent({ type: 'connected', data: { handedness: i === 0 ? 'left' : 'right', ...(hand ? { hand: {} } : {}) } } as never);
    if (hand) {
      for (const name of ['index-finger-tip', 'thumb-tip']) {
        const joint = new THREE.Object3D();
        joint.position.set(i, 1, 0);
        hands[i].joints[name] = joint;
        hands[i].add(joint);
      }
    }
  }
  function event(type: string, i = 0) {
    targetRays[i].dispatchEvent({ type } as never);
  }
  return { ...r, session, internal, event, connect, hands, menu: () => menu, used: () => used };
}

test('controller squeeze grabs before cancel, trigger uses, and squeeze release places', (t) => {
  const r = sessionRig(t);
  r.connect(0);
  r.event('squeezestart');
  assert.equal(r.menu(), 0);
  assert.equal(r.sent.at(-1)?.pose?.hand, 'left');
  r.event('selectstart');
  assert.equal(r.target.item.kind === 'coffee' && r.target.item.empty, true);
  assert.equal(r.used(), 0, 'held use does not also press E');
  r.event('squeezeend');
  assert.equal(r.sent.at(-1)?.pose?.placed, true);
  r.session.clearGrab();
  r.hand.position.x = 10;
  r.event('squeezestart');
  assert.equal(r.menu(), 1, 'empty-handed squeeze away retains cancel/menu');
});

test('panels own squeeze near a grabbable and a lost controller clears its carry', (t) => {
  const r = sessionRig(t);
  r.connect(0);
  r.internal.rays[0].uiConsumed = true;
  r.event('squeezestart');
  assert.equal(r.sent.length, 0);
  r.internal.rays[0].uiConsumed = false;
  r.event('squeezestart');
  r.event('disconnected');
  assert.equal(r.sent.at(-1), null);
  assert.equal(r.released.length, 1);
});

test('hand pinch union grabs before teleport, ignores squeeze events, and consumes release', (t) => {
  const r = sessionRig(t);
  r.connect(0, true);
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  r.event('selectstart');
  r.event('pinchstart');
  r.internal.updateHolds();
  now += GRAB_HOLD_MS;
  r.internal.updateHolds();
  assert.equal(r.sent.at(-1)?.pose?.hand, 'left');
  assert.equal(r.internal.rays[0].hold.isConsumed, true);
  r.event('squeezeend');
  assert.equal(r.sent.at(-1)?.pose?.placed, undefined, 'hand squeeze must not release a pinch grab');
  now += 1000;
  r.internal.updateHolds();
  assert.equal(r.internal.rays[0].hold.isAiming, false);
  assert.equal(r.menu(), 0);
  r.event('selectend');
  r.internal.updateHolds();
  assert.equal(r.sent.at(-1)?.pose?.placed, undefined, 'joint pinch still owns the hold');
  r.event('pinchend');
  r.internal.updateHolds();
  assert.equal(r.sent.at(-1)?.pose?.placed, true);
  assert.equal(r.used(), 0, 'release is not a select tap');
});

test('a hand holding an object cannot trigger the two-hand menu gesture', (t) => {
  const r = sessionRig(t);
  r.connect(0, true);
  r.connect(1, true);
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  r.event('pinchstart');
  r.event('pinchstart', 1);
  r.internal.updateHolds();
  now += 700;
  r.internal.updateHolds();
  assert.equal(r.menu(), 0);
  assert.equal(r.internal.rays[0].hold.isConsumed, true);
  r.session.clearGrab();
  assert.equal(r.sent.at(-1), null);
});
