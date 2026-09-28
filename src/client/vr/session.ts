// The WebXR session: rig, controller/hand input, and locomotion for the headset browser.
// Plain Three.js WebXR (renderer.xr + setAnimationLoop), plus xrblocks' `Hands` joint accessor
// for the pinch fallback (see pinchFallback below). Everything else xrblocks offers for input —
// its Input/Interaction pipeline, gestures, UI — needs the xb engine to own the renderer and the
// loop, which would be a renderer rewrite; the office keeps its own (docs/vr-webxr.md says why).
//
// The rig is the standard three dolly: the desktop camera is reparented under a Group at the
// avatar's feet while presenting, and three composes the headset pose with it
// (WebXRManager.updateCamera). The avatar (player.pos) stays the source of truth: VR locomotion
// moves it through the same collision as walking, the desktop move sender picks it up unchanged,
// and anything desktop-side that moves the player (N, the elevator, ladders) rebases the rig.

import * as THREE from 'three';
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
/** Pinch counts below this thumb-to-index distance (meters), matching three's own 0.02/0.005. */
const PINCH_ON = 0.015;
const PINCH_OFF = 0.025;

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

interface RayState {
  targetRay: THREE.XRTargetRaySpace;
  grip: THREE.XRGripSpace;
  hand: THREE.XRHandSpace;
  source: XRInputSource | null;
  /** A select event arrived this session: the runtime maps the trigger/pinch itself. */
  selectSeen: boolean;
  hover: { it: Interactable; near: boolean; hit: THREE.Intersection } | null;
  /** A world-space UI panel owns this ray this frame (world input yields to it). */
  uiConsumed: boolean;
  pinchHeld: boolean;
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
  /** xrblocks Hands, when the lazy chunk loaded: handedness-indexed joint access for the pinch fallback. */
  private xbHands: { getIndexTip(h: number): THREE.Object3D | undefined; getThumbTip(h: number): THREE.Object3D | undefined } | null = null;
  private xbOrdered: THREE.XRHandSpace[] = [];
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

    for (let i = 0; i < 2; i++) {
      const targetRay = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -5)]);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
      line.frustumCulled = false;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), new THREE.MeshBasicMaterial({ color: 0x7df9ff, depthTest: false, transparent: true }));
      dot.renderOrder = 9998;
      targetRay.add(line, dot);
      const st: RayState = { targetRay, grip, hand, source: null, selectSeen: false, hover: null, uiConsumed: false, pinchHeld: false, teleportHeld: false, wasN: false, line, dot };
      targetRay.addEventListener('connected', (e) => this.onConnected(i, e.data));
      targetRay.addEventListener('disconnected', () => this.onDisconnected(i));
      targetRay.addEventListener('selectstart', () => this.onSelect(i));
      targetRay.addEventListener('squeezestart', () => this.onSqueeze(i));
      hand.addEventListener('selectstart', () => this.onSelect(i));
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
      r.selectSeen = false;
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
    this.hooks.hudRefresh();
    this.hooks.onEnter?.();
    // xrblocks' Hands for the pinch fallback, loaded lazily so a failed chunk never blocks VR.
    void import('xrblocks')
      .then((xb) => {
        this.orderXbHands();
        this.xbHands = new xb.Hands(this.xbOrdered);
      })
      .catch(() => (this.xbHands = null));
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
    for (const r of this.rays) {
      r.source = null;
      r.hover = null;
      r.uiConsumed = false;
      r.teleportHeld = false;
      r.pinchHeld = false;
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

  private onConnected(i: number, source: XRInputSource): void {
    const st = this.rays[i];
    st.source = source;
    st.line.visible = true;
    st.dot.visible = true;
    this.orderXbHands();
  }

  private onDisconnected(i: number): void {
    const st = this.rays[i];
    st.source = null;
    st.hover = null;
    st.line.visible = false;
    st.dot.visible = false;
    this.orderXbHands();
  }

  /** xrblocks Hands indexes [left, right] by handedness; three's slots don't promise that order. */
  private orderXbHands(): void {
    const handed = (i: number) => this.rays[i]?.source?.handedness;
    const left = this.rays.find((_, i) => handed(i) === 'left')?.hand ?? this.rays[0]?.hand;
    const right = this.rays.find((_, i) => handed(i) === 'right')?.hand ?? this.rays[1]?.hand ?? this.rays[0]?.hand;
    this.xbOrdered = [left, right].filter(Boolean) as THREE.XRHandSpace[];
    // Hands holds the array by reference, but a fresh order after (dis)connects is safest.
    if (this.xbHands && 'hands' in this.xbHands) (this.xbHands as unknown as { hands: THREE.XRHandSpace[] }).hands = this.xbOrdered;
  }

  /** Trigger / pinch: E on whatever that ray hovers, through the shared dispatch. */
  private onSelect(i: number): void {
    if (!this.active) return;
    const st = this.rays[i];
    st.selectSeen = true;
    if (st.uiConsumed && this.ui) {
      // A runtime select while a panel owns the ray. Controllers already stream press/release
      // through routeRay every frame, so only hand-tracked sources (no trigger button) need a
      // synthesized click here; for the rest this event would double-fire the panel.
      if (!st.source?.gamepad) {
        const origin = new THREE.Vector3();
        const dir = new THREE.Vector3();
        st.targetRay.getWorldPosition(origin);
        st.targetRay.getWorldDirection(dir);
        this.raycaster.set(origin, dir);
        this.ui.routeRay(i, this.raycaster, true);
        this.ui.routeRay(i, this.raycaster, false);
        this.pulse(i, 0.3, 15);
      }
      return;
    }
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
    this.pinchFallback();
    this.updateTeleport();
    this.updateTurn(dt);
    this.updateGlide(dt);
    this.followHead();
    this.updateFade(dt);
    // What the flat mirror's hint bar shows: the right ray's target, else the left's.
    const aim = this.rays[1]?.hover ?? this.rays[0]?.hover ?? null;
    this.hooks.onTarget(aim?.near ? aim.it : null, aim?.near ? this.hooks.noteUnder(aim) : null);
  }

  /** Head pose in rig space (three's XR camera is the headset, parented under the dolly). */
  private headLocal(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.renderer.xr.getCamera().position);
  }

  /** The head in the world, through the rig. */
  private headWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.headLocal(out)).applyAxisAngle(UP, this.yaw).add(this.origin);
  }

  /** The head's orientation in the world: the rig's yaw composed with the headset's own. */
  private headQuat(out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.renderer.xr.getCamera().quaternion).premultiply(this.dolly.quaternion);
  }

  /** Head look direction in the world, for the ears (the camera's own direction is the rig's). */
  lookDir(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.headQuat(new THREE.Quaternion()));
  }

  /** Which way the head looks, on the XZ plane, in avatar-facing convention. */
  private headFacing(): number {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.headQuat(new THREE.Quaternion()));
    return Math.atan2(fwd.x, fwd.z);
  }

  /** Stick deflection for a ray's gamepad. */
  private stick(i: number): { x: number; y: number } {
    return decodeThumbstick(this.rays[i]?.source?.gamepad?.axes ?? []);
  }

  private gamepad(i: number): Gamepad | undefined {
    return this.rays[i]?.source?.gamepad ?? undefined;
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
    return this.rays.some((r) => r.teleportHeld) || this.stickAiming;
  }

  /** Raycast both rays against the world; park the cursor dots on what they hit. */
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
      const origin = new THREE.Vector3();
      const dir = new THREE.Vector3();
      st.targetRay.getWorldPosition(origin);
      st.targetRay.getWorldDirection(dir);
      this.raycaster.set(origin, dir);
      // Sprites (name tags, chat bubbles) need a camera on the raycaster; setFromCamera does
      // this on desktop, but the VR path builds rays by hand. Without it every frame logs.
      this.raycaster.camera = this.camera;
      // World-space UI panels eat the ray first; the world only sees rays no panel took.
      if (this.ui) {
        const pressed = buttonDown(this.gamepad(i), XR_BUTTON.TRIGGER) || st.pinchHeld;
        if (this.ui.routeRay(i, this.raycaster, pressed)) {
          st.uiConsumed = true;
          st.hover = null;
          st.line.visible = true;
          st.dot.visible = false;
          continue;
        }
      }
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

  /**
   * Pinch without a runtime select event: some headsets track hands but never fire select or
   * pinchstart for them. Thumb-to-index distance through xrblocks' Hands (getIndexTip/getThumbTip
   * per handedness; src/input/Hands.ts), falling back to joint records straight off three's hand
   * spaces when the xrblocks chunk didn't load. Only runs until the first real select event.
   */
  private pinchFallback(): void {
    for (let i = 0; i < 2; i++) {
      const st = this.rays[i];
      if (!st.source?.hand || st.selectSeen || !st.hand.joints) {
        st.pinchHeld = false;
        continue;
      }
      const dist = this.pinchDistance(i);
      if (dist === null) continue;
      if (!st.pinchHeld && dist <= PINCH_ON) {
        st.pinchHeld = true;
        this.onSelect(i);
      } else if (st.pinchHeld && dist >= PINCH_OFF) {
        st.pinchHeld = false;
      }
    }
  }

  private pinchDistance(i: number): number | null {
    // Handedness.LEFT = 0, RIGHT = 1 in xrblocks; orderXbHands keeps the array matching.
    const handedness = this.rays[i]?.source?.handedness === 'left' ? 0 : 1;
    const joints = this.rays[i].hand.joints;
    const index = this.xbHands ? this.xbHands.getIndexTip(handedness) : joints['index-finger-tip'];
    const thumb = this.xbHands ? this.xbHands.getThumbTip(handedness) : joints['thumb-tip'];
    if (!index || !thumb) return null;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    index.getWorldPosition(a);
    thumb.getWorldPosition(b);
    return a.distanceTo(b);
  }

  /** Parabolic teleport: draw the arc and landing marker while aimed; release fires it. */
  private updateTeleport(): void {
    if (!this.teleportAiming()) {
      this.arc.visible = false;
      this.marker.visible = false;
      return;
    }
    const st = this.rays[0]?.source ? this.rays[0] : this.rays[1];
    if (!st?.source) {
      this.arc.visible = false;
      this.marker.visible = false;
      return;
    }
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    st.targetRay.getWorldPosition(origin);
    st.targetRay.getWorldDirection(dir);
    const pts = sampleParabola(origin, dir);
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

  /** Fire the aimed teleport: through the fade when it's on, straight there when it's off. */
  private fireTeleport(): void {
    const st = this.rays[0]?.source ? this.rays[0] : this.rays[1];
    if (!st?.source) return;
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    st.targetRay.getWorldPosition(origin);
    st.targetRay.getWorldDirection(dir);
    const landing = this.findLanding(sampleParabola(origin, dir));
    if (!landing) return;
    this.pulse(0, 0.5, 30);
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
    const head = this.headWorld(new THREE.Vector3());
    this.yaw += dYaw;
    this.dolly.rotation.y = this.yaw;
    // …around the head: the feet stay where they were, only the heading changes.
    const local = this.headLocal(new THREE.Vector3());
    local.y = 0;
    local.applyAxisAngle(UP, this.yaw);
    this.origin.set(head.x - local.x, this.origin.y, head.z - local.z);
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
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.headQuat(new THREE.Quaternion()));
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const speed = 4.6 * player.speedBoost;
    const dx = (right.x * s.x - fwd.x * s.y) * speed * dt;
    const dz = (right.z * s.x - fwd.z * s.y) * speed * dt;
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
    const head = this.headWorld(new THREE.Vector3());
    const external = new THREE.Vector3().subVectors(player.pos, this.lastAvatar);
    external.y = 0;
    let roomMoved = false;
    if (external.length() > 1e-4) {
      // Desktop code moved the player: carry the rig along, head unmoved.
      this.origin.add(external);
      this.origin.y = player.pos.y;
      this.dolly.position.copy(this.origin);
    } else if (!player.seat) {
      // Room-scale: walk the avatar under the head through the usual collision.
      const dx = head.x - player.pos.x;
      const dz = head.z - player.pos.z;
      if (Math.hypot(dx, dz) > 1e-4) {
        roomMoved = true;
        player.stepTo(head.x, head.z);
        this.snapGround();
      }
    }
    this.dolly.position.copy(this.origin);
    this.dolly.rotation.y = this.yaw;
    this.lastAvatar.copy(player.pos);
    player.moving = this.glideActive || roomMoved || external.length() > 1e-4 || this.fade !== 'idle';
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
