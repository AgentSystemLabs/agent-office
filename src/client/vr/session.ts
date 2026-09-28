// The WebXR session: rig, controller/hand input, and locomotion for the headset browser.
// Plain Three.js WebXR (renderer.xr + setAnimationLoop).
//
// Hands speak pinch: three forwards the runtime's select events plus its own joint-distance
// pinchstart/pinchend to the target-ray spaces, and the session reads their union as one
// held state per hand — a tap is E, a hold is a teleport aim, both hands together open the
// menu. Controllers keep their instant trigger (they have A for teleport, squeeze for menu).
//
// The rig is the standard three dolly: the desktop camera is reparented under a Group at the
// avatar's feet while presenting, and three composes the headset pose with it
// (WebXRManager.updateCamera). The avatar (player.pos) stays the source of truth: VR locomotion
// moves it through the same collision as walking, the desktop move sender picks it up unchanged,
// and anything desktop-side that moves the player (N, the elevator, ladders) rebases the rig.

import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { STEP } from '../player';
import type { PlayerController } from '../player';
import type { Settings } from '../state';
import type { Collider, InteractKind, Interactable } from '../world/office';
import type { CarriedIssue, GhIssue } from '../../shared/protocol';
import { describeSessionError, requestVRSession, type VrReferenceSpace } from './support';

/** Standard WebXR gamepad buttons (OpenXR / XR Standard mapping). */
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

/**
 * One hand's pinch, read as tap-vs-hold: fed the live held state plus a clock, it reports
 * the moment a hold becomes a teleport aim, and what a release means. The session ORs the
 * runtime's select events with three's pinchstart/pinchend into `held`, so runtimes that
 * fire both for one pinch still produce a single tap.
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

/** What the session needs from main.ts, which owns the world, the dispatch, and the HUD. */
export interface VRHooks {
  player: PlayerController;
  settings: Settings;
  /** E on an Interactable: the same `use()` the keyboard calls. Never forked. */
  useE: (it: Interactable, note: GhIssue | null) => void;
  /** The shared ray picker (office, gallery, dog, or the roof's): ray in, Interactable out. */
  pickFromRay: (ray: THREE.Raycaster, slack: number) => { it: Interactable; near: boolean; hit: THREE.Intersection } | null;
  /** The issue note under an aim on the issues board, if any. */
  noteUnder: (aim: { it: Interactable; hit: THREE.Intersection } | null) => GhIssue | null;
  /** N: the next worker waiting on someone. */
  nextWaiting: () => void;
  /** Q with a card in hand: pin it back up. */
  putBack: () => void;
  carrying: () => CarriedIssue | null;
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
  onTarget: (it: Interactable | null, note: GhIssue | null) => void;
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
const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _m = new THREE.Matrix4();

interface RayState {
  targetRay: THREE.XRTargetRaySpace;
  grip: THREE.XRGripSpace;
  hand: THREE.XRHandSpace;
  source: XRInputSource | null;
  /** The runtime's select is down (controllers: fires E at once; hands: feeds the hold). */
  selectHeld: boolean;
  /** three's joint-distance pinch is down (hand-tracked sources only). */
  pinchHeld: boolean;
  /** Tap-vs-hold for hand-tracked sources. */
  hold: PinchHold;
  hover: { it: Interactable; near: boolean; hit: THREE.Intersection } | null;
  /** A world-space UI panel owns this ray this frame (world input yields to it). */
  uiConsumed: boolean;
  teleportHeld: boolean;
  wasN: boolean;
  line: THREE.Line;
  dot: THREE.Mesh;
}

/** World-space UI panels (vr/attach.ts): the session routes rays to them first and ticks them. */
export interface VRUiSink {
  routeRay: (rayId: number, raycaster: THREE.Raycaster, pressed: boolean) => boolean;
  stickScroll: (rayId: number, axisY: number, dt: number) => void;
  update: (dt: number, camera?: THREE.Camera | null) => void;
  toggleMenu: () => void;
  openTerminal: (workerId: string) => void;
}

export class VRSession {
  /** Set once the probe answers: the Enter VR button shows only when true. */
  available = false;
  /** An immersive session is presenting right now. */
  active = false;
  /** The rig: the camera hangs under this at the avatar's feet while presenting. */
  readonly dolly = new THREE.Group();

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private hooks: VRHooks;
  private session: XRSession | null = null;
  private cameraParent: THREE.Object3D | null = null;
  /** Where the rig stands (feet) and which way is straight ahead (-Z local). */
  private origin = new THREE.Vector3();
  private yaw = 0;
  private lastAvatar = new THREE.Vector3();
  private rays: RayState[] = [];
  private raycaster = new THREE.Raycaster();
  private arc: THREE.Line;
  private marker: THREE.Mesh;
  private fadeMesh: THREE.Mesh;
  private fade: 'idle' | 'out' | 'in' = 'idle';
  private fadeT = 0;
  private pendingTeleport: THREE.Vector3 | null = null;
  private snap = new SnapTurn();
  private stickAiming = false;
  private glideActive = false;
  /** Alternating frames halve the world-hover raycasts (each ray refreshes every 2nd frame). */
  private frame = 0;
  /** World-space UI panels, set by main.ts on session enter and cleared on end. Null on desktop. */
  private ui: VRUiSink | null = null;
  private onSessionEnd = () => this.restore();

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hooks: VRHooks) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.hooks = hooks;
    this.dolly.visible = false;
    scene.add(this.dolly);

    // Tracked hands and controllers: the real devices' poses drive these models. Hands get
    // the skinned generic-hand mesh (vendored under /xr-hands so no CDN can break them), with
    // three's joint spheres behind as a fallback that hides once the mesh loads; controllers
    // get their input-profile models. They hang under the grip/hand spaces, which join the rig
    // on session enter, and show/hide themselves off the runtime's connected events. The
    // desktop cartoon hands sit out in VR.
    const controllerModelFactory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
      const targetRay = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      grip.add(controllerModelFactory.createControllerModel(grip));
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
      const st: RayState = { targetRay, grip, hand, source: null, selectHeld: false, pinchHeld: false, hold: new PinchHold(), hover: null, uiConsumed: false, teleportHeld: false, wasN: false, line, dot };
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
      this.rays.push(st);
    }
    // Parabolic arc + landing marker, drawn while a teleport is aimed.
    this.arc = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(new Array(ARC_STEPS).fill(0).map(() => new THREE.Vector3())),
      new THREE.LineBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.9 }),
    );
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.26, 32),
      new THREE.MeshBasicMaterial({ color: 0x51ff7a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
    );
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
    for (const r of this.rays) {
      this.dolly.add(r.targetRay, r.grip, r.hand);
      r.selectHeld = false;
      r.pinchHeld = false;
      r.hold.reset();
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
    this.session = session;
    session.addEventListener('end', this.onSessionEnd);
    try {
      await this.renderer.xr.setSession(session);
    } catch (err) {
      session.removeEventListener('end', this.onSessionEnd);
      this.session = null;
      this.restore();
      this.hooks.toast(describeSessionError(err), 'error');
      return;
    }
    this.active = true;
    // Stereo at headset resolution is the whole VR perf cost, so the session renders smaller
    // and bakes the shadows once instead of every frame (the sun barely moves in a visit).
    // Foveation is already at three's maximum default.
    this.renderer.xr.setFramebufferScaleFactor(XR_FRAMEBUFFER_SCALE);
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.hooks.hudRefresh();
    this.hooks.onEnter?.();
  }

  /** Back to the desktop camera and controls, exactly as they were. */
  private restore(): void {
    const { player } = this.hooks;
    if (this.session) {
      this.session.removeEventListener('end', this.onSessionEnd);
      this.session = null;
    }
    this.active = false;
    this.fade = 'idle';
    this.fadeMesh.visible = false;
    this.pendingTeleport = null;
    this.stickAiming = false;
    this.glideActive = false;
    this.arc.visible = false;
    this.marker.visible = false;
    this.renderer.xr.setFramebufferScaleFactor(1);
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.shadowMap.needsUpdate = true;
    for (const r of this.rays) {
      r.source = null;
      r.hover = null;
      r.uiConsumed = false;
      r.teleportHeld = false;
      r.selectHeld = false;
      r.pinchHeld = false;
      r.hold.reset();
      r.wasN = false;
      r.line.visible = true;
      r.dot.visible = true;
      r.targetRay.removeFromParent();
      r.grip.removeFromParent();
      r.hand.removeFromParent();
    }
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
  }

  /** Emulator test hook (?vrtest=1): the same landing a real teleport fire would take. */
  debugTeleport(x: number, y: number, z: number): void {
    if (!this.active) return;
    this.placeAvatar(new THREE.Vector3(x, y, z));
  }

  /** Emulator test hook (?vrtest=1): the same yaw step the snap turn takes. */
  debugTurn(dYaw: number): void {
    if (!this.active) return;
    this.headWorld(_h);
    this.yaw += dYaw;
    this.dolly.rotation.y = this.yaw;
    this.headLocal(_l);
    _l.y = 0;
    _l.applyAxisAngle(UP, this.yaw);
    this.origin.set(_h.x - _l.x, this.origin.y, _h.z - _l.z);
    this.dolly.position.copy(this.origin);
  }

  private onConnected(i: number, source: XRInputSource): void {
    const st = this.rays[i];
    st.source = source;
    st.line.visible = true;
    st.dot.visible = true;
  }

  private onDisconnected(i: number): void {
    const st = this.rays[i];
    st.source = null;
    st.hover = null;
    st.selectHeld = false;
    st.pinchHeld = false;
    st.hold.reset();
    st.line.visible = false;
    st.dot.visible = false;
  }

  /**
   * Trigger down / pinch down. Controllers fire E at once (they aim teleports with A); a
   * hand-tracked pinch only marks the hold — the per-frame update decides tap (E), hold
   * (teleport aim), or both-hands (menu) on the union of this and three's pinch events.
   */
  private onSelectStart(i: number): void {
    if (!this.active) return;
    const st = this.rays[i];
    if (st.source?.gamepad) {
      this.tapE(i);
      return;
    }
    st.selectHeld = true;
  }

  private onSelectEnd(i: number): void {
    this.rays[i].selectHeld = false;
  }

  /** The tap itself: E on whatever that ray hovers, through the shared dispatch. */
  private tapE(i: number): void {
    if (!this.active) return;
    const st = this.rays[i];
    // Panel presses stream through routeRay's own pointerDown/pointerUp, so by the time a tap
    // resolves there is nothing left to click here; the world hover is what E is for.
    if (st.uiConsumed) return;
    const hover = st.hover;
    if (!hover?.near) return;
    this.hooks.reachAnim();
    this.hooks.useE(hover.it, this.hooks.noteUnder(hover));
    this.pulse(i, 0.4, 25);
  }

  /** Squeeze: cancel — the card goes back, the topmost window closes, else the VR menu toggles. */
  private onSqueeze(i: number): void {
    if (!this.active) return;
    if (this.hooks.carrying()) {
      this.hooks.putBack();
      this.pulse(i, 0.3, 20);
    } else if (this.hooks.closeTop()) {
      this.pulse(i, 0.3, 20);
    } else if (this.ui) {
      this.ui.toggleMenu();
      this.pulse(i, 0.3, 20);
    }
  }

  private pulse(i: number, strength: number, ms: number): void {
    try {
      const actuator = (this.rays[i]?.source?.gamepad as (Gamepad & { hapticActuators?: { pulse?: (s: number, ms: number) => Promise<unknown> }[] }) | undefined)?.hapticActuators?.[0];
      void actuator?.pulse?.(strength, ms)?.catch(() => {});
    } catch {
      // no haptics on this controller
    }
  }

  /** One VR frame, in place of player.update: input, locomotion, and the rays' visuals. */
  update(dt: number): void {
    if (!this.active) return;
    const { player } = this.hooks;
    this.frame++;
    if (player.seat && (this.glideIntent() || this.rays.some((r) => r.teleportHeld) || this.stickAiming)) player.stand();
    this.dolly.updateMatrixWorld(true);
    this.pollButtons();
    this.updateHover();
    if (this.ui) {
      this.ui.update(dt, this.renderer.xr.getCamera());
      for (let i = 0; i < 2; i++) {
        if (this.rays[i]?.uiConsumed) this.ui.stickScroll(i, this.stick(i).y, dt);
      }
    }
    this.updateHolds();
    this.updateTeleport();
    this.updateTurn(dt);
    this.updateGlide(dt);
    this.followHead();
    this.updateFade(dt);
    // What the flat mirror's hint bar shows: the right ray's target, else the left's.
    const aim = this.rays[1]?.hover ?? this.rays[0]?.hover ?? null;
    this.hooks.onTarget(aim?.near ? aim.it : null, aim?.near ? this.hooks.noteUnder(aim) : null);
  }

  /**
   * Hand-tracked pinches, resolved per frame from the union of the runtime's select events and
   * three's joint-distance pinch events (runtimes that fire both for one pinch still read as
   * one hold): a tap is E, a hold aims a teleport the release fires, and both hands together
   * toggle the menu. Controllers never reach here — their trigger fires E at once, with A for
   * teleports and squeeze for the menu.
   */
  private updateHolds(): void {
    const now = performance.now();
    const hands = [0, 1].filter((i) => {
      const st = this.rays[i];
      return st?.source && !st.source.gamepad;
    });
    for (const i of hands) {
      const st = this.rays[i];
      const held = st.selectHeld || st.pinchHeld;
      if (!held && st.hold.isHeld) {
        const out = st.hold.release();
        if (out === 'teleport') this.fireTeleport(i);
        else if (out === 'select') this.tapE(i);
      } else if (held) {
        st.hold.update(true, now, st.uiConsumed);
      }
    }
    // Both hands pinching together: the menu, claimed before either hold can aim or tap.
    if (hands.length === 2 && this.ui) {
      const [a, b] = [this.rays[hands[0]].hold, this.rays[hands[1]].hold];
      const since = Math.min(a.heldSince, b.heldSince);
      if (since >= 0 && !a.isConsumed && !a.isAiming && !b.isAiming && now - since >= MENU_HOLD_MS) {
        a.consume();
        b.consume();
        this.ui.toggleMenu();
        this.pulse(hands[0], 0.3, 20);
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
    return decodeThumbstick(this.rays[i]?.source?.gamepad?.axes ?? []);
  }

  private gamepad(i: number): Gamepad | undefined {
    return this.rays[i]?.source?.gamepad ?? undefined;
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
    const s = this.stick(0);
    return Math.hypot(s.x, s.y) > STICK_ON;
  }

  /** Edge-triggered buttons: B/Y or stick-click is N; A hold (or stick-forward) aims a teleport. */
  private pollButtons(): void {
    for (let i = 0; i < 2; i++) {
      const st = this.rays[i];
      const gp = this.gamepad(i);
      const n = buttonDown(gp, XR_BUTTON.STICK) || buttonDown(gp, XR_BUTTON.B);
      if (n && !st.wasN) this.hooks.nextWaiting();
      st.wasN = n;
      // Teleport aim lives on A hold; release fires it. A ray on a UI panel cancels the aim
      // without firing (that ray's stick scrolls the panel instead).
      const held = buttonDown(gp, XR_BUTTON.A);
      if (st.uiConsumed) {
        st.teleportHeld = false;
      } else {
        if (st.teleportHeld && !held) this.fireTeleport();
        st.teleportHeld = held;
      }
    }
    // Stick-aimed teleports (glide off): pushing forward aims, release past center fires.
    if (!this.hooks.settings.vr.glide && !this.rays[0]?.uiConsumed) {
      const y = this.stick(0).y;
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
      if (this.ui) {
        const gp = this.gamepad(i);
        const pressed = buttonDown(gp, XR_BUTTON.TRIGGER) || st.selectHeld || st.pinchHeld;
        if (this.ui.routeRay(i, this.raycaster, pressed)) {
          st.uiConsumed = true;
          st.hover = null;
          st.line.visible = true;
          st.dot.visible = false;
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
    let axisX = this.stick(1).x;
    if (axisX === 0 && !settings.vr.glide) axisX = this.stick(0).x;
    let dYaw = 0;
    if (settings.vr.turn === 'snap') dYaw = this.snap.update(axisX);
    else if (Math.abs(axisX) > 0.15) dYaw = -axisX * THREE.MathUtils.degToRad(settings.vr.turnSpeed) * dt;
    if (dYaw === 0) return;
    this.headWorld(_h);
    this.yaw += dYaw;
    this.dolly.rotation.y = this.yaw;
    // …around the head: the feet stay where they were, only the heading changes.
    this.headLocal(_l);
    _l.y = 0;
    _l.applyAxisAngle(UP, this.yaw);
    this.origin.set(_h.x - _l.x, this.origin.y, _h.z - _l.z);
    this.dolly.position.copy(this.origin);
  }

  /** Smooth stick glide (a Settings toggle, default off): the avatar walks the stick direction. */
  private updateGlide(dt: number): void {
    this.glideActive = false;
    if (!this.hooks.settings.vr.glide) return;
    if (this.rays[0]?.uiConsumed) return; // the stick scrolls the panel under the ray instead
    const { player } = this.hooks;
    if (player.seat) return;
    const s = this.stick(0);
    if (Math.hypot(s.x, s.y) < 0.15) return;
    _f.set(0, 0, -1).applyQuaternion(this.headQuat(_q));
    _f.y = 0;
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1);
    _f.normalize();
    _l.set(-_f.z, 0, _f.x);
    const speed = 4.6 * player.speedBoost;
    const dx = (_l.x * s.x - _f.x * s.y) * speed * dt;
    const dz = (_l.z * s.x - _f.z * s.y) * speed * dt;
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
      this.origin.y = player.pos.y;
      this.dolly.position.copy(this.origin);
    } else if (!player.seat) {
      // Room-scale: walk the avatar under the head through the usual collision.
      const dx = _h.x - player.pos.x;
      const dz = _h.z - player.pos.z;
      if (Math.hypot(dx, dz) > 1e-4) {
        roomMoved = true;
        player.stepTo(_h.x, _h.z);
        this.snapGround();
      }
    }
    this.dolly.position.copy(this.origin);
    this.dolly.rotation.y = this.yaw;
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

  private placeAvatar(at: THREE.Vector3): void {
    const { player } = this.hooks;
    player.pos.set(at.x, at.y, at.z);
    player.vy = 0;
    player.grounded = true;
    this.snapGround();
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
        this.fade = 'in';
        this.fadeT = 0;
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
