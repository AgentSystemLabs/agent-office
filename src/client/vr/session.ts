// The WebXR session: rig, controller/hand input, and locomotion for the headset browser.
// Plain Three.js WebXR (renderer.xr + setAnimationLoop).
//
// Hands speak pinch: three forwards the runtime's select events plus its own joint-distance
// pinchstart/pinchend to the target-ray spaces, and the session reads their union as one
// held state per hand — a tap is E, a hold is a teleport aim, both hands together open the
// menu (both-held suppresses aiming, so the menu gesture stays reachable). Nearby grabbables
// claim pinch holds before teleport. Controllers use squeeze to grab (otherwise cancel/menu),
// trigger to use, and A for teleport.
//
// The ladder and the poles work too: the desktop update that steps them never runs in VR, so
// the session steps the rig itself, with the glide stick working the rungs and E letting go.
//
// The rig is the standard three dolly: the desktop camera is reparented under a Group at the
// avatar's feet while presenting, and three composes the headset pose with it
// (WebXRManager.updateCamera). The avatar (player.pos) stays the source of truth: VR locomotion
// moves it through the same collision as walking, the desktop move sender picks it up unchanged,
// and anything desktop-side that moves the player (N, the elevator, ladders) rebases the rig.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { GRAVITY, STEP } from '../player';
import type { PlayerController } from '../player';
import type { Settings } from '../state';
import type { InteractKind, Interactable } from '../world/office';
import type { BoardSpot } from '../world/board-layout';
import type { CarriedIssue, GhIssue } from '../../shared/protocol';
import type { HeadPose } from './math';
import { describeSessionError, requestVRSession, type VrReferenceSpace } from './support';
import { GRAB_HOLD_MS, VRGrab, type GrabAim, type GrabHooks } from './grab';

/**
 * Standard WebXR gamepad buttons, per the "xr-standard" mapping of the WebXR Gamepads Module
 * (https://www.w3.org/TR/webxr-gamepads-module-1/#xr-standard-gamepad-mapping): [0] primary
 * trigger, [1] squeeze, [2] touchpad, [3] thumbstick press, [4]+ vendor buttons.
 *
 * The Galaxy XR controllers use exactly this layout. Chromium binds them through the OpenXR
 * Oculus Touch profile (system name "Moohan", reported as "samsung-galaxyxr" in
 * device/vr/openxr/openxr_interaction_profiles.cc), and OpenXrController::GetWebXRGamepad
 * (device/vr/openxr/openxr_controller.cc) builds buttons [trigger, squeeze, placeholder,
 * thumbstick, x|a, y|b, thumbrest] with axes [placeholder, placeholder, stick x, stick y].
 * The official profile (webxr-input-profiles packages/registry/profiles/samsung/
 * samsung-galaxyxr.json) agrees, and also lists a left "menu" at [7], which Chromium does not
 * put on the gamepad: a menu press is Chromium's exit gesture and ends the WebXR session
 * (device/vr/openxr/openxr_input_helper.cc, "Pressing a menu buttons is treated as a signal to
 * exit the WebXR session"). Never map an office action to it; the page can't see it anyway.
 * The placeholders stand for the touchpad the controller doesn't have,
 * which is why the stick is at [3] and A/B at [4]/[5]. Do not "fix" STICK to 2 or A/B to 3/4
 * for Galaxy XR; see faceButtons for the one case where those indices move.
 *
 * These indices describe controllers only. Tracked hands also report a gamepad, with a
 * different meaning for [4] (see controllerPad).
 */
export const XR_BUTTON = { TRIGGER: 0, SQUEEZE: 1, STICK: 3, A: 4, B: 5 } as const;
/** Snap-turn step. */
export const SNAP_ANGLE = Math.PI / 4;
/** Thumbstick deflection that counts as a push. */
const STICK_ON = 0.7;
/** …and where a pushed stick re-arms, so snap turns don't repeat while held. */
const STICK_OFF = 0.3;
/** Teleport arc: meters per second out of the hand, and gravity pulling it down. */
const ARC_SPEED = 6;
const ARC_GRAVITY = 9.8;
const ARC_STEPS = 24;
const ARC_DT = 1 / 30;
/** A pinch held past this long becomes a teleport aim (hands; controllers use A). */
export const PINCH_HOLD_MS = 450;
/** Both hands pinched past this long toggles the menu (hands; controllers squeeze). */
export const MENU_HOLD_MS = 600;
/** The XR framebuffer renders below native while presenting: stereo at headset resolution is
 * the whole perf cost (flat rendering in the same browser is fine), and 0.8² of the pixels
 * buys the frame budget back with no visible blur. Restored on session end. */
const XR_FRAMEBUFFER_SCALE = 0.8;
/** Fingertips for pokes; knuckles and wrist for an open-handed pat. No aim/grip proxy poses. */
const TOUCH_JOINTS: readonly XRHandJoint[] = [
  'index-finger-tip',
  'thumb-tip',
  'middle-finger-tip',
  'ring-finger-tip',
  'pinky-finger-tip',
  'index-finger-metacarpal',
  'middle-finger-metacarpal',
  'ring-finger-metacarpal',
  'pinky-finger-metacarpal',
  'wrist',
];

/**
 * One hand's pinch, read as tap-vs-hold: fed the live held state plus a clock, it reports
 * the moment a hold becomes a teleport aim, and what a release means. The session ORs the
 * hand's select state (a full pinch value, see FULL_PINCH; native select events only for hands
 * without one) with three's pinchstart/pinchend into `held`, so a pinch that both signals see
 * still produces a single tap.
 */
export class PinchHold {
  private held = false;
  private t0 = 0;
  private aiming = false;
  private consumed = false;

  /** When the current hold started (ms); -1 when nothing is held. */
  get heldSince(): number {
    return this.held ? this.t0 : -1;
  }
  get isHeld(): boolean {
    return this.held;
  }
  get isAiming(): boolean {
    return this.held && this.aiming;
  }
  get isConsumed(): boolean {
    return this.consumed;
  }

  /** The menu gesture claims a hold wholesale: its release then means nothing. */
  consume(): void {
    this.consumed = true;
    this.aiming = false;
  }

  /**
   * Feed the live held state. Returns 'aim' once, on the frame the hold crosses the
   * teleport threshold — unless the menu gesture already consumed it, or `uiOwned` says
   * the ray is working a panel (a hold there drags/scrolls, never teleports).
   */
  update(held: boolean, now: number, uiOwned = false): 'aim' | null {
    if (!held) {
      // Releases resolve through release(), but a drop without one still resets.
      this.held = false;
      this.aiming = false;
      return null;
    }
    if (!this.held) {
      this.held = true;
      this.t0 = now;
      this.aiming = false;
      this.consumed = false;
      return null;
    }
    if (!this.aiming && !this.consumed && !uiOwned && now - this.t0 >= PINCH_HOLD_MS) {
      this.aiming = true;
      return 'aim';
    }
    return null;
  }

  /** What a release means: the teleport it aimed, the tap's select, or nothing. */
  release(): 'teleport' | 'select' | null {
    const out = !this.held ? null : this.consumed ? null : this.aiming ? 'teleport' : 'select';
    this.held = false;
    this.aiming = false;
    this.consumed = false;
    return out;
  }

  reset(): void {
    this.held = false;
    this.aiming = false;
    this.consumed = false;
    this.t0 = 0;
  }
}

/** One touch per approach; a brief tracking/edge wobble must not press the key again. */
export class TouchPress {
  active = false;
  private awaySince: number | null = null;

  update(touching: boolean, now: number): boolean {
    if (touching) {
      this.awaySince = null;
      if (this.active) return false;
      this.active = true;
      return true;
    }
    if (this.active) {
      this.awaySince ??= now;
      if (now - this.awaySince >= 120) this.reset();
    }
    return false;
  }

  reset(): void {
    this.active = false;
    this.awaySince = null;
  }
}

/** What the session needs from main.ts, which owns the world, the dispatch, and the HUD. */
export interface VRHooks {
  player: PlayerController;
  settings: Settings;
  /** E on an Interactable: the same `use()` the keyboard calls. Never forked. Null aims at nothing, like the desktop key with no target. */
  useE: (it: Interactable | null, note: GhIssue | null, spot?: BoardSpot | null) => void;
  /** The shared ray picker (office, gallery, dog, or the roof's): ray in, Interactable out. */
  pickFromRay: (ray: THREE.Raycaster, slack: number) => { it: Interactable; near: boolean; hit: THREE.Intersection } | null;
  /** Physical contact at a tracked joint; cab keys accept only the index fingertip. */
  touchTarget?: (point: THREE.Vector3, indexTip: boolean) => Interactable | null;
  /** The issue note under an aim on the issues board, if any. */
  noteUnder: (aim: { it: Interactable; hit: THREE.Intersection } | null) => GhIssue | null;
  /** The tab or Jira card under an aim on the issues board, if any. */
  spotUnder?: (aim: { it: Interactable; hit: THREE.Intersection } | null) => BoardSpot | null;
  /** N: the next worker waiting on someone. */
  nextWaiting: () => void;
  /** Q with a card in hand: pin it back up. */
  putBack: () => void;
  carrying: () => CarriedIssue | null;
  grab?: GrabHooks;
  /** Close the topmost window, like Esc. False when none is open. */
  closeTop: () => boolean;
  modalOpen: () => boolean;
  toast: (text: string, level?: 'info' | 'warn' | 'error') => void;
  hudRefresh: () => void;
  /** How close you must be to use each kind of thing: the same REACH as the mouse. */
  reachOf: (kind: InteractKind) => number;
  /** The reach-out animation + 'act' message, so everyone sees the arm. */
  reachAnim: () => void;
  /** Mirror the controller's target into the desktop hint state (for the flat mirror). */
  onTarget: (it: Interactable | null, note: GhIssue | null, spot?: BoardSpot | null) => void;
  /** What E would do to the target, in words for the headset's aim bar (null: nothing). */
  aimLabel: (it: Interactable, note: GhIssue | null) => string | null;
  /** Restore the canvas after three sized it for the headset. */
  resize: () => void;
  /** Fired after a session starts / after it is fully torn down (for UI attach/dispose). */
  onEnter?: () => void;
  onEnd?: () => void;
}

/** A thumbstick from a gamepad's axes: XR Standard puts it at [2,3] (touchpad at [0,1]). */
export function decodeThumbstick(axes: readonly number[]): { x: number; y: number } {
  if (axes.length >= 4) return { x: axes[2] ?? 0, y: axes[3] ?? 0 };
  if (axes.length >= 2) return { x: axes[0] ?? 0, y: axes[1] ?? 0 };
  return { x: 0, y: 0 };
}

/**
 * The ray direction out of an XR target-ray space: -Z of its world matrix, exactly what
 * three's own Raycaster.setFromXRController computes. getWorldDirection is +Z on non-camera
 * objects — precisely backwards — and every ray in the session funnels through here so the
 * visible line, the picking, and the teleport arc always agree.
 */
export function xrRayDirection(space: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  _m.identity().extractRotation(space.matrixWorld);
  return out.set(0, 0, -1).applyMatrix4(_m);
}

/** Whether a button index is held, against a possibly missing gamepad. */
export function buttonDown(gamepad: Gamepad | undefined, index: number): boolean {
  return !!gamepad?.buttons[index]?.pressed;
}

/**
 * Face-button indices for one controller gamepad. XR Standard pads the touchpad slot
 * (buttons[2], axes[0,1]) even where no touchpad exists. Real Quest and Galaxy XR controllers
 * look like that (see XR_BUTTON), with the stick at [3] and A/B at [4,5]. Emulators that
 * compact the slot away (the IWSDK Quest profile: stick at [2], A/B at [3,4]) also compact the
 * axes to two, so the axes length tells the layouts apart; the padding decision covers both
 * arrays.
 *
 * Never pass a hand's gamepad here. A hand's gamepad has no axes, so this falls to the compact
 * layout and reads the hand's grasp button ([4]) as B. Callers get their gamepad through
 * controllerPad, which returns nothing for hands.
 */
export function faceButtons(gamepad: Gamepad | undefined): { stick: number; a: number; b: number } {
  return (gamepad?.axes.length ?? 0) >= 4 ? { stick: XR_BUTTON.STICK, a: XR_BUTTON.A, b: XR_BUTTON.B } : { stick: 2, a: 3, b: 4 };
}

/**
 * The gamepad to read sticks and face buttons from: a controller's, never a hand's.
 *
 * Tracked hands carry a gamepad too. In Chromium, a hand's gamepad is built by
 * OpenXrController::GetWebXRGamepad (device/vr/openxr/openxr_controller.cc): its hand profiles
 * (XR_EXT_hand_interaction / XR_MSFT_hand_interaction, reported as "generic-hand-select-grasp"
 * in device/vr/openxr/openxr_interaction_profiles.cc) bind only a trigger (pinch) and a grasp.
 * XRStandardGamepadBuilder (device/vr/util/xr_standard_gamepad_builder.cc) then pads the missing
 * squeeze, touchpad and thumbstick slots, so the hand's gamepad is buttons
 * [pinch, placeholder, placeholder, placeholder, grasp] and has no axes. The registry profile
 * (webxr-input-profiles generic-hand-select-grasp.json) has the same layout.
 *
 * Reading that like a controller goes wrong: faceButtons sees no axes and picks the compact
 * layout, so grasp at [4] reads as B and a closed fist fires N (jump to the next waiting worker).
 *
 * Runtimes that expose hands through XR_FB_hand_tracking_aim instead get a one-button gamepad,
 * [pinch] (device/vr/openxr/fb/openxr_hand_tracker_fb.cc). Either way [0] is the pinch.
 *
 * A source with `hand` set is a hand, whatever its gamepad looks like. Hand input goes through
 * the pinch (handPinchDown, select/pinch events) and joints (updateHolds, updateTouches), never
 * through this function.
 */
export function controllerPad(source: XRInputSource | null | undefined): Gamepad | undefined {
  return source && !source.hand ? (source.gamepad ?? undefined) : undefined;
}

/**
 * The pinch value at which a hand counts as pinching: a full pinch, 1.0.
 *
 * Galaxy XR fires a hand's native `selectstart` early, at a pinch value of 0.7, so a relaxed or
 * half-closed hand selects. Google's XR Blocks works around exactly this (google/xrblocks
 * 5dacc9ae, src/input/PinchFilter.ts, "Temporary class until pinch is fixed at the system level
 * on Galaxy XR"): it drops native select events for hands that have a gamepad and makes its own
 * when `gamepad.buttons[0].value` reaches 1.0, releasing below it. Chromium adds no threshold
 * of its own: the EXT hand profile binds both the select press and the gamepad value to the
 * runtime's `/input/pinch_ext/value` (device/vr/openxr/openxr_interaction_profiles.cc), so the
 * 0.7 is the runtime's and the value in buttons[0] is the raw pinch. Do not lower this to
 * "make pinching easier" or switch back to native select for hands: partial pinches then tap E
 * and start teleport aims and grabs.
 *
 * three's joint-distance pinch (pinchstart/pinchend: thumb and index tips within about 1.5 cm,
 * WebXRController.js) stays ORed in as a second signal, so a runtime whose pinch value never
 * quite reaches 1.0 still pinches when the fingertips meet.
 */
export const FULL_PINCH = 1;

/**
 * Whether a hand is pinching, read from its gamepad's pinch value (buttons[0], see
 * controllerPad); null when the source is not a hand or reports no pinch value, in which case
 * the native select events stand in (onSelectStart). See FULL_PINCH for why native select is
 * ignored otherwise.
 */
export function handPinchDown(source: XRInputSource | null | undefined): boolean | null {
  const pinch = source?.hand ? source.gamepad?.buttons[0] : undefined;
  return pinch ? pinch.value >= FULL_PINCH : null;
}

/**
 * A procedural controller stand-in (grip + tracking ring + trigger nub, office orange): what a
 * controller looks like until its input-profile model loads from the CDN — and what it keeps
 * looking like where the headset can't reach the net. Lives in grip space, meters.
 */
export function buildFallbackGrip(): THREE.Group {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xee6018, roughness: 0.5, emissive: 0xee6018, emissiveIntensity: 0.35 });
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.11, 0.05), dark);
  grip.position.y = -0.05;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 10, 24), dark);
  ring.position.set(0, 0.03, -0.045);
  const nub = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.025), accent);
  nub.position.set(0, 0.005, -0.035);
  nub.rotation.x = 0.3;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), accent);
  dot.position.set(0, 0.02, 0.028);
  g.add(grip, ring, nub, dot);
  return g;
}

/** Sampled points of a teleport arc: a throw out of the hand under gravity. */
export function sampleParabola(origin: THREE.Vector3, dir: THREE.Vector3, steps = ARC_STEPS, dt = ARC_DT): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const p = origin.clone();
  const v = dir.clone().multiplyScalar(ARC_SPEED);
  for (let i = 0; i < steps; i++) {
    v.y -= ARC_GRAVITY * dt;
    p.addScaledVector(v, dt);
    pts.push(p.clone());
  }
  return pts;
}

/** Snap-turning: one step per push, re-armed when the stick comes back past center. */
export class SnapTurn {
  private armed = true;
  /** Radians to turn this frame for this deflection (0 when held or centered). */
  update(axisX: number): number {
    const a = Math.abs(axisX);
    if (a < STICK_OFF) {
      this.armed = true;
      return 0;
    }
    if (!this.armed || a < STICK_ON) return 0;
    this.armed = false;
    return axisX > 0 ? -SNAP_ANGLE : SNAP_ANGLE;
  }
}

/** The dolly yaw that faces `facing` (the avatar's (sin, cos) convention) with the head straight. */
export function yawForFacing(facing: number): number {
  return facing + Math.PI;
}

const UP = new THREE.Vector3(0, 1, 0);
// Scratch for the per-frame input math: the VR hot path allocates nothing.
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _h = new THREE.Vector3();
const _l = new THREE.Vector3();
const _e = new THREE.Vector3();
const _u = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** Reused head pose for the UI tick (HeadPose is plain tuples, allocated once here). */
const _head: HeadPose = { pos: [0, 0, 0], dir: [0, 0, -1] };

interface RayState {
  targetRay: THREE.XRTargetRaySpace;
  grip: THREE.XRGripSpace;
  hand: THREE.XRHandSpace;
  pinchAnchor: THREE.Group;
  source: XRInputSource | null;
  /** Which hand this ray is, when the runtime says (slot order is no guide: one controller may sit in either). */
  handed: 'left' | 'right' | null;
  /** The runtime's select is down (controllers: fires E at once; hands: feeds the hold). */
  selectHeld: boolean;
  /** three's joint-distance pinch is down (hand-tracked sources only). */
  pinchHeld: boolean;
  /** Tap-vs-hold for hand-tracked sources. */
  hold: PinchHold;
  touch: TouchPress;
  touchTarget: Interactable | null;
  touchJoint: XRHandJoint | null;
  hover: { it: Interactable; near: boolean; hit: THREE.Intersection } | null;
  /** A world-space UI panel owns this ray this frame (world input yields to it). */
  uiConsumed: boolean;
  teleportHeld: boolean;
  wasN: boolean;
  line: THREE.Line;
  dot: THREE.Mesh;
  /** The input-profile controller model (CDN): null-motionController until it loads, if it ever does. */
  ctrlModel: THREE.Object3D & { motionController?: unknown };
  /** Procedural grip shown until (or when) the profile model loads: controllers stay visible offline. */
  fallback: THREE.Group;
}

/** World-space UI panels (vr/attach.ts): the session routes rays to them first and ticks them. */
export interface VRUiSink {
  routeRay: (rayId: number, raycaster: THREE.Raycaster, pressed: boolean) => boolean;
  /** Where a routed ray lands on a panel (world), for the cursor dot; null when it lands on none. */
  panelHit: (rayId: number) => THREE.Vector3 | null;
  stickScroll: (rayId: number, axisY: number, dt: number) => void;
  /** Cancels a ray's in-flight press without clicking (disconnect, session end). */
  cancelRay: (rayId: number) => void;
  /** Shifts head-placed modal panels (prompt + its keyboard) by a virtual move's delta. */
  carryAlong: (delta: THREE.Vector3) => void;
  update: (dt: number, head?: HeadPose | null) => void;
  toggleMenu: () => void;
  openTerminal: (workerId: string) => void;
  /** The issue card in hand, if any: the UI keeps a sticky hint up while one is carried. */
  setCarrying: (card: { issue: number; title: string } | null) => void;
  /** What E would do to the ray's target, for the headset's aim bar (null hides it). */
  setAim: (text: string | null) => void;
  /** Fires when a ray's release clicks a panel button (the session ticks the controller). */
  onPanelClick: ((rayId: number) => void) | null;
}

export class VRSession {
  /** Set once the probe answers: the Enter VR button shows only when true. */
  available = false;
  /** An immersive session is presenting right now. */
  active = false;
  /** The rig: the camera hangs under this at the avatar's feet while presenting. */
  readonly dolly = new THREE.Group();
  /**
   * How drunk the rig sways (main.ts feeds player.drunk each frame): the drunk-vision shader
   * can't run in XR (no post on the headset framebuffer), so the rig rolls and pitches with
   * the same wobble the desktop camera shakes with instead. 0 sober (or reduce-motion).
   */
  sway = 0;

  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private hooks: VRHooks;
  private session: XRSession | null = null;
  private cameraParent: THREE.Object3D | null = null;
  /** Where the rig stands (feet) and which way is straight ahead (-Z local). */
  private origin = new THREE.Vector3();
  private yaw = 0;
  private lastAvatar = new THREE.Vector3();
  private rays: RayState[] = [];
  /** Both hands on one object still count as one contact, until both withdraw. */
  private contacts = new Map<Interactable, TouchPress>();
  private raycaster = new THREE.Raycaster();
  private arc: THREE.Line;
  private marker: THREE.Mesh;
  private fadeMesh: THREE.Mesh;
  private fade: 'idle' | 'out' | 'in' = 'idle';
  private fadeT = 0;
  /** Elevator/ladder trips hold the black until the far side fades back in (teleports never hold). */
  private fadeHold = false;
  private pendingTeleport: THREE.Vector3 | null = null;
  private snap = new SnapTurn();
  /** The aim bar's words (repainted only when the target's meaning changes). */
  private aimText: string | null = null;
  private stickAiming = false;
  private glideActive = false;
  /** Alternating frames halve the world-hover raycasts (each ray refreshes every 2nd frame). */
  private frame = 0;
  /** World-space UI panels, set by main.ts on session enter and cleared on end. Null on desktop. */
  private ui: VRUiSink | null = null;
  private grab: VRGrab | null;
  private onSessionEnd = () => this.restore();

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hooks: VRHooks) {
    this.renderer = renderer;
    this.camera = camera;
    this.hooks = hooks;
    this.grab = hooks.grab ? new VRGrab(scene, hooks.grab) : null;
    this.dolly.visible = false;
    scene.add(this.dolly);

    // Tracked hands and controllers: the real devices' poses drive these models. Hands get
    // the skinned generic-hand mesh (vendored under /xr-hands so no CDN can break them), with
    // three's joint spheres behind as a fallback that hides once the mesh loads; controllers
    // get their input-profile models (GLTFLoader included: without one the factory throws and
    // nothing renders), with a procedural grip behind that hides once the profile loads. They
    // hang under the grip/hand spaces, which join the rig on session enter, and show/hide
    // themselves off the runtime's connected events. The desktop cartoon hands sit out in VR.
    // (The factory skips hand-tracked sources on its own, and the fallback only shows for
    // gamepad sources, so hands never wear a controller.)
    const controllerModelFactory = new XRControllerModelFactory(new GLTFLoader());
    for (let i = 0; i < 2; i++) {
      const targetRay = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      const ctrlModel = controllerModelFactory.createControllerModel(grip) as unknown as THREE.Object3D & { motionController?: unknown };
      grip.add(ctrlModel);
      // The profile models above come from a CDN, which a LAN-only headset can't reach: a
      // procedural grip stands in until the real one loads (the per-frame update hides it then).
      const fallback = buildFallbackGrip();
      grip.add(fallback);
      const beads = new XRHandModelFactory().createHandModel(hand);
      const skinned = new XRHandModelFactory(null, () => {
        beads.visible = false;
      }).setPath('/xr-hands/');
      hand.add(beads, skinned.createHandModel(hand, 'mesh'));
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -5)]);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
      line.frustumCulled = false;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), new THREE.MeshBasicMaterial({ color: 0x7df9ff, depthTest: false, transparent: true }));
      dot.renderOrder = 9998;
      targetRay.add(line, dot);
      const st: RayState = {
        targetRay,
        grip,
        hand,
        pinchAnchor: new THREE.Group(),
        source: null,
        handed: null,
        selectHeld: false,
        pinchHeld: false,
        hold: new PinchHold(),
        touch: new TouchPress(),
        touchTarget: null,
        touchJoint: null,
        hover: null,
        uiConsumed: false,
        teleportHeld: false,
        wasN: false,
        line,
        dot,
        ctrlModel,
        fallback,
      };
      targetRay.addEventListener('connected', (e) => this.onConnected(i, e.data));
      targetRay.addEventListener('disconnected', () => this.onDisconnected(i));
      // Three forwards every session event to all three spaces of a source, so the target-ray
      // space alone hears everything: listening on the hand too would fire every pinch twice.
      targetRay.addEventListener('selectstart', () => this.onSelectStart(i));
      targetRay.addEventListener('selectend', () => this.onSelectEnd(i));
      targetRay.addEventListener('pinchstart', () => {
        this.rays[i].pinchHeld = true;
      });
      targetRay.addEventListener('pinchend', () => {
        this.rays[i].pinchHeld = false;
      });
      targetRay.addEventListener('squeezestart', () => this.onSqueeze(i));
      targetRay.addEventListener('squeezeend', () => {
        if (!this.rays[i].source?.hand) this.grab?.release(i, this.grabAim(i));
      });
      this.rays.push(st);
    }
    // Parabolic arc + landing marker, drawn while a teleport is aimed.
    this.arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new Array(ARC_STEPS).fill(0).map(() => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.9 }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.26, 32), new THREE.MeshBasicMaterial({ color: 0x51ff7a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 9998;
    this.marker.visible = false;
    scene.add(this.arc, this.marker);
    // In-headset fade (the DOM #fade isn't visible in the headset): a quad before the eyes.
    this.fadeMesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false }));
    this.fadeMesh.position.z = -0.25;
    this.fadeMesh.renderOrder = 9999;
    this.fadeMesh.frustumCulled = false;
    this.fadeMesh.visible = false;
    camera.add(this.fadeMesh);
  }

  /** The Enter VR button: enter when out, end the session when in. */
  async toggle(): Promise<void> {
    if (this.active && this.session) {
      try {
        await this.session.end();
      } catch (err) {
        this.hooks.toast(`Could not leave VR: ${(err as Error).message}`, 'warn');
      }
      return;
    }
    await this.enter();
  }

  async enter(): Promise<void> {
    if (this.active) return;
    let session: XRSession;
    let referenceSpace: VrReferenceSpace;
    try {
      ({ session, referenceSpace } = await requestVRSession());
    } catch (err) {
      this.hooks.toast(describeSessionError(err), 'error');
      return;
    }
    const { player } = this.hooks;
    // Spawn at the avatar's feet, facing the current view direction.
    this.origin.copy(player.pos);
    const viewFacing = player.view === 'first' ? player.facing : player.camYaw + Math.PI;
    this.yaw = yawForFacing(viewFacing);
    this.lastAvatar.copy(player.pos);
    this.dolly.position.copy(this.origin);
    this.dolly.rotation.set(0, this.yaw, 0);
    this.dolly.visible = true;
    this.contacts.clear();
    for (const r of this.rays) {
      this.dolly.add(r.targetRay, r.grip, r.hand, r.pinchAnchor);
      r.selectHeld = false;
      r.pinchHeld = false;
      r.hold.reset();
      r.touch.reset();
      r.touchTarget = null;
      r.touchJoint = null;
      r.hover = null;
      r.uiConsumed = false;
    }
    this.cameraParent = this.camera.parent;
    this.dolly.add(this.camera);
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    player.unlock();
    player.clearKeys();
    player.enabled = false;
    this.renderer.xr.setReferenceSpaceType(referenceSpace);
    // Both of these only take before the session starts: three warns and ignores them after.
    this.renderer.xr.setFramebufferScaleFactor(XR_FRAMEBUFFER_SCALE);
    this.session = session;
    try {
      await this.renderer.xr.setSession(session);
    } catch (err) {
      this.session = null;
      this.restore();
      this.hooks.toast(describeSessionError(err), 'error');
      return;
    }
    // After setSession, so three's own end handler runs first: restore() sizes the canvas
    // back, which three refuses while it still thinks it's presenting.
    session.addEventListener('end', this.onSessionEnd);
    this.active = true;
    // Stereo at headset resolution is the whole VR perf cost, so the session renders smaller
    // (set above, before three built the framebuffer) and bakes the shadows once instead of
    // every frame (the sun barely moves in a visit). Do not count on foveation for frame time:
    // Chrome stores XRProjectionLayer.fixedFoveation but nothing in Blink's xr module or
    // device/vr/openxr reads it (xr_projection_layer.cc), so three's foveation setting does
    // nothing on Galaxy XR. The framebuffer scale is honoured (xr_webgl_binding.cc clamps it to
    // [0.2, max(native, 1)]), which is why XR_FRAMEBUFFER_SCALE carries the frame budget.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.hooks.hudRefresh();
    this.hooks.onEnter?.();
  }

  /** Back to the desktop camera and controls, exactly as they were. */
  private restore(): void {
    const { player } = this.hooks;
    this.clearGrab();
    if (this.session) {
      this.session.removeEventListener('end', this.onSessionEnd);
      this.session = null;
    }
    this.active = false;
    this.fade = 'idle';
    this.fadeHold = false;
    this.fadeMesh.visible = false;
    this.pendingTeleport = null;
    this.stickAiming = false;
    this.glideActive = false;
    this.sway = 0;
    this.contacts.clear();
    this.dolly.rotation.set(0, 0, 0);
    player.climbInput = 0;
    this.arc.visible = false;
    this.marker.visible = false;
    this.renderer.xr.setFramebufferScaleFactor(1);
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.shadowMap.needsUpdate = true;
    for (const r of this.rays) {
      r.source = null;
      r.handed = null;
      r.hover = null;
      r.uiConsumed = false;
      r.teleportHeld = false;
      r.selectHeld = false;
      r.pinchHeld = false;
      r.hold.reset();
      r.touch.reset();
      r.touchTarget = null;
      r.touchJoint = null;
      r.wasN = false;
      r.line.visible = true;
      r.dot.visible = true;
      r.targetRay.removeFromParent();
      r.grip.removeFromParent();
      r.hand.removeFromParent();
      r.pinchAnchor.removeFromParent();
    }
    // Any press in flight dies with the session (the UI disposes next, but cancel first so
    // nothing clicks on the way out).
    this.ui?.cancelRay(0);
    this.ui?.cancelRay(1);
    if (this.cameraParent) this.cameraParent.add(this.camera);
    else this.camera.removeFromParent();
    this.dolly.visible = false;
    // three sized the canvas for the headset and dropped the pixel ratio: put both back.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.hooks.resize();
    player.clearKeys();
    player.enabled = !this.hooks.modalOpen();
    player.updateCamera(true);
    this.hooks.hudRefresh();
    this.hooks.onEnd?.();
  }

  /** World-space UI panels for this session (vr/attach.ts): rays route to them first. */
  setUi(ui: VRUiSink | null): void {
    this.ui = ui;
    // Every panel click ticks the controller that made it (keys, rows, buttons alike).
    if (ui) ui.onPanelClick = (rayId) => this.pulse(rayId, 0.2, 12);
  }

  /** Floor and network transitions cannot leave a hand attached to the old world. */
  clearGrab(): void {
    this.grab?.clear();
    for (const st of this.rays) st.hold.consume();
  }

  /** Emulator test hook (?vrtest=1): the same landing a real teleport fire would take. */
  debugTeleport(x: number, y: number, z: number): void {
    if (!this.active) return;
    this.placeAvatar(new THREE.Vector3(x, y, z));
  }

  /** Emulator test hook (?vrtest=1): the same yaw step the snap turn takes. */
  debugTurn(dYaw: number): void {
    if (!this.active) return;
    this.setYaw(this.yaw + dYaw);
  }

  /** Emulator test hook (?vrtest=1): what the aim bar says (null while it hides). */
  debugAim(): string | null {
    return this.aimText;
  }
  /** Emulator test hook (?vrtest=1): per-ray input state, for verifying holds and aims. */
  debugRays(): { handed: string | null; controller: boolean; selectHeld: boolean; pinchHeld: boolean; aiming: boolean; teleportHeld: boolean; ui: boolean }[] {
    return this.rays.map((r) => ({
      handed: r.handed,
      controller: !!r.source && !r.source.hand,
      selectHeld: r.selectHeld,
      pinchHeld: r.pinchHeld,
      aiming: r.hold.isAiming,
      teleportHeld: r.teleportHeld,
      ui: r.uiConsumed,
    }));
  }

  /** Emulator test hook (?vrtest=1): each ray's world origin + direction, for aiming checks. */
  debugRayPos(): { origin: [number, number, number]; dir: [number, number, number] }[] {
    return this.rays.map((r) => {
      const o = new THREE.Vector3();
      const d = new THREE.Vector3();
      o.setFromMatrixPosition(r.targetRay.matrixWorld);
      xrRayDirection(r.targetRay, d);
      return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
    });
  }

  /** Faces the avatar's heading with the head straight: N (and the elevator) rebase the rig here. */
  faceAvatar(): void {
    if (!this.active) return;
    this.setYaw(yawForFacing(this.hooks.player.facing));
  }

  /** Turns the rig to a yaw around the head, so turning never translates the avatar. */
  private setYaw(yaw: number): void {
    this.headWorld(_h);
    this.yaw = yaw;
    this.dolly.rotation.y = this.yaw;
    // …around the head: the feet stay where they were, only the heading changes.
    this.headLocal(_l);
    _l.y = 0;
    _l.applyAxisAngle(UP, this.yaw);
    this.origin.set(_h.x - _l.x, this.origin.y, _h.z - _l.z);
    this.dolly.position.copy(this.origin);
  }

  /**
   * Elevator and ladder trips fade in the headset (the DOM #fade is invisible there): out at the
   * trip's start, held black across the floor change, back in when the far side arrives.
   */
  fadeOut(): void {
    if (!this.active) return;
    this.pendingTeleport = null;
    this.fade = 'out';
    this.fadeT = 0;
    this.fadeHold = true;
  }

  fadeIn(): void {
    if (!this.active) return;
    this.fadeHold = false;
    if (this.fade === 'out' && this.fadeT >= 1) {
      this.fade = 'in';
      this.fadeT = 0;
    }
    // Mid-fade-out, the finish below flips to 'in' by itself; idle needs nothing.
  }

  private onConnected(i: number, source: XRInputSource): void {
    const st = this.rays[i];
    st.source = source;
    st.handed = source.handedness === 'left' || source.handedness === 'right' ? source.handedness : null;
    st.line.visible = true;
    st.dot.visible = true;
  }

  private onDisconnected(i: number): void {
    const st = this.rays[i];
    if (this.grab?.owns(i)) this.clearGrab();
    st.source = null;
    st.handed = null;
    st.hover = null;
    st.selectHeld = false;
    st.pinchHeld = false;
    st.teleportHeld = false;
    st.wasN = false;
    st.hold.reset();
    st.touch.reset();
    st.touchTarget = null;
    st.touchJoint = null;
    st.line.visible = false;
    st.dot.visible = false;
    // A press in flight dies with the ray (else the panel waits on a release that never comes).
    this.ui?.cancelRay(i);
  }

  /**
   * Trigger down / pinch down. Controllers fire E at once (they aim teleports with A); a
   * hand-tracked pinch only marks the hold — the per-frame update decides tap (E), hold
   * (teleport aim), or both-hands (menu) on the union of this and three's pinch events.
   */
  private onSelectStart(i: number): void {
    if (!this.active) return;
    const st = this.rays[i];
    // Hands pinch-hold (per-frame, below); controllers click at once. Tell them apart by
    // `source.hand` (the WebXR Hand Input joints), never by `source.gamepad`: Chromium gives
    // tracked hands an xr-standard gamepad too ([pinch, pad, pad, pad, grasp], see
    // controllerPad), so "has a gamepad" is true for Galaxy XR hands as well as controllers.
    if (!st.source?.hand) {
      // Buttons mean a controller: the trigger clicks at once, with a light tick for the press
      // itself (hands have no haptics, and their holds resolve per frame below instead).
      this.pulse(i, 0.15, 10);
      this.tapE(i);
      return;
    }
    // A hand with a pinch value is read per frame at FULL_PINCH (readHandPinches); its native
    // select fires early on Galaxy XR and must not start a hold.
    if (handPinchDown(st.source) !== null) return;
    st.selectHeld = true;
  }

  private onSelectEnd(i: number): void {
    if (handPinchDown(this.rays[i].source) !== null) return;
    this.rays[i].selectHeld = false;
  }

  /**
   * Hands that report a pinch value hold select at a full pinch (FULL_PINCH), not at the
   * runtime's early native select. Runs first in the frame: the ladder climb, panel presses and
   * updateHolds all read selectHeld.
   */
  private readHandPinches(): void {
    for (const st of this.rays) {
      const down = handPinchDown(st.source);
      if (down !== null) st.selectHeld = down;
    }
  }

  /** The tap itself: E on whatever that ray hovers, through the shared dispatch. */
  private tapE(i: number): void {
    if (!this.active) return;
    const st = this.rays[i];
    // Panel presses stream through routeRay's own pointerDown/pointerUp, so by the time a tap
    // resolves there is nothing left to click here; the world hover is what E is for.
    if (st.uiConsumed || st.touch.active) return;
    if (this.grab?.use(i, this.grabAim(i))) return;
    const hover = st.hover;
    // On the ladder or a pole, E lets go (and only that): the rungs are in your hands rather
    // than under the ray, so it fires with nothing in reach — like the desktop key, anywhere
    // but on a panel.
    if (this.hooks.player.rig) {
      this.hooks.reachAnim();
      this.hooks.useE(hover?.it ?? null, hover ? this.hooks.noteUnder(hover) : null);
      this.pulse(i, 0.4, 25);
      return;
    }
    if (!hover?.near) return;
    this.hooks.reachAnim();
    this.hooks.useE(hover.it, this.hooks.noteUnder(hover), this.hooks.spotUnder?.(hover) ?? null);
    this.ui?.setCarrying(this.hooks.carrying());
    this.pulse(i, 0.4, 25);
  }

  /** Squeeze grabs nearby objects first; with empty hands away from them it cancels. */
  private onSqueeze(i: number): void {
    if (!this.active) return;
    const st = this.rays[i];
    // Chromium never fires squeeze for hands (its hand profiles bind no squeeze, only pinch and
    // grasp; device/vr/openxr/openxr_input_helper.cc reads squeeze from kSqueeze alone), but
    // other runtimes may: the pinch arbiter owns hand input exclusively either way.
    if (st.source?.hand) return;
    if (this.grab?.held) return;
    const anchor = this.grabAnchor(st);
    if (!st.uiConsumed && !st.touch.active && !this.hooks.player.rig && !this.teleportAiming() && anchor && this.grab?.begin(i, st.handed ?? 'right', anchor)) {
      this.pulse(i, 0.4, 25);
      return;
    }
    if (this.hooks.carrying()) {
      this.hooks.putBack();
      this.ui?.setCarrying(this.hooks.carrying());
      this.pulse(i, 0.3, 20);
    } else if (this.hooks.closeTop()) {
      this.pulse(i, 0.3, 20);
    } else if (this.ui) {
      this.ui.toggleMenu();
      this.pulse(i, 0.3, 20);
    }
  }

  private grabAim(i: number): GrabAim | null {
    const st = this.rays[i];
    return !st.uiConsumed && st.hover?.near ? { it: st.hover.it, note: this.hooks.noteUnder(st.hover) } : null;
  }

  /** Real grip for controllers, midpoint of the tracked pinch for hands. Never stale joints. */
  private grabAnchor(st: RayState): THREE.Object3D | null {
    if (!st.source) return null;
    if (!st.source.hand) return st.grip.visible ? st.grip : null;
    const index = st.hand.joints['index-finger-tip'];
    const thumb = st.hand.joints['thumb-tip'];
    if (!st.hand.visible || !index?.visible || !thumb?.visible) return null;
    index.getWorldPosition(_e);
    thumb.getWorldPosition(_u);
    st.pinchAnchor.position.copy(this.dolly.worldToLocal(_e.add(_u).multiplyScalar(0.5)));
    this.dolly.getWorldQuaternion(_q).invert();
    index.getWorldQuaternion(st.pinchAnchor.quaternion).premultiply(_q);
    st.pinchAnchor.updateMatrixWorld(true);
    return st.pinchAnchor;
  }

  /**
   * A short controller rumble, where the browser offers one. On Chrome (Galaxy XR included)
   * this is currently a no-op: XRInputSource returns no vibration actuator for XR gamepads
   * (third_party/blink/renderer/modules/xr/xr_input_source.h, GetVibrationActuatorForGamepad
   * returns nullptr, crbug.com/955097), so `gamepad.vibrationActuator` is null, and Blink never
   * had the older `hapticActuators`. The standard `vibrationActuator.playEffect` is tried first
   * so haptics start working the day Chrome implements it; `hapticActuators[0].pulse` covers
   * browsers that still ship the old API. Feedback that matters must not rely on this.
   */
  private pulse(i: number, strength: number, ms: number): void {
    const gp = controllerPad(this.rays[i]?.source) as (Gamepad & { hapticActuators?: readonly { pulse?: (s: number, ms: number) => Promise<unknown> }[] }) | undefined;
    if (!gp) return;
    try {
      if (gp.vibrationActuator) {
        void gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength }).catch(() => {});
        return;
      }
      void gp.hapticActuators?.[0]?.pulse?.(strength, ms)?.catch(() => {});
    } catch {
      // A browser that exposes an actuator but rejects the effect: no haptics on this controller.
    }
  }

  /** One VR frame, in place of player.update: input, locomotion, and the rays' visuals. */
  update(dt: number): void {
    if (!this.active) return;
    const { player } = this.hooks;
    this.frame++;
    this.readHandPinches();
    const rigged = !!player.rig;
    if (rigged) {
      // The ladder or a pole has hold of the avatar: the desktop update that normally steps the
      // rig never runs in VR, so the session steps it here. The glide stick works the rungs (poles
      // ignore it and slide on their own); teleports, glides and room-scale wait until it's done.
      player.climbInput = this.climbDir();
      player.rig!(dt);
    } else {
      player.climbInput = 0;
      // Whatever left the avatar airborne (the ladder's drop): fall, like desktop.
      if (!player.seat) this.applyGravity(dt);
    }
    if (player.seat && !rigged && (this.glideIntent() || this.rays.some((r) => r.teleportHeld) || this.stickAiming)) player.stand();
    this.dolly.updateMatrixWorld(true);
    // Procedural grips stand in until each controller's profile model loads (or all session, offline).
    for (const r of this.rays) r.fallback.visible = !!r.source && !r.source.hand && !!r.source.gamepad && !r.ctrlModel.motionController;
    this.pollButtons();
    this.updateHover();
    this.updateTouches();
    if (this.ui) {
      // The UI follows the head in world space, from the rig's own math — three's XR camera
      // only holds the headset pose in reference space (see HeadPose), so it can't feed this.
      this.headWorld(_h);
      this.lookDir(_d);
      _head.pos[0] = _h.x;
      _head.pos[1] = _h.y;
      _head.pos[2] = _h.z;
      _head.dir[0] = _d.x;
      _head.dir[1] = _d.y;
      _head.dir[2] = _d.z;
      this.ui.update(dt, _head);
      for (let i = 0; i < 2; i++) {
        if (this.rays[i]?.uiConsumed) this.ui.stickScroll(i, this.stick(i).y, dt);
      }
    }
    this.updateHolds();
    this.updateTeleport();
    this.updateTurn(dt);
    if (!rigged) this.updateGlide(dt);
    this.followHead();
    this.dolly.updateMatrixWorld(true);
    for (let i = 0; i < this.rays.length; i++) {
      if (this.grab?.owns(i) && !this.grabAnchor(this.rays[i])) this.clearGrab();
    }
    this.headWorld(_h);
    _h.y -= 0.08;
    this.grab?.update(_h, performance.now());
    this.updateFade(dt);
    // What the flat mirror's hint bar shows: the right ray's target, else the left's.
    // The headset's aim bar names what E would do to the same target (quiet while climbing).
    const aim = this.rayFor('right')?.hover ?? this.rayFor('left')?.hover ?? null;
    const note = aim?.near ? this.hooks.noteUnder(aim) : null;
    const spot = aim?.near ? (this.hooks.spotUnder?.(aim) ?? null) : null;
    this.hooks.onTarget(aim?.near ? aim.it : null, note, spot);
    const label = !rigged && aim?.near ? this.hooks.aimLabel(aim.it, note) : null;
    if (label !== this.aimText) {
      this.aimText = label;
      this.ui?.setAim(label);
    }
  }

  /** Contact uses live fingertips and palm joints, without requiring a pinch or a ray aim. */
  private updateTouches(): void {
    const now = performance.now();
    const blocked = !!this.hooks.player.rig || this.teleportAiming() || this.fade !== 'idle';
    for (let i = 0; i < this.rays.length; i++) {
      const st = this.rays[i];
      let target: Interactable | null = null;
      let touchingJoint: XRHandJoint | null = null;
      let tracked = false;
      if (st.source?.hand && st.hand.visible) {
        for (const name of TOUCH_JOINTS) {
          const joint = st.hand.joints[name];
          if (!joint?.visible) continue;
          tracked = true;
          // A hand holding an object is tracked but touches nothing the object brushes past.
          if (this.grab?.owns(i)) break;
          target = this.hooks.touchTarget?.(joint.getWorldPosition(_e), name === 'index-finger-tip') ?? null;
          if (target) {
            touchingJoint = name;
            break;
          }
        }
      }
      // Tracking loss is not a withdrawal: keep the latch, but never fire from stale poses.
      if (!tracked || (!target && st.touchJoint && !st.hand.joints[st.touchJoint]?.visible)) continue;
      st.touchTarget = target;
      st.touchJoint = touchingJoint;
      st.touch.update(!!target, now);
      if (st.touch.active) st.hold.consume();
      if (target && !this.contacts.has(target)) this.contacts.set(target, new TouchPress());
    }
    for (const [target, contact] of this.contacts) {
      const pressed = contact.update(
        this.rays.some((st) => st.touchTarget === target),
        now,
      );
      if (pressed && !blocked && this.rays.some((st) => st.touchTarget === target && !st.uiConsumed)) {
        this.hooks.reachAnim();
        this.hooks.useE(target, null);
      }
      if (!contact.active) this.contacts.delete(target);
    }
  }

  /**
   * Hand-tracked pinches, resolved per frame from the union of the hand's select state (a full
   * pinch value, see FULL_PINCH) and three's joint-distance pinch events (one pinch both
   * signals see still reads as one hold): a tap is E, a hold aims a teleport the release fires, and both hands together
   * toggle the menu. Controllers never reach here — their trigger fires E at once, with A for
   * teleports and squeeze for grabbing/cancel.
   */
  private updateHolds(): void {
    const now = performance.now();
    const rigged = !!this.hooks.player.rig;
    const hands = [0, 1].filter((i) => {
      const st = this.rays[i];
      return st?.source && !!st.source.hand;
    });
    const heldNow = hands.filter((i) => {
      const st = this.rays[i];
      return (st.selectHeld || st.pinchHeld) && !this.grab?.owns(i);
    });
    // Both hands down together: the menu gesture owns both holds, so neither may start aiming
    // (without this each crosses the aim threshold first and the menu never fires).
    const bothHeld = heldNow.length === 2;
    for (const i of hands) {
      const st = this.rays[i];
      const held = st.selectHeld || st.pinchHeld;
      if (!held && st.hold.isHeld) {
        this.grab?.release(i, this.grabAim(i));
        const out = st.hold.release();
        if (out === 'teleport') this.fireTeleport(i);
        else if (out === 'select') this.tapE(i);
      } else if (held) {
        // On a panel a hold drags/scrolls, on the ladder it stays a tap (E lets go): neither aims.
        const anchor = this.grabAnchor(st);
        const nearGrab = !st.uiConsumed && !st.touch.active && !rigged && !!anchor && !!this.grab?.canGrab(anchor.getWorldPosition(_e));
        st.hold.update(true, now, st.uiConsumed || bothHeld || rigged || nearGrab || !!this.grab?.owns(i));
        if (nearGrab && !st.hold.isConsumed && !st.hold.isAiming && now - st.hold.heldSince >= GRAB_HOLD_MS && this.grab?.begin(i, st.handed ?? 'right', anchor!)) {
          st.hold.consume();
          this.ui?.cancelRay(i);
        }
        // A touch owns even a pinch that started on this very frame. Withdrawing and
        // releasing must not also tap the ray's target or start a teleport.
        if (st.touch.active) st.hold.consume();
      }
    }
    // Both hands pinching together: the menu, claimed before either hold can aim or tap —
    // unless a ray works a panel (two-handed typing holds both pinches; the menu would pop up
    // mid-word and eat the holds).
    if (bothHeld && this.ui) {
      const [ra, rb] = [this.rays[heldNow[0]], this.rays[heldNow[1]]];
      if (ra.uiConsumed || rb.uiConsumed || ra.touch.active || rb.touch.active) return;
      const [a, b] = [ra.hold, rb.hold];
      const since = Math.min(a.heldSince, b.heldSince);
      if (since >= 0 && !a.isConsumed && !b.isConsumed && !a.isAiming && !b.isAiming && now - since >= MENU_HOLD_MS) {
        a.consume();
        b.consume();
        this.ui.toggleMenu();
        this.pulse(heldNow[0], 0.3, 20);
      }
    }
  }

  /** Head pose in rig space (three's XR camera is the headset, parented under the dolly). */
  private headLocal(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.renderer.xr.getCamera().position);
  }

  /** The head in the world, through the rig. */
  private headWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.headLocal(_l)).applyAxisAngle(UP, this.yaw).add(this.origin);
  }

  /** The head's orientation in the world: the rig's yaw composed with the headset's own. */
  private headQuat(out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.renderer.xr.getCamera().quaternion).premultiply(this.dolly.quaternion);
  }

  /** Head look direction in the world, for the ears (the camera's own direction is the rig's). */
  lookDir(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.headQuat(_q));
  }

  /** Which way the head looks, on the XZ plane, in avatar-facing convention. */
  private headFacing(): number {
    _f.set(0, 0, -1).applyQuaternion(this.headQuat(_q));
    return Math.atan2(_f.x, _f.z);
  }

  /** Stick deflection for a ray's gamepad. */
  private stick(i: number): { x: number; y: number } {
    return decodeThumbstick(this.gamepad(i)?.axes ?? []);
  }

  /**
   * The ray for a hand. By handedness when the runtime reports it; else by slot (0 left, 1
   * right) — but only while neither ray claims a hand, so a lone right controller never also
   * reads as the left stick.
   */
  private rayFor(hand: 'left' | 'right'): RayState | undefined {
    const known = this.rays.find((r) => r.source && r.handed === hand);
    if (known) return known;
    if (this.rays.some((r) => r.source && r.handed)) return undefined;
    const slot = this.rays[hand === 'left' ? 0 : 1];
    return slot?.source ? slot : undefined;
  }

  /** The glide/climb stick: the left controller's, else the right's when it flies solo. */
  private moveStick(): { x: number; y: number } {
    const r = this.rayFor('left') ?? this.rayFor('right');
    return decodeThumbstick(controllerPad(r?.source)?.axes ?? []);
  }

  /** The turn stick: the right controller's, else the left's when it flies solo. */
  private turnStick(): { x: number; y: number } {
    const r = this.rayFor('right') ?? this.rayFor('left');
    return decodeThumbstick(controllerPad(r?.source)?.axes ?? []);
  }

  /** Ladder rungs from the glide stick: push up to climb, down to go back. Hands pinch instead (see pinchClimb). */
  private climbDir(): number {
    const y = this.moveStick().y;
    if (y < -0.35) return 1;
    if (y > 0.35) return -1;
    return this.pinchClimb(performance.now());
  }
  /**
   * Ladder rungs for hand tracking (no thumbsticks there): hold the right pinch to climb, the
   * left to go back down. A hold that climbs is consumed, so letting go of the rungs doesn't
   * also tap E and drop you; quick taps still let go, both hands together still open the menu,
   * and poles (which slide on their own) ignore this.
   */
  private pinchClimb(now: number): number {
    if (!this.hooks.player.rig) return 0;
    const held: { st: RayState; dir: number }[] = [];
    for (const st of this.rays) {
      if (!st.source?.hand) continue;
      if (!st.selectHeld && !st.pinchHeld) continue;
      const dir = st.handed === 'right' ? 1 : st.handed === 'left' ? -1 : 0;
      if (!dir) continue;
      held.push({ st, dir });
    }
    // None held, or both: the menu gesture owns two hands, not the rungs.
    if (held.length !== 1) return 0;
    const [{ st, dir }] = held;
    const since = st.hold.heldSince;
    if (since < 0 || now - since < PINCH_HOLD_MS) return 0;
    st.hold.consume();
    return dir;
  }

  /** A ray's controller gamepad; undefined for hands (see controllerPad). Every stick and button read goes through this. */
  private gamepad(i: number): Gamepad | undefined {
    return controllerPad(this.rays[i]?.source);
  }

  /**
   * The ray out of a target-ray space, into _o (origin) and _d (direction). See
   * xrRayDirection for why this is -Z and not getWorldDirection.
   */
  private rayOut(st: RayState): void {
    _o.setFromMatrixPosition(st.targetRay.matrixWorld);
    xrRayDirection(st.targetRay, _d);
  }

  /** Glide intent this frame (also what stands the avatar up first). */
  private glideIntent(): boolean {
    if (!this.hooks.settings.vr.glide) return false;
    const s = this.moveStick();
    return Math.hypot(s.x, s.y) > STICK_ON;
  }

  /**
   * Edge-triggered buttons: B/Y or stick-click is N; A hold (or stick-forward) aims a teleport.
   * Controllers only: this.gamepad() is undefined for a tracked hand, so every read below is
   * false for hands. Keep it that way (see controllerPad for what a hand's [4] actually is).
   */
  private pollButtons(): void {
    const rigged = !!this.hooks.player.rig;
    for (let i = 0; i < 2; i++) {
      const st = this.rays[i];
      const gp = this.gamepad(i);
      const face = faceButtons(gp);
      const n = buttonDown(gp, face.stick) || buttonDown(gp, face.b);
      if (n && !st.wasN) this.hooks.nextWaiting();
      st.wasN = n;
      // Teleport aim lives on A hold; release fires it. A ray on a UI panel cancels the aim
      // without firing (that ray's stick scrolls the panel instead), as does the ladder or a pole.
      const held = !rigged && buttonDown(gp, face.a);
      if (st.uiConsumed) {
        st.teleportHeld = false;
      } else {
        if (st.teleportHeld && !held) this.fireTeleport();
        st.teleportHeld = held;
      }
    }
    // Stick-aimed teleports (glide off): pushing forward aims, release past center fires.
    const moveRay = this.rayFor('left') ?? this.rayFor('right');
    const moveIdx = moveRay ? this.rays.indexOf(moveRay) : -1;
    if (!rigged && !this.hooks.settings.vr.glide && moveIdx >= 0 && !this.rays[moveIdx]?.uiConsumed) {
      const y = this.stick(moveIdx).y;
      if (this.stickAiming && y > -STICK_OFF) {
        this.stickAiming = false;
        this.fireTeleport();
      } else if (!this.stickAiming && y < -STICK_ON) {
        this.stickAiming = true;
      }
    } else {
      this.stickAiming = false;
    }
  }

  private teleportAiming(): boolean {
    return this.rays.some((r) => r.teleportHeld) || this.rays.some((r) => r.hold.isAiming) || this.stickAiming;
  }

  /**
   * Raycast both rays against the panels every frame (clicks must feel instant) and against
   * the world on alternating frames (each ray's hover refreshes every 2nd frame — the full
   * office intersect is the dearest raycast here). Parks the cursor dots on what they hit.
   */
  private updateHover(): void {
    const aiming = this.teleportAiming();
    for (let i = 0; i < this.rays.length; i++) {
      const st = this.rays[i];
      st.uiConsumed = false;
      if (!st.source || aiming) {
        st.hover = null;
        st.line.visible = !aiming && !!st.source;
        st.dot.visible = false;
        continue;
      }
      this.rayOut(st);
      this.raycaster.set(_o, _d);
      // Sprites (name tags, chat bubbles) need a camera on the raycaster; setFromCamera does
      // this on desktop, but the VR path builds rays by hand. Without it every frame logs.
      this.raycaster.camera = this.camera;
      // World-space UI panels eat the ray first; the world only sees rays no panel took.
      if (this.ui && !this.grab?.owns(i) && !(st.source.hand && st.hold.isConsumed && st.hold.isHeld)) {
        const gp = this.gamepad(i);
        const pressed = !st.touch.active && !st.hold.isConsumed && (buttonDown(gp, XR_BUTTON.TRIGGER) || st.selectHeld || st.pinchHeld);
        if (this.ui.routeRay(i, this.raycaster, pressed)) {
          st.uiConsumed = true;
          st.hover = null;
          st.line.visible = true;
          // The cursor dot parks on the panel, so presses land where the eye says they will.
          const p = this.ui.panelHit(i);
          st.dot.visible = !!p;
          if (p) {
            st.dot.position.copy(st.targetRay.worldToLocal(_e.copy(p)));
            st.dot.scale.setScalar(1);
            (st.dot.material as THREE.MeshBasicMaterial).color.set(0xee6018);
            // The line ends where the dot parks (no piercing the panel into the room behind).
            st.line.scale.z = THREE.MathUtils.clamp(st.dot.position.length() / 5, 0.02, 1);
          } else {
            st.line.scale.z = 1;
          }
          continue;
        }
      }
      if ((this.frame + i) & 1) continue; // this ray's world hover refreshes next frame
      this.raycaster.far = this.hooks.reachOf('tv') + 6;
      const aim = this.hooks.pickFromRay(this.raycaster, 0);
      st.hover = aim;
      st.line.visible = true;
      st.dot.visible = !!aim;
      if (aim) {
        st.dot.position.copy(st.targetRay.worldToLocal(aim.hit.point.clone()));
        const m = st.dot.material as THREE.MeshBasicMaterial;
        st.dot.scale.setScalar(aim.near ? 1.5 : 1);
        m.color.set(aim.near ? 0x51ff7a : 0x7df9ff);
        st.line.scale.z = THREE.MathUtils.clamp(st.dot.position.length() / 5, 0.02, 1);
      } else {
        st.line.scale.z = 1;
      }
    }
  }

  /** Parabolic teleport: draw the arc and landing marker while aimed; release fires it. */
  private updateTeleport(): void {
    if (!this.teleportAiming()) {
      this.arc.visible = false;
      this.marker.visible = false;
      return;
    }
    const st = this.aimingRay();
    if (!st?.source) {
      this.arc.visible = false;
      this.marker.visible = false;
      return;
    }
    this.rayOut(st);
    const pts = sampleParabola(_o, _d);
    const pos = this.arc.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ARC_STEPS; i++) pos.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    pos.needsUpdate = true;
    this.arc.visible = true;
    const landing = this.findLanding(pts);
    const at = landing ?? pts[pts.length - 1];
    this.marker.position.set(at.x, at.y + 0.02, at.z);
    (this.marker.material as THREE.MeshBasicMaterial).color.set(landing ? 0x51ff7a : 0xff5151);
    this.marker.visible = true;
  }

  /** The hand holding (or that held) the teleport aim: a pinching hand wins over A. */
  private aimingRay(): RayState | undefined {
    return this.rays.find((r) => r.source && r.hold.isAiming) ?? this.rays.find((r) => r.source && r.teleportHeld) ?? this.rays.find((r) => r.source);
  }

  /** Fire the aimed teleport: through the fade when it's on, straight there when it's off. */
  private fireTeleport(from?: number): void {
    // A released pinch already reset its aim flag, so the caller names the hand it came from.
    const st = from !== undefined ? this.rays[from] : this.aimingRay();
    if (!st?.source) return;
    this.rayOut(st);
    const landing = this.findLanding(sampleParabola(_o, _d));
    if (!landing) return;
    this.pulse(from ?? 0, 0.5, 30);
    if (this.hooks.settings.vr.fade) {
      this.pendingTeleport = landing;
      this.fade = 'out';
      this.fadeT = 0;
    } else {
      this.placeAvatar(landing);
    }
  }

  /** First arc point at/below the floor it's over, when it's somewhere standable. */
  private findLanding(pts: THREE.Vector3[]): THREE.Vector3 | null {
    const { player } = this.hooks;
    for (const p of pts) {
      const g = Math.max(player.groundBelow(p.x, p.z, p.y + 1), player.street);
      if (!Number.isFinite(g) || p.y > g + 0.1) continue;
      if (Math.abs(g - player.pos.y) > 8) continue;
      if (player.blockedAt(p.x, p.z, g)) continue;
      return new THREE.Vector3(p.x, g, p.z);
    }
    return null;
  }

  /** Snap- or smooth-turn the rig around the head, so turning never translates the avatar. */
  private updateTurn(dt: number): void {
    const { settings } = this.hooks;
    const axisX = this.turnStick().x;
    let dYaw = 0;
    if (settings.vr.turn === 'snap') dYaw = this.snap.update(axisX);
    else if (Math.abs(axisX) > 0.15) dYaw = -axisX * THREE.MathUtils.degToRad(settings.vr.turnSpeed) * dt;
    if (dYaw === 0) return;
    this.setYaw(this.yaw + dYaw);
  }

  /** Smooth stick glide (a Settings toggle, default off): the avatar walks the stick direction. */
  private updateGlide(dt: number): void {
    this.glideActive = false;
    if (!this.hooks.settings.vr.glide) return;
    const moveRay = this.rayFor('left') ?? this.rayFor('right');
    if (moveRay?.uiConsumed) return; // the stick scrolls the panel under the ray instead
    const { player } = this.hooks;
    if (player.seat) return;
    const s = this.moveStick();
    if (Math.hypot(s.x, s.y) < 0.15) return;
    _f.set(0, 0, -1).applyQuaternion(this.headQuat(_q));
    _f.y = 0;
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1);
    _f.normalize();
    _l.set(-_f.z, 0, _f.x);
    const speed = 4.6 * player.speedBoost;
    let dx = (_l.x * s.x - _f.x * s.y) * speed * dt;
    let dz = (_l.z * s.x - _f.z * s.y) * speed * dt;
    // Drunk, the feet wander off to one side and then the other (the desktop stagger's own
    // wobble, on the glide heading instead of the camera yaw).
    const staggerT = performance.now() / 1000;
    const stagger = this.sway * (0.4 * Math.sin(staggerT * 1.6) + 0.22 * Math.sin(staggerT * 3.7 + 1));
    if (stagger !== 0) {
      const c = Math.cos(stagger);
      const s2 = Math.sin(stagger);
      const rx = dx * c - dz * s2;
      dz = dx * s2 + dz * c;
      dx = rx;
    }
    // In small steps, so a fast glide can't tunnel through a desk.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
    for (let i = 0; i < steps; i++) player.stepTo(player.pos.x + dx / steps, player.pos.z + dz / steps);
    this.glideActive = true;
    this.snapGround();
  }

  /**
   * Room-scale, and everything desktop-side, flow into the avatar here. The rig follows the head:
   * wherever the headset goes (within collision), the avatar goes; wherever desktop code puts the
   * player (N, the elevator, a ladder), the rig rebases so the head stays continuous.
   */
  private followHead(): void {
    const { player } = this.hooks;
    this.headWorld(_h);
    _e.subVectors(player.pos, this.lastAvatar);
    _e.y = 0;
    let roomMoved = false;
    if (_e.length() > 1e-4) {
      // Desktop code moved the player: carry the rig along, head unmoved.
      this.origin.add(_e);
    } else if (!player.seat && !player.rig) {
      // Room-scale: walk the avatar under the head through the usual collision. (Seated, and on
      // the ladder or a pole, the avatar stays where it was put; the rig still rebases below.)
      const dx = _h.x - player.pos.x;
      const dz = _h.z - player.pos.z;
      if (Math.hypot(dx, dz) > 1e-4) {
        roomMoved = true;
        player.stepTo(_h.x, _h.z);
        this.snapGround();
      }
    }
    // The rig stands at the avatar's height, every frame — not only when the XZ carry fires:
    // climbs and falls move in Y alone (the carry goes quiet once the ladder's rungs center
    // you), and a stale frame would strand the head while the avatar climbs on.
    this.origin.y = player.pos.y;
    this.dolly.position.copy(this.origin);
    this.dolly.rotation.y = this.yaw;
    // Drunk in the headset: the rig rolls and pitches with the desktop shake's own wobble
    // (see PlayerController.shake). Roll and pitch leave the head's XZ heading alone, so the
    // avatar's facing and the room-scale carry never notice; the horizon does.
    const t = performance.now() / 1000;
    const d = this.sway;
    this.dolly.rotation.z = d > 0 ? d * (0.07 * Math.sin(t * 0.9) + 0.025 * Math.sin(t * 2.3 + 1)) : 0;
    this.dolly.rotation.x = d > 0 ? d * 0.03 * Math.sin(t * 0.7 + 2) : 0;
    // Virtual moves carry the modal panels (teleports, glides, N, falls, elevator rides):
    // whatever moved the avatar since last frame, in full 3D. Room-scale walking leaves them
    // world-fixed — when you walk on your feet, staying put is correct.
    if (!roomMoved) {
      _u.subVectors(player.pos, this.lastAvatar);
      if (_u.lengthSq() > 1e-10) this.ui?.carryAlong(_u);
    }
    this.lastAvatar.copy(player.pos);
    player.moving = this.glideActive || roomMoved || _e.length() > 1e-4 || this.fade !== 'idle';
    player.facing = this.headFacing();
    player.camYaw = player.facing - Math.PI;
  }

  /** Stay on the floor: up stairs freely, down a step at a time, never through the loft. */
  private snapGround(): void {
    const { player } = this.hooks;
    const g = Math.max(player.groundBelow(player.pos.x, player.pos.z, player.pos.y), player.street);
    if (!Number.isFinite(g)) return;
    if (g > player.pos.y) player.pos.y = g;
    else if (player.pos.y - g <= STEP + 0.02) player.pos.y = g;
  }

  /**
   * Falling in VR (the desktop update that owns gravity never runs while presenting): the
   * ladder's drop is the usual way up, and without this the avatar would float where E let go
   * of the rungs. The same constants as player.update, minus the jump.
   */
  private applyGravity(dt: number): void {
    const { player } = this.hooks;
    // Never below the street: past the edge of the grass there's nothing else to stand on.
    const g = Math.max(player.groundBelow(player.pos.x, player.pos.z, player.pos.y), player.street);
    if (!Number.isFinite(g)) return;
    if (player.grounded && player.pos.y > g && player.pos.y - g <= STEP + 0.02) {
      // Walking down a stair: stay on your feet rather than falling a step.
      player.stepOffset += player.pos.y - g;
      player.pos.y = g;
    }
    player.vy -= GRAVITY * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= g) {
      player.pos.y = g;
      player.vy = 0;
      player.grounded = true;
    } else if (player.pos.y > g + 0.02) {
      player.grounded = false;
    }
  }

  /** Puts the avatar somewhere on this floor, through the fade when it's on (the people view's walk-over). The caller picked a standable spot. */
  teleportTo(at: THREE.Vector3): void {
    if (!this.active) return;
    if (this.hooks.settings.vr.fade) {
      this.pendingTeleport = at.clone();
      this.fade = 'out';
      this.fadeT = 0;
    } else {
      this.placeAvatar(at);
    }
  }
  private placeAvatar(at: THREE.Vector3): void {
    const { player } = this.hooks;
    player.pos.set(at.x, at.y, at.z);
    player.vy = 0;
    player.grounded = true;
    this.snapGround();
    // followHead carries the rig and the modal panels off the move next frame.
  }

  private updateFade(dt: number): void {
    if (this.fade === 'idle') return;
    this.fadeMesh.visible = true;
    const m = this.fadeMesh.material as THREE.MeshBasicMaterial;
    if (this.fade === 'out') {
      this.fadeT += dt / 0.09;
      m.opacity = Math.min(1, this.fadeT);
      if (this.fadeT >= 1) {
        if (this.pendingTeleport) {
          this.placeAvatar(this.pendingTeleport);
          this.pendingTeleport = null;
        }
        // Trips hold the black until the far side calls fadeIn; teleports fade straight back.
        if (this.fadeHold) {
          m.opacity = 1;
        } else {
          this.fade = 'in';
          this.fadeT = 0;
        }
      }
    } else {
      this.fadeT += dt / 0.14;
      m.opacity = Math.max(0, 1 - this.fadeT);
      if (this.fadeT >= 1) {
        this.fade = 'idle';
        this.fadeMesh.visible = false;
      }
    }
  }
}
