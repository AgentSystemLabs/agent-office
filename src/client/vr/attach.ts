/**
 * The VR UI's single integration point for the XR session owner (vr-webxr-core).
 *
 * The session owner adds exactly this (wiring lives in main.ts, which this package never
 * touches — every dependency arrives through VrUiDeps, there are no globals):
 *
 * ```ts
 * import { attachVrUi } from './vr/attach';
 * import { DESKS } from '../shared/layout';
 *
 * // After the renderer, scene, net, store and voice exist (next to the other UI setup):
 * const vrUi = attachVrUi(scene, {
 *   send: (msg) => net.send(msg),
 *   subscribe: (topic, fn) => store.on(topic, fn),
 *   getScreen: (id) => store.screens.get(id),
 *   getWorker: (id) => store.workers.get(id),
 *   getWorkers: () => [...store.workers.values()],
 *   getIssues: () => store.issues,
 *   getPulls: () => store.pulls,
 *   getQueue: () => store.queue,
 *   getFreeDesks: () => DESKS.filter((d) => !d.station && !store.workerAtDesk(d.id))
 *     .map((d) => ({ id: d.id, label: d.label })),
 *   voice: { isMuted: () => voice.muted, inVoice: () => voice.inVoice, toggleMute: () => voice.toggleMute() },
 *   actions: {
 *     hire: (deskId) => hireAtDesk(deskId),          // the DOM hire dialog's function
 *     nextWaiting: () => goToNextWaiting(),          // the DOM N key's function
 *     handToWorker: (n, title) => sendToWorker(`🤖 #${n} ${title}`, { initial: issuePrompt({ number: n, title }) }),
 *     queueIssue: (n, title) => net.send({ t: 'queue.add', prompt: issuePrompt({ number: n, title }), title, issue: n }),
 *     exitVr: () => void xrSession.end(),            // the XR session owner's exit
 *   },
 * });
 *
 * // In the render loop (dt seconds, xrCamera the active camera):
 * vrUi.update(dt, xrCamera);
 *
 * // Per controller, per frame (pressed = trigger held):
 * vrUi.routeRay(handedness === 'left' ? 0 : 1, raycaster, pressed);
 * // Thumbsticks scroll whatever list the ray hovers (pass each stick's y):
 * vrUi.stickScroll(0, leftStickY, dt);
 *
 * // On session end:
 * vrUi.dispose();
 * ```
 *
 * Notes for the session owner:
 * - Nothing here touches the XR session, the rig, or locomotion: panels are plain scene
 *   children under handle.group. vrUi.update(dt) without a camera still repaints and blinks.
 * - The menu follows the camera by default (dash behavior); to wear it on a wrist instead,
 *   `controllerGrip.add(vrUi.menu.panel.group)` and call `vrUi.menu.panel.setFollow(false)`.
 * - The keyboard feeds the focused VR terminal by default; setKeyboardTarget redirects it to
 *   any other text field (null mutes it).
 * - Desktop behavior is untouched: none of this runs unless the session owner calls attachVrUi.
 */

import * as THREE from 'three';
import type { GhIssue, GhPull, GhState, QueueState, WorkerInfo } from '../../shared/protocol';
import type { ScreenState } from '../world/laptop';
import { VrControls } from './controls';
import { VrKeyboard, type KeyboardTarget } from './keyboard';
import { followTarget } from './math';
import { VrMenu, type VrMenuActions } from './menu';
import { VrTerminalPanel, type VrTerminalMsg } from './terminal-panel';

export interface VrUiVoice {
  isMuted: () => boolean;
  inVoice: () => boolean;
  toggleMute: () => void;
}

/** Everything the VR UI needs from the office: stores, clients and DOM-shared actions. No globals. */
export interface VrUiDeps {
  send: (msg: VrTerminalMsg) => void;
  subscribe: (topic: 'screens' | 'workers' | 'issues' | 'pulls' | 'queue', fn: () => void) => () => void;
  getScreen: (workerId: string) => ScreenState | undefined;
  getWorker: (workerId: string) => WorkerInfo | undefined;
  getWorkers: () => WorkerInfo[];
  getIssues: () => GhState<GhIssue>;
  getPulls: () => GhState<GhPull>;
  getQueue: () => QueueState;
  getFreeDesks: () => { id: string; label: string }[];
  voice: VrUiVoice;
  actions: Omit<VrMenuActions, 'toggleMute'>;
  /** Panel layout in meters; the defaults suit a seated user. */
  layout?: {
    menuDistance?: number;
    terminalOffset?: [number, number, number];
    keyboardOffset?: [number, number, number];
  };
}

export interface VrUiHandle {
  /** The terminal, menu, keyboard and controls panels (for wrist-mounting or custom placement). */
  readonly terminal: VrTerminalPanel;
  readonly menu: VrMenu;
  readonly keyboard: VrKeyboard;
  readonly controls: VrControls;
  /** All four panels' parent. Added to the scene by attachVrUi. */
  readonly group: THREE.Group;
  /** Opens the world-space terminal for a worker (attaches to its PTY). */
  openTerminal: (workerId: string) => void;
  /** Closes the world-space terminal (detaches from its PTY). */
  closeTerminal: () => void;
  /** Shows/hides the core menu. */
  toggleMenu: () => void;
  /** Shows the controls card (the menu's ❓ row; also shown on session enter). */
  showControls: () => void;
  /** Redirects the keyboard (default target is the focused VR terminal; null mutes it). */
  setKeyboardTarget: (t: KeyboardTarget | null) => void;
  /**
   * Routes one controller's ray to the topmost panel under it. Call every frame per
   * controller with its raycaster and trigger state; returns true when a panel took it.
   */
  routeRay: (rayId: number, raycaster: THREE.Raycaster, pressed: boolean) => boolean;
  /** Scrolls the list under a ray (thumbstick y, positive down). */
  stickScroll: (rayId: number, axisY: number, dt: number) => void;
  /** Repaints, cursor blink, menu follow. Pass the active camera for follow mode. */
  update: (dt: number, camera?: THREE.Camera | null) => void;
  dispose: () => void;
}

interface RayState {
  panel: VrTerminalPanel | VrMenu | VrKeyboard | VrControls | null;
  uv: { u: number; v: number } | null;
  pressed: boolean;
}

class VrUi implements VrUiHandle {
  readonly terminal: VrTerminalPanel;
  readonly menu: VrMenu;
  readonly keyboard: VrKeyboard;
  readonly controls: VrControls;
  readonly group = new THREE.Group();
  private rays = new Map<number, RayState>();
  private keyboardExplicit: KeyboardTarget | null | undefined = undefined;
  /** The last head pose update() saw: newly opened panels land in front of it. */
  private headPos: [number, number, number] | null = null;
  private headDir: [number, number, number] | null = null;
  private tmpV = new THREE.Vector3();
  private tmpD = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private deps: VrUiDeps) {
    const layout = deps.layout ?? {};
    this.terminal = new VrTerminalPanel(
      { send: deps.send, subscribe: deps.subscribe, getScreen: deps.getScreen, getWorker: deps.getWorker },
    );
    this.menu = new VrMenu(
      {
        subscribe: deps.subscribe,
        getWorkers: deps.getWorkers,
        getIssues: deps.getIssues,
        getPulls: deps.getPulls,
        getQueue: deps.getQueue,
        getFreeDesks: deps.getFreeDesks,
        isMuted: deps.voice.isMuted,
        inVoice: deps.voice.inVoice,
      },
      { ...deps.actions, toggleMute: deps.voice.toggleMute },
    );
    this.keyboard = new VrKeyboard();
    // The keyboard feeds the focused terminal unless redirected (see setKeyboardTarget).
    this.keyboard.setTarget({ sendText: (text) => this.terminal.type(text) });
    // The terminal's own ✕ button also dismisses the keyboard (unless retargeted).
    this.terminal.onClose = () => {
      if (this.keyboardExplicit === undefined) this.keyboard.hide();
    };
    this.controls = new VrControls();
    this.menu.onShowControls = () => this.controls.show();

    // Dash layout, facing the user at spawn: terminal center, keyboard below it, menu left.
    const tOff = layout.terminalOffset ?? [0, 1.5, -1.15];
    const kOff = layout.keyboardOffset ?? [0, 1.02, -0.95];
    this.terminal.panel.group.position.set(tOff[0], tOff[1], tOff[2]);
    this.keyboard.panel.group.position.set(kOff[0], kOff[1], kOff[2]);
    this.keyboard.panel.group.rotation.x = -0.35;
    this.menu.panel.group.position.set(-0.75, 1.35, -0.95);
    this.group.add(this.terminal.panel.group, this.keyboard.panel.group, this.menu.panel.group, this.controls.panel.group);
    this.scene.add(this.group);
    // The menu is a dash that glides after the camera; terminal and keyboard stay put so the
    // user can lean in to read and type. The session owner can wrist-mount the menu instead
    // (see this file's kdoc).
    this.menu.panel.setFollow(true, layout.menuDistance ?? 1.05, 0.18);
    this.menu.show();
    // The controls card opens with the session: nobody reads the docs from in a headset.
    this.controls.show();
  }

  /** In front of the head, at the menu's dash distance: where on-demand panels open. */
  private placeBeforeHead(group: THREE.Group, distance: number, drop: number) {
    if (!this.headPos || !this.headDir) return;
    const [x, y, z] = followTarget(this.headPos, this.headDir, distance, drop);
    group.position.set(x, y, z);
    group.lookAt(this.tmpV.set(...this.headPos));
  }

  openTerminal = (workerId: string) => {
    // The terminal opens where the user looks, not at the spawn default: the user who asked
    // for it by pointing at a desk is wherever that desk is.
    this.placeBeforeHead(this.terminal.panel.group, 1.15, 0);
    this.placeBeforeHead(this.keyboard.panel.group, 0.95, 0.42);
    this.terminal.open(workerId);
    this.keyboard.show();
  };

  closeTerminal = () => {
    this.terminal.close();
    // The keyboard stays only while something else wants it.
    if (this.keyboardExplicit === undefined) this.keyboard.hide();
  };

  toggleMenu = () => {
    this.menu.toggle();
  };

  showControls = () => {
    this.controls.show();
  };

  setKeyboardTarget = (t: KeyboardTarget | null) => {
    this.keyboardExplicit = t;
    if (t) {
      this.keyboard.setTarget(t);
      this.keyboard.show();
    } else {
      this.keyboard.setTarget({ sendText: (text) => this.terminal.type(text) });
      this.keyboardExplicit = undefined;
      if (!this.terminal.visible) this.keyboard.hide();
    }
  };

  /** Panels front to back for ray routing (controls card nearest, then menu, keyboard lowest). */
  private ordered(): { ui: VrTerminalPanel | VrMenu | VrKeyboard | VrControls; scrollId: string }[] {
    return [
      { ui: this.controls, scrollId: '' },
      { ui: this.menu, scrollId: 'list' },
      { ui: this.keyboard, scrollId: '' },
      { ui: this.terminal, scrollId: 'term' },
    ];
  }

  routeRay = (rayId: number, raycaster: THREE.Raycaster, pressed: boolean): boolean => {
    let st = this.rays.get(rayId);
    if (!st) this.rays.set(rayId, (st = { panel: null, uv: null, pressed: false }));
    // A press in progress stays with its panel until release (dragging off still scrolls).
    if (st.pressed && st.panel) {
      const uv = st.panel.panel.raycast(raycaster);
      st.panel.panel.pointerMove(uv);
      if (!pressed) {
        st.panel.panel.pointerUp(uv);
        st.pressed = false;
        st.panel = null;
      }
      st.uv = uv;
      return true;
    }
    // Otherwise the topmost panel under the ray takes the hover (and a fresh press).
    for (const { ui } of this.ordered()) {
      if (!ui.panel.visible) continue;
      const uv = ui.panel.raycast(raycaster);
      if (!uv) continue;
      if (st.panel && st.panel !== ui) st.panel.panel.pointerMove(null);
      st.panel = ui;
      st.uv = uv;
      ui.panel.pointerMove(uv);
      if (pressed && !st.pressed) {
        st.pressed = true;
        ui.panel.pointerDown(uv);
      }
      return true;
    }
    if (st.panel) {
      st.panel.panel.pointerMove(null);
      st.panel = null;
      st.uv = null;
    }
    st.pressed = pressed;
    return false;
  };

  stickScroll = (rayId: number, axisY: number, dt: number) => {
    const st = this.rays.get(rayId);
    if (!st?.panel) return;
    const entry = this.ordered().find((e) => e.ui === st.panel);
    if (!entry || !entry.scrollId) return;
    st.panel.panel.scrollStick(entry.scrollId, axisY, dt, 12);
  };

  update = (dt: number, camera?: THREE.Camera | null) => {
    if (camera) {
      camera.getWorldPosition(this.tmpV);
      camera.getWorldDirection(this.tmpD);
      this.headPos = [this.tmpV.x, this.tmpV.y, this.tmpV.z];
      this.headDir = [this.tmpD.x, this.tmpD.y, this.tmpD.z];
    }
    this.menu.update(dt, camera);
    this.terminal.update(dt, camera);
    this.keyboard.update(dt, camera);
    this.controls.update(dt, camera);
  };

  dispose = () => {
    this.terminal.dispose();
    this.menu.dispose();
    this.keyboard.dispose();
    this.controls.dispose();
    this.scene.remove(this.group);
  };
}

/** Builds the world-space VR UI (menu, terminal, keyboard, controls card) and adds it to the scene. */
export function attachVrUi(scene: THREE.Scene, deps: VrUiDeps): VrUiHandle {
  return new VrUi(scene, deps);
}
