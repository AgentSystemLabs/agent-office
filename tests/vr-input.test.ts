import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VRSession, controllerPad, type VRHooks } from '../src/client/vr/session.js';
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
  pollButtons: () => void;
  stick: (i: number) => { x: number; y: number };
};

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
