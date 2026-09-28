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
import type { ChatLine, FloorInfo, GhIssue, GhPull, GhState, QueueState, WorkerInfo } from '../../shared/protocol';
import type { JukeboxState } from '../../shared/jukebox';
import type { VrSettings } from '../state';
import type { ScreenState } from '../world/laptop';
import { setToastMirror } from '../ui/dom';
import { VrControls } from './controls';
import { VrKeyboard, type KeyboardTarget } from './keyboard';
import { followTarget, type HeadPose } from './math';
import { VrMenu, type VrMenuActions } from './menu';
import { VrPromptPanel, type VrPromptOpts } from './prompt';
import { VrTerminalPanel, type VrTerminalMsg } from './terminal-panel';
import { VrToast } from './toast';

export interface VrUiVoice {
  isMuted: () => boolean;
  inVoice: () => boolean;
  toggleMute: () => void;
}

/** Everything the VR UI needs from the office: stores, clients and DOM-shared actions. No globals. */
export interface VrUiDeps {
  send: (msg: VrTerminalMsg) => void;
  subscribe: (topic: 'screens' | 'workers' | 'issues' | 'pulls' | 'queue' | 'chat' | 'floors' | 'floor' | 'jukebox', fn: () => void) => () => void;
  getScreen: (workerId: string) => ScreenState | undefined;
  getWorker: (workerId: string) => WorkerInfo | undefined;
  getWorkers: () => WorkerInfo[];
  getIssues: () => GhState<GhIssue>;
  getPulls: () => GhState<GhPull>;
  getQueue: () => QueueState;
  getFreeDesks: () => { id: string; label: string }[];
  getChat: () => ChatLine[];
  getFloors: () => FloorInfo[];
  currentFloor: () => string | null;
  getJukebox: () => JukeboxState;
  onRoof: () => boolean;
  barCutOff: () => boolean;
  getVrSettings: () => VrSettings;
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
  /** The terminal, menu, keyboard, prompt, toast and controls panels (for wrist-mounting or custom placement). */
  readonly terminal: VrTerminalPanel;
  readonly menu: VrMenu;
  readonly keyboard: VrKeyboard;
  readonly prompt: VrPromptPanel;
  readonly toast: VrToast;
  readonly controls: VrControls;
  /** All panels' parent. Added to the scene by attachVrUi. */
  readonly group: THREE.Group;
  /** Opens the world-space terminal for a worker (attaches to its PTY). */
  openTerminal: (workerId: string) => void;
  /** Closes the world-space terminal (detaches from its PTY). */
  closeTerminal: () => void;
  /** Shows/hides the core menu. */
  toggleMenu: () => void;
  /** Shows the menu at a view (floors, jukebox, bar, chat…): the VR way into modal flows. */
  showMenu: (view: Parameters<VrMenu['show']>[0]) => void;
  /** Shows the controls card (the menu's ❓ row; also shown on session enter). */
  showControls: () => void;
  /** Asks for a line of text (hire prompt, board-agent question, chat): prompt panel + keyboard. */
  askText: (opts: Omit<VrPromptOpts, 'onCancel'> & { onCancel?: () => void }) => void;
  /** A DOM-toast mirror for the headset (level colors the strip's edge). */
  showToast: (text: string, level?: 'info' | 'warn' | 'error') => void;
  /** The issue card in hand, if any: a sticky hint while one is carried. */
  setCarrying: (card: { issue: number; title: string } | null) => void;
  /** Redirects the keyboard (default target is the focused VR terminal; null mutes it). */
  setKeyboardTarget: (t: KeyboardTarget | null) => void;
  /** What the prompt field holds now (the emulator hook reads this back for assert scripts). */
  promptText: () => string;
  /**
   * Routes one controller's ray to the topmost panel under it. Call every frame per
   * controller with its raycaster and trigger state; returns true when a panel took it.
   */
  routeRay: (rayId: number, raycaster: THREE.Raycaster, pressed: boolean) => boolean;
  /** Where a routed ray lands on a panel (world), for the cursor dot; null when it lands on none. */
  panelHit: (rayId: number) => THREE.Vector3 | null;
  /** Scrolls the list under a ray (thumbstick y, positive down). */
  stickScroll: (rayId: number, axisY: number, dt: number) => void;
  /** Cancels a ray's in-flight press without clicking (disconnect, session end). */
  cancelRay: (rayId: number) => void;
  /** Repaints, cursor blink, menu follow. Pass the head pose for follow mode. */
  update: (dt: number, head?: HeadPose | null) => void;
  dispose: () => void;
}

interface RayState {
  panel: VrTerminalPanel | VrMenu | VrKeyboard | VrPromptPanel | VrControls | null;
  uv: { u: number; v: number } | null;
  pressed: boolean;
}

class VrUi implements VrUiHandle {
  readonly terminal: VrTerminalPanel;
  readonly menu: VrMenu;
  readonly keyboard: VrKeyboard;
  readonly prompt: VrPromptPanel;
  readonly toast: VrToast;
  readonly controls: VrControls;
  readonly group = new THREE.Group();
  private rays = new Map<number, RayState>();
  private keyboardExplicit: KeyboardTarget | null | undefined = undefined;
  /** The last head pose update() saw: newly opened panels land in front of it. */
  private headPos: [number, number, number] | null = null;
  private headDir: [number, number, number] | null = null;
  private tmpV = new THREE.Vector3();
  private tmpHit = new THREE.Vector3();

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
        getChat: deps.getChat,
        getFloors: deps.getFloors,
        currentFloor: deps.currentFloor,
        getJukebox: deps.getJukebox,
        onRoof: deps.onRoof,
        barCutOff: deps.barCutOff,
        getVrSettings: deps.getVrSettings,
        isMuted: deps.voice.isMuted,
        inVoice: deps.voice.inVoice,
      },
      { ...deps.actions, toggleMute: deps.voice.toggleMute },
    );
    this.keyboard = new VrKeyboard();
    this.prompt = new VrPromptPanel();
    this.toast = new VrToast();
    // The keyboard feeds the focused terminal unless redirected (see setKeyboardTarget).
    this.keyboard.setTarget({ sendText: (text) => this.terminal.type(text) });
    // The terminal's own ✕ button also dismisses the keyboard (unless retargeted).
    this.terminal.onClose = () => {
      if (this.keyboardExplicit === undefined) this.keyboard.hide();
    };
    // The terminal's ✉ button: ask the worker something (the P key's function on desktop).
    this.terminal.onAsk = (workerId) => {
      const w = deps.getWorker(workerId);
      this.askText({
        title: `✉ Ask ${w?.name ?? 'the worker'}`,
        placeholder: 'What should it do?',
        submitLabel: 'Send ✨',
        onSubmit: (text) => deps.send({ t: 'worker.prompt', workerId, prompt: text }),
      });
    };
    this.controls = new VrControls();
    this.menu.onShowControls = () => this.controls.show();
    // Head-placed panels draw through the world (a menu sunk in a wall is unreadable and
    // looks broken); the terminal stays depth-tested furniture you can walk away from. Orders
    // match the ray-pick priority in ordered() (the transient toast floats above all of them),
    // under the ray dots (9998) and fade (9999).
    this.prompt.panel.setOnTop(9995);
    this.toast.panel.setOnTop(9996);
    this.controls.panel.setOnTop(9994);
    this.menu.panel.setOnTop(9993);
    this.keyboard.panel.setOnTop(9992);
    this.menu.onChatSay = () => this.askChat();

    // Dash layout, facing the user at spawn: terminal center, keyboard below it, menu left.
    const tOff = layout.terminalOffset ?? [0, 1.5, -1.15];
    const kOff = layout.keyboardOffset ?? [0, 1.02, -0.95];
    this.terminal.panel.group.position.set(tOff[0], tOff[1], tOff[2]);
    this.keyboard.panel.group.position.set(kOff[0], kOff[1], kOff[2]);
    this.keyboard.panel.group.rotation.x = -0.35;
    this.menu.panel.group.position.set(-0.75, 1.35, -0.95);
    this.group.add(this.terminal.panel.group, this.keyboard.panel.group, this.menu.panel.group, this.prompt.panel.group, this.toast.panel.group, this.controls.panel.group);
    this.scene.add(this.group);
    // The menu is a dash that glides after the camera; terminal and keyboard stay put so the
    // user can lean in to read and type. The session owner can wrist-mount the menu instead
    // (see this file's kdoc).
    this.menu.panel.setFollow(true, layout.menuDistance ?? 1.05, 0.18);
    // The controls card opens with the session (nobody reads the docs from in a headset), and
    // the menu follows once it's dismissed — both ride the same dash spot, so never together.
    this.controls.onHide = () => {
      if (!this.menu.visible) this.menu.show();
    };
    // DOM toasts mirror into the headset while the session lives (see ui/dom.ts).
    setToastMirror((text, level) => this.toast.show(text, level));
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
    // for it by pointing at a desk is wherever that desk is. The dash steps aside (task focus).
    this.controls.hide();
    this.menu.hide();
    this.placeBeforeHead(this.terminal.panel.group, 1.15, 0);
    this.placeBeforeHead(this.keyboard.panel.group, 0.95, 0.42);
    this.keyboard.panel.group.rotateX(-0.35); // lookAt above levels it; slope it like a desk keyboard
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

  showMenu: VrUiHandle['showMenu'] = (view) => {
    this.controls.hide();
    this.menu.show(view);
  };

  showControls = () => {
    // A modal: it owns the dash while up (GOT IT hands the dash back to the menu).
    this.menu.hide();
    this.controls.show();
  };

  /** The chat view's ✍️ button: a line for the floor. */
  private askChat() {
    this.askText({
      title: '💬 Say it on this floor',
      placeholder: 'Hi everyone…',
      submitLabel: 'Send',
      onSubmit: (text) => this.deps.actions.sendChat(text),
    });
  }

  askText: VrUiHandle['askText'] = (opts) => {
    // The prompt lands where the user looks, the keyboard below it; the dash steps aside so the
    // prompt owns the rays (the terminal stays — the question is usually about what's on it).
    this.controls.hide();
    this.menu.hide();
    this.placeBeforeHead(this.prompt.panel.group, 1.0, 0.02);
    this.prompt.panel.group.rotateX(-0.08);
    this.placeBeforeHead(this.keyboard.panel.group, 0.82, 0.46);
    this.keyboard.panel.group.rotateX(-0.35);
    const target = { sendText: (text: string) => this.prompt.sendText(text) };
    this.keyboardExplicit = target;
    this.keyboard.setTarget(target);
    this.keyboard.show();
    this.prompt.open({
      ...opts,
      onSubmit: (text) => {
        this.endAskText();
        opts.onSubmit(text);
      },
      onCancel: () => {
        this.endAskText();
        opts.onCancel?.();
      },
    });
  };

  /** The prompt is done: the keyboard goes back to the terminal (or away, when none is up). */
  private endAskText() {
    this.keyboard.setTarget({ sendText: (text) => this.terminal.type(text) });
    this.keyboardExplicit = undefined;
    if (!this.terminal.visible) this.keyboard.hide();
  }

  showToast = (text: string, level: 'info' | 'warn' | 'error' = 'info') => {
    this.toast.show(text, level);
  };

  setCarrying = (card: { issue: number; title: string } | null) => {
    this.toast.setSticky(card ? `✋ Carrying #${card.issue} — E at a desk, a worker or the queue · squeeze puts it back` : null);
  };
  promptText = () => this.prompt.text;

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

  /** Panels front to back for ray routing (the prompt owns the rays while it's up). */
  private ordered(): { ui: VrTerminalPanel | VrMenu | VrKeyboard | VrPromptPanel | VrControls; scrollId: string }[] {
    return [
      { ui: this.prompt, scrollId: '' },
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
      st.panel.panel.pointerMove(rayId, uv);
      if (!pressed) {
        st.panel.panel.pointerUp(rayId, uv);
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
      if (st.panel && st.panel !== ui) st.panel.panel.pointerMove(rayId, null);
      st.panel = ui;
      st.uv = uv;
      ui.panel.pointerMove(rayId, uv);
      if (pressed && !st.pressed) {
        st.pressed = true;
        ui.panel.pointerDown(rayId, uv);
      }
      return true;
    }
    if (st.panel) {
      st.panel.panel.pointerMove(rayId, null);
      st.panel = null;
      st.uv = null;
    }
    st.pressed = pressed;
    return false;
  };

  panelHit = (rayId: number): THREE.Vector3 | null => {
    const st = this.rays.get(rayId);
    if (!st?.panel || !st.uv) return null;
    const { panel } = st.panel;
    if (!panel.visible) return null;
    // UV (bottom-left origin) to panel-local meters, then out to the world.
    this.tmpHit.set((st.uv.u - 0.5) * panel.width, (st.uv.v - 0.5) * panel.height, 0);
    return panel.mesh.localToWorld(this.tmpHit);
  };

  stickScroll = (rayId: number, axisY: number, dt: number) => {
    const st = this.rays.get(rayId);
    if (!st?.panel) return;
    const entry = this.ordered().find((e) => e.ui === st.panel);
    if (!entry || !entry.scrollId) return;
    st.panel.panel.scrollStick(entry.scrollId, axisY, dt, 12);
  };

  /** A ray's press ends without clicking (its controller disconnected mid-press). */
  cancelRay = (rayId: number): void => {
    const st = this.rays.get(rayId);
    if (st?.panel) st.panel.panel.pointerCancel(rayId);
    if (st) {
      st.panel = null;
      st.uv = null;
      st.pressed = false;
    }
  };

  update = (dt: number, head?: HeadPose | null) => {
    if (head) {
      this.headPos = head.pos;
      this.headDir = head.dir;
    }
    this.menu.update(dt, head);
    this.terminal.update(dt, head);
    this.keyboard.update(dt, head);
    this.prompt.update(dt, head);
    this.toast.update(dt, head);
    this.controls.update(dt, head);
  };

  dispose = () => {
    setToastMirror(null);
    this.terminal.dispose();
    this.menu.dispose();
    this.keyboard.dispose();
    this.prompt.dispose();
    this.toast.dispose();
    this.controls.dispose();
    this.scene.remove(this.group);
  };
}

/** Builds the world-space VR UI (menu, terminal, keyboard, controls card) and adds it to the scene. */
export function attachVrUi(scene: THREE.Scene, deps: VrUiDeps): VrUiHandle {
  return new VrUi(scene, deps);
}
