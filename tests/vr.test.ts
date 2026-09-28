import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { describeSessionError, probeXRSupport, requestVRSession, type XrNavigator } from '../src/client/vr/support.js';
import { MENU_HOLD_MS, PINCH_HOLD_MS, PinchHold, SnapTurn, buttonDown, decodeThumbstick, faceButtons, sampleParabola, xrRayDirection, yawForFacing } from '../src/client/vr/session.js';
import { PromptBuffer } from '../src/client/vr/prompt.js';
import { VR_DEFAULTS, loadSettings, saveSettings } from '../src/client/state.js';

function nav(fake: Partial<XRSystem> | undefined): XrNavigator {
  return fake === undefined ? {} : { xr: fake as XrNavigator['xr'] };
}

test('probe hides Enter VR without XR, and says why on insecure origins', async () => {
  assert.equal(await probeXRSupport(nav(undefined), true), 'unsupported');
  assert.equal(await probeXRSupport(nav(undefined), false), 'insecure');
  assert.equal(await probeXRSupport(nav({ isSessionSupported: async () => true }), true), 'supported');
  assert.equal(await probeXRSupport(nav({ isSessionSupported: async () => false }), true), 'unsupported');
  assert.equal(await probeXRSupport(nav({ isSessionSupported: async () => { throw new Error('denied'); } }), true), 'unsupported');
});

test('session request prefers local-floor, then bounded-floor, then anything', async () => {
  const seen: XRSessionInit[] = [];
  const session = { id: 1 } as unknown as XRSession;
  const xr = nav({
    requestSession: async (_mode: string, init?: XRSessionInit) => {
      seen.push(init ?? {});
      if ((init?.requiredFeatures ?? []).includes('local-floor')) throw Object.assign(new Error('no local-floor'), { name: 'NotSupportedError' });
      return session;
    },
  });
  const r = await requestVRSession(xr);
  assert.equal(r.session, session);
  assert.equal(r.referenceSpace, 'bounded-floor');
  assert.equal(seen.length, 2);
  assert.ok(seen[1].optionalFeatures?.includes('hand-tracking'));
});

test('session request stops retrying when the user refuses', async () => {
  let calls = 0;
  const xr = nav({
    requestSession: async () => {
      calls++;
      throw Object.assign(new Error('declined'), { name: 'NotAllowedError' });
    },
  });
  await assert.rejects(() => requestVRSession(xr), /declined/);
  assert.equal(calls, 1);
});

test('session request without navigator.xr throws plainly', async () => {
  await assert.rejects(() => requestVRSession(nav(undefined)), /not available/);
});

test('session errors say the real reason', () => {
  const named = (name: string, message = '') => ({ name, message });
  assert.match(describeSessionError(named('SecurityError')), /HTTPS/);
  assert.match(describeSessionError(named('NotSupportedError', 'https required')), /HTTPS/);
  assert.match(describeSessionError(named('NotSupportedError', 'nope')), /cannot do immersive VR/);
  assert.match(describeSessionError(named('NotAllowedError')), /declined/);
  assert.match(describeSessionError(named('AbortError')), /awake/);
  assert.match(describeSessionError(named('InvalidStateError')), /already running/);
  assert.match(describeSessionError(new Error('boom')), /boom/);
});

test('snap turn steps once per push and re-arms past center', () => {
  const snap = new SnapTurn();
  assert.equal(snap.update(0), 0);
  assert.equal(snap.update(0.9), -Math.PI / 4); // push right, turn right
  assert.equal(snap.update(0.9), 0); // held: no repeat
  assert.equal(snap.update(0.5), 0); // still out: no re-arm
  assert.equal(snap.update(0.1), 0); // back past center: re-armed
  assert.equal(snap.update(-0.8), Math.PI / 4);
});

test('thumbstick decoding follows the XR Standard layout', () => {
  assert.deepEqual(decodeThumbstick([0.1, 0.2, 0.5, -0.6]), { x: 0.5, y: -0.6 });
  assert.deepEqual(decodeThumbstick([0.5, -0.6]), { x: 0.5, y: -0.6 });
  assert.deepEqual(decodeThumbstick([]), { x: 0, y: 0 });
});

test('button reads tolerate missing gamepads and buttons', () => {
  assert.equal(buttonDown(undefined, 4), false);
  assert.equal(buttonDown({ buttons: [{ pressed: true }] } as unknown as Gamepad, 4), false);
  assert.equal(buttonDown({ buttons: [{ pressed: false }, { pressed: false }, { pressed: false }, { pressed: false }, { pressed: true }] } as unknown as Gamepad, 4), true);
});

test('face buttons follow the padded layout on hardware, the compact one in emulators', () => {
  // Real Quest / Galaxy XR: touchpad slot padded (four axes), stick at 3, A/B at 4/5.
  assert.deepEqual(faceButtons({ axes: [0, 0, 0, 0] } as Gamepad), { stick: 3, a: 4, b: 5 });
  // Compact emulators (IWSDK Quest profile): two axes, stick at 2, A/B at 3/4.
  assert.deepEqual(faceButtons({ axes: [0, 0] } as Gamepad), { stick: 2, a: 3, b: 4 });
  assert.deepEqual(faceButtons(undefined), { stick: 2, a: 3, b: 4 });
});

test('VR prompt buffer edits a line from terminal bytes', () => {
  const b = new PromptBuffer();
  assert.equal(b.input('h'), 'change');
  assert.equal(b.input('i'), 'change');
  assert.equal(b.text, 'hi');
  assert.equal(b.input('\x1b[D'), 'change');
  assert.equal(b.input('a'), 'change');
  assert.equal(b.text, 'hai');
  assert.equal(b.input('\x7f'), 'change');
  assert.equal(b.text, 'hi');
  assert.equal(b.input('\r'), 'submit');
  assert.equal(new PromptBuffer().input('\x1b'), 'cancel');
  assert.equal(new PromptBuffer().input('\x7f'), 'noop');
});

test('teleport arc leaves the hand along the ray and falls with gravity', () => {
  const pts = sampleParabola(new THREE.Vector3(1, 1.5, 2), new THREE.Vector3(0, 0, -1));
  assert.equal(pts.length, 24);
  assert.ok(pts[0].distanceTo(new THREE.Vector3(1, 1.5, 2)) < 0.25);
  assert.ok(pts[0].z < 2, 'heads along -Z');
  assert.ok(pts[pts.length - 1].y < pts[0].y, 'gravity pulls the far end down');
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].z <= pts[i - 1].z, 'never comes back');
});

test('rig yaw faces the avatar direction with the head straight', () => {
  for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawForFacing(facing));
    assert.ok(Math.abs(dir.x - Math.sin(facing)) < 1e-6, `x for ${facing}`);
    assert.ok(Math.abs(dir.z - Math.cos(facing)) < 1e-6, `z for ${facing}`);
  }
});

test('a quick pinch releases as a select tap', () => {
  const hold = new PinchHold();
  assert.equal(hold.update(true, 1000), null); // rising edge
  assert.equal(hold.update(true, 1000 + PINCH_HOLD_MS - 1), null); // still a tap
  assert.equal(hold.heldSince, 1000);
  assert.equal(hold.isAiming, false);
  assert.equal(hold.release(), 'select');
  assert.equal(hold.heldSince, -1);
});

test('a pinch held past the threshold aims, and its release teleports', () => {
  const hold = new PinchHold();
  assert.equal(hold.update(true, 2000), null);
  assert.equal(hold.update(true, 2000 + PINCH_HOLD_MS), 'aim'); // crosses once
  assert.equal(hold.update(true, 2000 + PINCH_HOLD_MS + 500), null); // held: no repeat
  assert.equal(hold.isAiming, true);
  assert.equal(hold.release(), 'teleport');
  // …and the next pinch starts over as a tap.
  assert.equal(hold.update(true, 9000), null);
  assert.equal(hold.release(), 'select');
});

test('a hold on a UI panel never becomes a teleport aim', () => {
  const hold = new PinchHold();
  assert.equal(hold.update(true, 3000, true), null);
  assert.equal(hold.update(true, 3000 + PINCH_HOLD_MS + 1000, true), null);
  assert.equal(hold.isAiming, false);
  assert.equal(hold.release(), 'select'); // the panel press resolves through routeRay instead
});

test('a consumed hold (both-hands menu) releases to nothing', () => {
  const hold = new PinchHold();
  assert.equal(hold.update(true, 4000), null);
  hold.consume();
  assert.equal(hold.update(true, 4000 + MENU_HOLD_MS + 1000), null); // never aims once claimed
  assert.equal(hold.release(), null);
});

test('a dropped hold without a release still resets', () => {
  const hold = new PinchHold();
  assert.equal(hold.update(true, 5000), null);
  assert.equal(hold.update(false, 5100), null);
  assert.equal(hold.release(), null);
  assert.equal(hold.heldSince, -1);
});

test('XR ray direction matches three setFromXRController, not getWorldDirection', () => {
  const space = new THREE.Object3D();
  space.position.set(1, 1.5, 2);
  space.rotation.set(0.3, -0.7, 0.1);
  space.updateMatrixWorld(true);
  const ref = new THREE.Raycaster();
  // setFromXRController takes a WebXRController, but only reads matrixWorld — an Object3D suffices.
  ref.setFromXRController(space as unknown as Parameters<THREE.Raycaster['setFromXRController']>[0]);
  const dir = xrRayDirection(space, new THREE.Vector3());
  assert.ok(dir.distanceTo(ref.ray.direction) < 1e-6, `matches three: ${dir.toArray()} vs ${ref.ray.direction.toArray()}`);
  const wrong = space.getWorldDirection(new THREE.Vector3());
  assert.ok(dir.dot(wrong) < -0.99, 'getWorldDirection points the opposite way (the old bug)');
});

test('VR settings default to comfort and survive a save with no VR section', () => {
  assert.deepEqual(VR_DEFAULTS, { glide: false, turn: 'snap', turnSpeed: 90, fade: true });
  // No localStorage in node: the plain defaults, including a fresh vr object each load.
  const s = loadSettings();
  assert.deepEqual(s.vr, VR_DEFAULTS);
  assert.notEqual(s.vr, VR_DEFAULTS);
});

test('VR settings round-trip through the store, clamped and complete', (t) => {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const s = loadSettings();
  s.vr.glide = true;
  s.vr.turn = 'smooth';
  s.vr.turnSpeed = 500; // clamped into range on the way back in
  s.vr.fade = false;
  saveSettings(s);
  assert.deepEqual(loadSettings().vr, { glide: true, turn: 'smooth', turnSpeed: 180, fade: false });
  // An old save from before VR existed grows the section with defaults.
  mem.set('agent-office.settings', JSON.stringify({ view: 'third' }));
  assert.deepEqual(loadSettings().vr, VR_DEFAULTS);
});
