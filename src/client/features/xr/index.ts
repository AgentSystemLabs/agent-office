/**
 * Immersive WebXR (Quest / headset): Enter VR / AR, a locomotion rig, controller rays, a left-hand
 * action card, mirrored HTML windows, a virtual keyboard, push-to-talk dictation, and worker
 * terminals on a floating panel — so the office stays usable without a physical keyboard.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { openBoard } from '../../ui/boards';
import { topModal, toast } from '../../ui/dom';
import { openHelp } from '../../ui/hud';
import { togglePalette } from '../../ui/palette';
import { closeTerminal, divertTerminals, openTerminalFor } from '../../ui/terminal';
import { fireKey, makeXrControls, type XrHooks } from './controller';
import { makeXrDictation, resolveSink } from './dictation';
import { isTypable, XrKeyboard } from './keyboard';
import { TermPanel } from './panel';
import { PaletteCard, type CardAction } from './palette-card';
import { Passthrough, Tabletop } from './passthrough';
import { placeInFront } from './place';
import { XrRays, type Hand } from './rays';
import { pickSurfaces, type XrSurface } from './surface';
import { WindowSurface } from './windows';
import './ui.css';

const XR_SHADOW = 1024;
const XR_OPTIONAL = ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] as const;
export type XrKind = 'vr' | 'ar';
const MODE: Record<XrKind, XRSessionMode> = { vr: 'immersive-vr', ar: 'immersive-ar' };
const HANDS: Hand[] = ['left', 'right'];

export type XrParts = Pick<Parts, 'stage' | 'settings' | 'player' | 'hud' | 'waiting' | 'actions' | 'palette' | 'emotes'>;

export interface XrApi {
  active(): boolean;
  kind(): XrKind | null;
  preferPlain(): boolean;
  end(): void;
  toggle(): void;
  toggleAr(): void;
  supported(): boolean;
  supportedAr(): boolean;
  aimRay(): THREE.Ray | null;
  /** Whether the aiming controller points at a VR surface (window, keyboard, card, terminal). */
  onPanel(): boolean;
  landed(point: THREE.Vector3 | null, near: boolean): void;
  /** What the right grip does when it isn't toggling tabletop: take the aimed issue note. */
  setTakeNote(fn: (() => void) | null): void;
}

export function installXR(ctx: Ctx, parts: XrParts): XrApi {
  const { renderer, camera, scene } = ctx;
  const { sun } = parts.stage;
  const player = ctx.player;

  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  try {
    renderer.xr.setFoveation(1);
  } catch {
    // older three / browsers
  }

  const rig = new THREE.Group();
  rig.name = 'xr-rig';
  const lookDir = new THREE.Vector3();
  const controls = makeXrControls(player);
  const rays = new XrRays(renderer, rig);
  const panel = new TermPanel();
  const windows = new WindowSurface();
  const keyboard = new XrKeyboard();
  const card = new PaletteCard();
  const passthrough = new Passthrough(renderer);
  const tabletop = new Tabletop();
  const raycaster = new THREE.Raycaster();
  const surfaces: XrSurface[] = [card, keyboard, windows, panel];

  let session: XRSession | null = null;
  let kindNow: XrKind | null = null;
  let table = false;
  const canEnter: Record<XrKind, boolean> = { vr: false, ar: false };
  let savedParent: THREE.Object3D | null = null;
  let savedView = player.view;
  let savedShadow = sun.shadow.mapSize.x;
  let frameMs = 1000 / 90;
  let plain = false;
  let onSurface: ReturnType<typeof pickSurfaces> = { left: null, right: null };
  let aimed: { distance: number; near: boolean } | null = null;
  const pinchKept = new Set<Hand>();
  /** Right grip takes a note when the pointer has set this. */
  let takeNoteFn: (() => void) | null = null;

  const bar = document.createElement('div');
  bar.className = 'xr-buttons';
  const btn = xrButton('xr-enter');
  const arBtn = xrButton('xr-enter-ar');
  arBtn.hidden = true;
  bar.append(arBtn, btn);
  document.body.appendChild(bar);

  const active = () => session !== null && renderer.xr.isPresenting;
  const preferPlain = () => !parts.settings.xrOutline || plain;

  const dictation = makeXrDictation({
    sink: () =>
      resolveSink({
        keyboard: keyboard.currentTarget(),
        termSend: panel.workerId ? (data) => ctx.net.send({ t: 'term.input', workerId: panel.workerId!, data }) : null,
        modalEl: topModal()?.el ?? null,
      }),
    setCaption: (t) => keyboard.setCaption(t),
  });

  function paintBtn() {
    arBtn.hidden = session ? kindNow !== 'ar' : !canEnter.ar;
    arBtn.classList.toggle('on', kindNow === 'ar');
    arBtn.textContent = kindNow === 'ar' ? 'Exit AR' : '🪟 Enter AR';
    arBtn.title = kindNow === 'ar' ? 'Leave passthrough' : 'Passthrough: the office in your room, life-size or on the table (right grip switches)';
    btn.hidden = kindNow === 'ar';
    if (session) {
      btn.textContent = 'Exit VR';
      btn.classList.add('on');
      btn.disabled = false;
      btn.title = 'Leave immersive VR';
      return;
    }
    btn.classList.remove('on');
    if (!window.isSecureContext) {
      btn.textContent = 'VR needs HTTPS';
      btn.disabled = true;
      btn.title = 'WebXR needs a secure context. Open https://… on the Quest (accept the certificate), or use adb reverse to http://localhost:4600';
      return;
    }
    if (!navigator.xr) {
      btn.textContent = 'VR not in this browser';
      btn.disabled = true;
      btn.title = 'Open this page in the Meta Quest Browser while wearing the headset';
      return;
    }
    if (!canEnter.vr) {
      btn.textContent = 'Checking VR…';
      btn.disabled = true;
      btn.title = 'Asking the browser whether immersive VR is available';
      return;
    }
    btn.textContent = '🥽 Enter VR';
    btn.disabled = false;
    btn.title = 'Put on the headset and walk the office in VR';
  }

  function syncLookFromHeadset() {
    camera.getWorldDirection(lookDir);
    player.camYaw = Math.atan2(-lookDir.x, -lookDir.z);
    player.lookPitch = Math.asin(THREE.MathUtils.clamp(lookDir.y, -1, 1));
    if (!table) player.facing = Math.atan2(Math.sin(player.camYaw + Math.PI), Math.cos(player.camYaw + Math.PI));
  }

  function setTable(on: boolean) {
    table = on;
    player.view = on ? 'third' : 'first';
    if (on) tabletop.place(rig, camera, player.pos);
    else rig.scale.setScalar(1);
    if (panel.workerId) placePanel();
    if (windows.active()) placeWindow();
    if (keyboard.open) placeKeyboard();
  }

  function placePanel() {
    placeInFront(panel.mesh, rig, camera, scene, { distance: 1.1, y: -0.05 });
  }
  function placeWindow() {
    placeInFront(windows.mesh, rig, camera, scene, { distance: 1.2, y: 0.05 });
  }
  function placeKeyboard() {
    placeInFront(keyboard.mesh, rig, camera, scene, { distance: 0.85, y: -0.35, pitch: -0.35 });
  }

  function openPanel(workerId: string) {
    if (panel.workerId !== workerId) {
      if (panel.workerId) ctx.net.send({ t: 'worker.detach', workerId: panel.workerId });
      ctx.net.send({ t: 'worker.attach', workerId });
    }
    panel.open(workerId);
    placePanel();
  }

  function closePanel() {
    if (!panel.workerId) return;
    ctx.net.send({ t: 'worker.detach', workerId: panel.workerId });
    panel.close();
    if (keyboard.currentTarget()?.kind === 'term') keyboard.hide();
  }

  panel.onAction = (act) => {
    const id = panel.workerId;
    if (!id) return;
    if ('input' in act) ctx.net.send({ t: 'term.input', workerId: id, data: act.input });
    else if ('close' in act) closePanel();
    else {
      keyboard.show({ kind: 'term', send: (data) => ctx.net.send({ t: 'term.input', workerId: id, data }) });
      placeKeyboard();
    }
  };

  divertTerminals((workerId) => {
    if (!active()) return false;
    openPanel(workerId);
    return true;
  });
  ctx.messages.on('welcome', () => {
    if (panel.workerId && store.workers.has(panel.workerId)) ctx.net.send({ t: 'worker.attach', workerId: panel.workerId });
  });
  store.on('workers', () => {
    if (panel.workerId && !store.workers.has(panel.workerId)) closePanel();
  });

  windows.install({
    isXr: active,
    place: () => placeWindow(),
    leaveFor(why) {
      end();
      toast(why, 'warn');
    },
  });

  keyboard.onMic = () => dictation.toggle();

  function runCard(id: CardAction) {
    switch (id) {
      case 'find':
        togglePalette(() => parts.palette.paletteEntries());
        break;
      case 'menu':
        fireKey('Tab', true);
        fireKey('Tab', false);
        break;
      case 'next':
        fireKey('KeyN', true);
        fireKey('KeyN', false);
        break;
      case 'queue':
        parts.waiting.showQueue();
        break;
      case 'issues':
        openBoard('issues', ctx.net, parts.actions.boardActions());
        break;
      case 'pulls':
        openBoard('pulls', ctx.net, parts.actions.boardActions());
        break;
      case 'hire': {
        const hire = parts.palette.paletteEntries().find((e) => e.title === 'Hire a worker');
        hire?.open();
        break;
      }
      case 'chat':
        fireKey('KeyT', true);
        fireKey('KeyT', false);
        break;
      case 'emotes':
        fireKey('KeyG', true);
        break;
      case 'mute':
        fireKey('KeyM', true);
        fireKey('KeyM', false);
        break;
      case 'talk':
        fireKey('KeyV', true);
        fireKey('KeyV', false);
        break;
      case 'keyboard':
        if (keyboard.open) keyboard.hide();
        else {
          const el = document.activeElement;
          if (isTypable(el)) keyboard.show({ kind: 'field', el });
          else if (panel.workerId) keyboard.show({ kind: 'term', send: (data) => ctx.net.send({ t: 'term.input', workerId: panel.workerId!, data }) });
          else {
            const field = topModal()?.el.querySelector('input:not([type=button]):not([type=submit]):not([disabled]), textarea:not([disabled])') ?? null;
            if (isTypable(field)) keyboard.show({ kind: 'field', el: field });
            else toast('Click a text field first, or open a terminal', 'warn');
          }
          if (keyboard.open) placeKeyboard();
        }
        break;
      case 'dictate':
        dictation.toggle();
        break;
      case 'settings':
        parts.hud.showSettings();
        break;
      case 'help':
        openHelp();
        break;
      case 'recenter':
        if (windows.active()) placeWindow();
        if (panel.workerId) placePanel();
        if (keyboard.open) placeKeyboard();
        break;
      case 'exit':
        end();
        break;
    }
  }
  card.onAction = runCard;

  document.addEventListener(
    'focusin',
    (e) => {
      if (!active() || !isTypable(e.target)) return;
      keyboard.show({ kind: 'field', el: e.target });
      placeKeyboard();
    },
    true,
  );

  const leftGrip = renderer.xr.getControllerGrip(0);
  const rightGrip = renderer.xr.getControllerGrip(1);
  // Controllers may connect as either index; reparent the card when handedness is known.
  for (const grip of [leftGrip, rightGrip]) {
    grip.addEventListener('connected', (e) => {
      if ((e as { data?: XRInputSource }).data?.handedness === 'left') {
        grip.add(card.mesh);
        card.mesh.position.set(0.05, 0.05, 0.08);
        card.mesh.rotation.set(-0.9, 0.4, 0.2);
      }
    });
  }
  rig.add(leftGrip, rightGrip);

  const hooks: XrHooks = {
    snapYaw(dyaw) {
      rig.rotation.y += dyaw;
    },
    zoom(amount, dt) {
      const hit = onSurface.right ?? onSurface.left;
      if (hit?.surface.scroll) {
        hit.surface.scroll(hit.hit, -amount);
        return;
      }
      if (table) tabletop.zoom(rig, amount, dt);
    },
    press(hand, code, down) {
      if (code === 'XrDictate') {
        if (down) dictation.press();
        else dictation.release();
        return true;
      }
      if (code === 'XrGrip') {
        if (down) {
          if (takeNoteFn) takeNoteFn();
          else if (kindNow === 'ar') {
            setTable(!table);
            toast(table ? 'On the table: left stick walks you, right stick turns and zooms it' : 'Life-size');
          }
        }
        return true;
      }
      if (code === 'KeyE') {
        if (down) rays.active = hand;
        const hit = onSurface[hand];
        if (!hit) return false;
        return hit.surface.press?.(hand, hit.hit, down) ?? true;
      }
      if (code === 'Escape') {
        if (down) {
          if (keyboard.open) {
            keyboard.hide();
            return true;
          }
          if (panel.workerId && !topModal()) {
            closePanel();
            return true;
          }
        }
        return false;
      }
      return false;
    },
  };
  rays.onPinch = (hand, down) => {
    if (down ? hooks.press(hand, 'KeyE', true) : pinchKept.delete(hand)) {
      if (down) pinchKept.add(hand);
      return;
    }
    fireKey('KeyE', down);
  };

  function onSessionEnd() {
    if (!session) return;
    session = null;
    kindNow = null;
    controls.reset();
    closePanel();
    keyboard.hide();
    windows.close();
    card.hide();
    passthrough.leave();
    table = false;
    rig.scale.setScalar(1);
    player.xrCamera = false;
    player.view = savedView;
    sun.shadow.mapSize.set(savedShadow, savedShadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    if (savedParent) savedParent.add(camera);
    else scene.add(camera);
    savedParent = null;
    if (rig.parent) rig.parent.remove(rig);
    document.body.classList.remove('xr-active');
    plain = false;
    paintBtn();
  }

  async function startSession(kind: XrKind) {
    if (!navigator.xr || session) return;
    if (!window.isSecureContext) {
      toast('WebXR needs HTTPS — open the https:// link on the Quest, or adb reverse to localhost', 'warn');
      return;
    }
    try {
      const s = await navigator.xr.requestSession(MODE[kind], { optionalFeatures: [...XR_OPTIONAL] });
      s.addEventListener('end', onSessionEnd);
      await renderer.xr.setSession(s);
      session = s;
      kindNow = kind;
      savedView = player.view;
      player.view = 'first';
      player.xrCamera = true;
      savedShadow = sun.shadow.mapSize.x;
      sun.shadow.mapSize.set(XR_SHADOW, XR_SHADOW);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      savedParent = camera.parent;
      scene.add(rig);
      rig.scale.setScalar(1);
      rig.position.set(player.pos.x, player.pos.y + player.stepOffset, player.pos.z);
      rig.rotation.set(0, player.camYaw, 0);
      camera.rotation.set(0, 0, 0);
      camera.position.set(0, 0, 0);
      rig.add(camera);
      document.body.classList.add('xr-active');
      frameMs = 1000 / 90;
      plain = !parts.settings.xrOutline;
      card.show();
      if (!card.mesh.parent) {
        leftGrip.add(card.mesh);
        card.mesh.position.set(0.05, 0.05, 0.08);
        card.mesh.rotation.set(-0.9, 0.4, 0.2);
      }
      const open = openTerminalFor();
      if (open) {
        closeTerminal();
        openPanel(open);
      }
      if (kind === 'ar') {
        passthrough.enter();
        setTimeout(() => active() && kindNow === 'ar' && setTable(true), 100);
      }
      paintBtn();
      toast(
        kind === 'ar'
          ? 'Passthrough on — right grip switches table / life-size; left-hand card has the usual actions'
          : 'VR on — left stick walk, trigger clicks, hold A to dictate, left-hand card for Find / Menu / …',
      );
    } catch (err) {
      console.warn('WebXR session failed', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Could not enter ${kind === 'ar' ? 'AR' : 'VR'}: ${msg}`, 'warn');
      const b = kind === 'ar' ? arBtn : btn;
      b.textContent = `${kind === 'ar' ? 'AR' : 'VR'} failed — tap to retry`;
      b.disabled = false;
    }
  }

  function end() {
    session?.end().catch(() => {});
  }
  function toggle() {
    if (session) end();
    else void startSession('vr');
  }
  function toggleAr() {
    if (session) end();
    else void startSession('ar');
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });
  arBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleAr();
  });
  paintBtn();

  if (navigator.xr?.isSessionSupported) {
    void navigator.xr
      .isSessionSupported('immersive-vr')
      .then((ok) => {
        canEnter.vr = ok;
        if (!ok && window.isSecureContext) {
          btn.textContent = 'VR headset not found';
          btn.disabled = true;
          btn.title = 'Open this page in the Meta Quest Browser (not a desktop tab)';
        } else paintBtn();
      })
      .catch(() => {
        canEnter.vr = false;
        btn.textContent = 'VR check failed';
        btn.disabled = true;
      });
    void navigator.xr
      .isSessionSupported('immersive-ar')
      .then((ok) => {
        canEnter.ar = ok;
        paintBtn();
      })
      .catch(() => {});
  } else paintBtn();

  // Only leave VR for windows the panel can't draw (iframes); everything else is mirrored.
  ctx.windowOpened.add(() => {
    if (!active()) return;
    const modal = topModal();
    if (modal && !modal.el.querySelector('iframe')) return;
    end();
    toast('Left VR — that window needs the browser (a web page inside it)');
  });

  ctx.ticks.add('pre', ({ delta, dt }) => {
    if (!active() || !session) return;
    frameMs = frameMs * 0.9 + delta * 1000 * 0.1;
    if (frameMs > 1000 / 72) plain = true;
    controls.tick(session, dt, hooks);
  });

  ctx.ticks.add('me', ({ dt }) => {
    if (!active()) return;
    if (table) {
      tabletop.follow(rig, player.pos, dt);
      ctx.me.root.visible = true;
    } else {
      rig.position.set(player.pos.x, player.pos.y + player.stepOffset, player.pos.z);
    }
    rig.updateMatrixWorld(true);
    syncLookFromHeadset();
    aimed = null;
    onSurface = pickSurfaces(surfaces, rays, raycaster, HANDS);
  });

  ctx.ticks.add('env', () => passthrough.update(scene, ctx.inOffice() && !ctx.upTop(), table, player.pos.y));

  ctx.ticks.add('hud', ({ now }) => {
    if (!active()) return;
    for (const hand of HANDS) {
      const hit = onSurface[hand];
      if (hit) rays.show(hand, hit.hit.distance, 'panel');
      else if (hand === rays.active && aimed) rays.show(hand, aimed.distance, aimed.near ? 'near' : 'far');
      else rays.show(hand, null, 'far');
    }
    for (const s of surfaces) s.paint?.(now);
  });

  return {
    active,
    kind: () => (active() ? kindNow : null),
    preferPlain,
    end,
    toggle,
    toggleAr,
    supported: () => canEnter.vr,
    supportedAr: () => canEnter.ar,
    aimRay: () => (active() && !table ? rays.rayOf(rays.active) : null),
    onPanel: () => active() && !!onSurface[rays.active],
    landed(point, near) {
      const ray = point && rays.rayOf(rays.active);
      aimed = ray ? { distance: ray.origin.distanceTo(point), near } : null;
    },
    setTakeNote(fn) {
      takeNoteFn = fn;
    },
  };
}

function xrButton(id: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = id;
  b.className = 'xr-enter';
  return b;
}
