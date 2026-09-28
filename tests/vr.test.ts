import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { describeSessionError, probeXRSupport, requestVRSession, type XrNavigator } from '../src/client/vr/support.js';
import { SnapTurn, buttonDown, decodeThumbstick, sampleParabola, yawForFacing } from '../src/client/vr/session.js';
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
