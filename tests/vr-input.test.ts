import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FULL_PINCH, VRSession, controllerPad, handPinchDown, type VRHooks } from '../src/client/vr/session.js';
import { loadSettings } from '../src/client/state.js';

type Button = { pressed: boolean; touched: boolean; value: number };
const up = (): Button => ({ pressed: false, touched: false, value: 0 });
const down = (): Button => ({ pressed: true, touched: true, value: 1 });

/** A Galaxy XR controller's gamepad as Chromium builds it: xr-standard, touchpad slot padded. */
function controllerGamepad(pressed: number[] = []): Gamepad {
  const buttons = Array.from({ length: 7 }, (_, i) => (pressed.includes(i) ? down() : up()));
  return { mapping: 'xr-standard', buttons, axes: [0, 0, 0, 0] } as unknown as Gamepad;
}

/** A tracked hand's gamepad as Chromium builds it: [pinch, pad, pad, pad, grasp], no axes. */
function handGamepad(pinch: boolean, grasp: boolean): Gamepad {
  return { mapping: 'xr-standard', buttons: [pinch ? down() : up(), up(), up(), up(), grasp ? down() : up()], axes: [] } as unknown as Gamepad;
}

function source(handedness: 'left' | 'right', gamepad: Gamepad, hand = false): XRInputSource {
  return { handedness, gamepad, ...(hand ? { hand: new Map() } : {}), profiles: [], targetRayMode: 'tracked-pointer' } as unknown as XRInputSource;
}

type SessionUnderTest = {
  active: boolean;
  onConnected: (i: number, source: XRInputSource) => void;
  onSelectStart: (i: number) => void;
  onSelectEnd: (i: number) => void;
  readHandPinches: () => void;
  pulse: (i: number, strength: number, ms: number) => void;
  pollButtons: () => void;
  stick: (i: number) => { x: number; y: number };
  rays: { selectHeld: boolean }[];
};

/** Set a hand gamepad's pinch value the way Chromium reports it: pressed at the runtime's early threshold. */
function setPinch(gamepad: Gamepad, value: number): void {
  const b = gamepad.buttons[0] as unknown as Button;
  b.value = value;
  b.pressed = value >= 0.7;
  b.touched = value > 0;
}

function sessionFixture() {
  let next = 0;
  const renderer = {
    xr: {
      getController: () => new THREE.Group(),
      getControllerGrip: () => new THREE.Group(),
      getHand: () => Object.assign(new THREE.Group(), { joints: {} }),
    },
  } as unknown as THREE.WebGLRenderer;
  const hooks = {
    player: { rig: null },
    settings: loadSettings(),
    nextWaiting: () => next++,
  } as unknown as VRHooks;
  const session = new VRSession(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), hooks) as unknown as SessionUnderTest;
  session.active = true;
  return { session, nextCount: () => next };
}

test('controllerPad returns a controller gamepad and nothing for tracked hands', () => {
  const pad = controllerGamepad();
  assert.equal(controllerPad(source('right', pad)), pad);
  assert.equal(controllerPad(source('right', handGamepad(true, true), true)), undefined, 'a hand gamepad is never read as a controller');
  assert.equal(controllerPad(null), undefined);
  assert.equal(controllerPad({ handedness: 'right' } as XRInputSource), undefined, 'a source without a gamepad');
});

test('a closed fist (hand grasp at buttons[4]) never fires N or aims a teleport', () => {
  const { session, nextCount } = sessionFixture();
  session.onConnected(0, source('left', handGamepad(false, true), true));
  session.onConnected(1, source('right', handGamepad(true, true), true));
  session.pollButtons();
  session.pollButtons();
  assert.equal(nextCount(), 0);
  assert.deepEqual(session.stick(0), { x: 0, y: 0 });
});

test('handPinchDown reads a full pinch from a hand gamepad and defers otherwise', () => {
  const pad = handGamepad(false, false);
  const hand = source('right', pad, true);
  assert.equal(FULL_PINCH, 1, 'Galaxy XR full pinch (google/xrblocks PinchFilter)');
  setPinch(pad, 0.7);
  assert.equal(handPinchDown(hand), false, "the runtime's early select threshold is not a pinch");
  setPinch(pad, 1);
  assert.equal(handPinchDown(hand), true);
  assert.equal(handPinchDown(source('right', controllerGamepad([0]))), null, 'controllers are not read here');
  assert.equal(handPinchDown({ handedness: 'right', hand: new Map() } as unknown as XRInputSource), null, 'a hand without a gamepad falls back to select events');
});

test("a hand's early native select (pinch 0.7) never holds; a full pinch does, and letting go releases", () => {
  const { session } = sessionFixture();
  const pad = handGamepad(false, false);
  session.onConnected(1, source('right', pad, true));
  setPinch(pad, 0.7);
  session.onSelectStart(1);
  session.readHandPinches();
  assert.equal(session.rays[1].selectHeld, false, 'native selectstart at 0.7 is ignored');
  setPinch(pad, 1);
  session.readHandPinches();
  assert.equal(session.rays[1].selectHeld, true);
  session.onSelectEnd(1);
  assert.equal(session.rays[1].selectHeld, true, 'native selectend does not cut a full pinch short');
  setPinch(pad, 0.9);
  session.readHandPinches();
  assert.equal(session.rays[1].selectHeld, false, 'easing off the full pinch releases');
});

test('a hand without a gamepad still pinches through native select events', () => {
  const { session } = sessionFixture();
  session.onConnected(0, { handedness: 'left', hand: new Map(), profiles: [], targetRayMode: 'tracked-pointer' } as unknown as XRInputSource);
  session.onSelectStart(0);
  session.readHandPinches();
  assert.equal(session.rays[0].selectHeld, true);
  session.onSelectEnd(0);
  assert.equal(session.rays[0].selectHeld, false);
});

test('pulse uses the standard vibrationActuator, falls back to hapticActuators, and skips hands', () => {
  const { session } = sessionFixture();
  const effects: unknown[] = [];
  const pulses: unknown[] = [];
  const standard = Object.assign(controllerGamepad(), { vibrationActuator: { playEffect: (...a: unknown[]) => (effects.push(a), Promise.resolve('complete')) } });
  const legacy = Object.assign(controllerGamepad(), { vibrationActuator: null, hapticActuators: [{ pulse: (...a: unknown[]) => (pulses.push(a), Promise.resolve(true)) }] });
  session.onConnected(0, source('left', standard));
  session.onConnected(1, source('right', legacy));
  session.pulse(0, 0.4, 25);
  session.pulse(1, 0.3, 20);
  assert.deepEqual(effects, [['dual-rumble', { duration: 25, strongMagnitude: 0.4, weakMagnitude: 0.4 }]]);
  assert.deepEqual(pulses, [[0.3, 20]]);
  const handPad = Object.assign(handGamepad(true, false), { vibrationActuator: { playEffect: () => assert.fail('hands have no actuator') } });
  session.onConnected(0, source('left', handPad, true));
  session.pulse(0, 0.4, 25);
  session.onConnected(1, source('right', controllerGamepad()));
  session.pulse(1, 0.4, 25);
});

test('a Galaxy XR controller B press ([5]) fires N once per press', () => {
  const { session, nextCount } = sessionFixture();
  const pad = controllerGamepad([5]);
  const b = pad.buttons[5] as unknown as Button;
  session.onConnected(1, source('right', pad));
  session.pollButtons();
  session.pollButtons();
  assert.equal(nextCount(), 1, 'held B is one edge');
  b.pressed = false;
  session.pollButtons();
  b.pressed = true;
  session.pollButtons();
  assert.equal(nextCount(), 2);
});
