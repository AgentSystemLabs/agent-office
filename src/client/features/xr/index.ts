/**
 * Immersive WebXR (Quest / headset): Enter VR, and Enter AR for passthrough (the office in your room,
 * life-size or on the table), a locomotion rig the headset sits on, controller → office key mapping,
 * controller rays to aim with, worker terminals on a panel floating in front of you, and leaving the
 * headset when any other HTML window opens (menus, boards).
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { closeTerminal, divertTerminals, openTerminal, openTerminalFor } from '../../ui/terminal';
import { fireKey, makeXrControls, type XrHooks } from './controller';
import { TermPanel } from './panel';
import { Passthrough, Tabletop } from './passthrough';
import { XrRays, type Hand } from './rays';
import './ui.css';

const XR_SHADOW = 1024;

/** Optional features every Quest / desktop headset is happy to negotiate. */
const XR_OPTIONAL = ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] as const;

export type XrKind = 'vr' | 'ar';
const MODE: Record<XrKind, XRSessionMode> = { vr: 'immersive-vr', ar: 'immersive-ar' };
const HANDS: Hand[] = ['left', 'right'];

export interface XrApi {
  /** Whether an immersive session (VR or passthrough) is presenting right now. */
  active(): boolean;
  /** Which kind of session is presenting, or null. */
  kind(): XrKind | null;
  /**
   * Prefer a plain renderer.render over OutlineEffect: settings say so, or the headset
   * has been dropping below ~72 fps.
   */
  preferPlain(): boolean;
  /** End the session if one is running (windows open, or the button). */
  end(): void;
  /** Enter VR (or exit if already in). Same as the on-screen button. */
  toggle(): void;
  /** Enter passthrough AR (or exit if already in). */
  toggleAr(): void;
  /** Whether this browser can start immersive-vr (Quest Browser, etc.). */
  supported(): boolean;
  /** Whether this browser can start immersive-ar (passthrough). */
  supportedAr(): boolean;
  /** The aiming controller's ray (world space), while it's tracked and you're life-size; null otherwise. */
  aimRay(): THREE.Ray | null;
  /** Whether the aiming controller points at the terminal panel, rather than at the office. */
  onPanel(): boolean;
  /** Where the office's aim along aimRay landed on something to use (null for nothing), and whether it's in reach. */
  landed(point: THREE.Vector3 | null, near: boolean): void;
}

/** Enables WebXR on the renderer, the Enter VR / AR controls, and the per-frame rig / controllers. */
export function installXR(ctx: Ctx, parts: Pick<Parts, 'stage' | 'settings' | 'player'>): XrApi {
  const { renderer, camera, scene } = { renderer: ctx.renderer, camera: ctx.camera, scene: ctx.scene };
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
  const head = new THREE.Vector3();
  const controls = makeXrControls(player);
  const rays = new XrRays(renderer, rig);
  const panel = new TermPanel();
  const passthrough = new Passthrough(renderer);
  const tabletop = new Tabletop();
  const raycaster = new THREE.Raycaster();

  let session: XRSession | null = null;
  let kindNow: XrKind | null = null;
  /** In passthrough, the office is a model on the table rather than life-size around you. */
  let table = false;
  const canEnter: Record<XrKind, boolean> = { vr: false, ar: false };
  let savedParent: THREE.Object3D | null = null;
  let savedView = player.view;
  let savedShadow = sun.shadow.mapSize.x;
  /** Rolling frame-time estimate while presenting (ms). */
  let frameMs = 1000 / 90;
  let plain = false;
  /** The panel button each hand points at this frame (-1: the panel but no button), and how far. */
  const onPanelHit: Record<Hand, { button: number; distance: number } | null> = { left: null, right: null };
  /** What the office's aim landed on this frame (see landed). */
  let aimed: { distance: number; near: boolean } | null = null;
  /** A terminal to open in the browser once the session has ended (⌨ Type on the panel). */
  let typeIn: string | null = null;
  /** Pinches kept by the panel, so their release is too. */
  const pinchKept = new Set<Hand>();

  const bar = document.createElement('div');
  bar.className = 'xr-buttons';
  const btn = xrButton('xr-enter');
  const arBtn = xrButton('xr-enter-ar');
  arBtn.hidden = true;
  bar.append(arBtn, btn);
  // Always visible: if VR isn't available, the label says why (was silently hidden before).
  document.body.appendChild(bar);

  function active() {
    return session !== null && renderer.xr.isPresenting;
  }

  function preferPlain() {
    return !parts.settings.xrOutline || plain;
  }

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
    // On the table you watch yourself walk: you face where you're going, not where the headset looks.
    if (!table) player.facing = Math.atan2(Math.sin(player.camYaw + Math.PI), Math.cos(player.camYaw + Math.PI));
  }

  /** Life-size, standing in the office; or (passthrough only) the office as a model on the table. */
  function setTable(on: boolean) {
    table = on;
    player.view = on ? 'third' : 'first';
    if (on) tabletop.place(rig, camera, player.pos);
    else rig.scale.setScalar(1);
    if (panel.workerId) placePanel();
  }

  // ---- The terminal panel ------------------------------------------------------------------------
  function openPanel(workerId: string) {
    if (panel.workerId !== workerId) {
      if (panel.workerId) ctx.net.send({ t: 'worker.detach', workerId: panel.workerId });
      // Attached, so the keys you press on the panel reach the terminal.
      ctx.net.send({ t: 'worker.attach', workerId });
    }
    panel.open(workerId);
    placePanel();
  }

  function closePanel() {
    if (!panel.workerId) return;
    ctx.net.send({ t: 'worker.detach', workerId: panel.workerId });
    panel.close();
  }

  /** Floats the panel a little over a meter in front of you, facing you, and carries it along with the rig. */
  function placePanel() {
    rig.updateMatrixWorld(true);
    const s = rig.scale.x;
    camera.getWorldPosition(head);
    camera.getWorldDirection(lookDir).setY(0);
    if (lookDir.lengthSq() < 1e-4) lookDir.set(0, 0, -1);
    lookDir.normalize();
    scene.add(panel.mesh);
    panel.mesh.position.copy(head).addScaledVector(lookDir, 1.1 * s);
    panel.mesh.position.y -= 0.15 * s;
    panel.mesh.scale.setScalar(s);
    panel.mesh.lookAt(head);
    rig.attach(panel.mesh);
  }

  function pressPanel(button: number) {
    const id = panel.workerId;
    const act = id ? panel.press(button, performance.now()) : null;
    if (!id || !act) return;
    if ('input' in act) ctx.net.send({ t: 'term.input', workerId: id, data: act.input });
    else if ('close' in act) closePanel();
    else {
      // The browser's own keyboard can't come up inside the headset: type in the terminal window.
      closePanel();
      typeIn = id;
      end();
    }
  }

  divertTerminals((workerId) => {
    if (!active()) return false;
    openPanel(workerId);
    return true;
  });
  // A reconnected office has forgotten which terminal the panel was attached to.
  ctx.messages.on('welcome', () => {
    if (panel.workerId && store.workers.has(panel.workerId)) ctx.net.send({ t: 'worker.attach', workerId: panel.workerId });
  });
  // Sent home, or off another floor.
  store.on('workers', () => {
    if (panel.workerId && !store.workers.has(panel.workerId)) closePanel();
  });

  // ---- Controllers ---------------------------------------------------------------------------------
  const hooks: XrHooks = {
    snapYaw(dyaw) {
      rig.rotation.y += dyaw;
    },
    zoom(amount, dt) {
      if (table) tabletop.zoom(rig, amount, dt);
    },
    press(hand, code, down) {
      if (code === 'XrGrip') {
        if (down && kindNow === 'ar') {
          setTable(!table);
          toast(table ? 'On the table: left stick walks you, right stick turns and zooms it' : 'Life-size');
        }
        return true;
      }
      if (code === 'KeyE') {
        if (down) rays.active = hand;
        const hit = onPanelHit[hand];
        if (!hit) return false;
        if (down) pressPanel(hit.button);
        return true;
      }
      if (code === 'Escape' && panel.workerId) {
        if (down) closePanel();
        return true;
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

  // ---- Sessions ------------------------------------------------------------------------------------
  function onSessionEnd() {
    if (!session) return;
    session = null;
    kindNow = null;
    controls.reset();
    closePanel();
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
    const id = typeIn;
    typeIn = null;
    if (id && store.workers.has(id)) setTimeout(() => openTerminal(ctx.net, id), 0);
  }

  async function startSession(kind: XrKind) {
    if (!navigator.xr || session) return;
    if (!window.isSecureContext) {
      toast('WebXR needs HTTPS — open the https:// link on the Quest, or adb reverse to localhost', 'warn');
      return;
    }
    try {
      const s = await navigator.xr.requestSession(MODE[kind], {
        optionalFeatures: [...XR_OPTIONAL],
      });
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
      // Align the rig so "forward" matches where you were looking before Enter VR.
      rig.rotation.set(0, player.camYaw, 0);
      camera.rotation.set(0, 0, 0);
      camera.position.set(0, 0, 0);
      rig.add(camera);
      document.body.classList.add('xr-active');
      frameMs = 1000 / 90;
      plain = !parts.settings.xrOutline;
      // A terminal window you had open comes along on the panel.
      const open = openTerminalFor();
      if (open) {
        closeTerminal();
        openPanel(open);
      }
      if (kind === 'ar') {
        passthrough.enter();
        // Before the headset has a pose the table lands where the session starts; this frame's pose is a tick away.
        setTimeout(() => active() && kindNow === 'ar' && setTable(true), 100);
      }
      paintBtn();
      toast(
        kind === 'ar'
          ? 'Passthrough on — right grip switches between the table and life-size, right stick turns and zooms'
          : 'VR on — left stick walk, trigger points and uses, B back. Terminals float in front of you',
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

  // Probe support; keep the VR button visible either way so a missing headset isn't silent.
  if (navigator.xr?.isSessionSupported) {
    void navigator.xr
      .isSessionSupported('immersive-vr')
      .then((ok) => {
        canEnter.vr = ok;
        if (!ok && window.isSecureContext) {
          btn.textContent = 'VR headset not found';
          btn.disabled = true;
          btn.title = 'Open this page in the Meta Quest Browser (not a desktop tab)';
        } else {
          paintBtn();
        }
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
  } else {
    paintBtn();
  }

  // HTML overlays can't draw inside an immersive session: leave VR so the window is usable.
  // (Terminals don't open a window in VR: they go on the panel, see divertTerminals.)
  ctx.windowOpened.add(() => {
    if (!active()) return;
    end();
    toast('Left VR so you can use the window — tap Enter VR to go back');
  });

  ctx.ticks.add('pre', ({ delta, dt }) => {
    if (!active() || !session) return;
    frameMs = frameMs * 0.9 + delta * 1000 * 0.1;
    if (frameMs > 1000 / 72) plain = true;
    controls.tick(session, dt, hooks);
  });

  // After the player has moved: put the rig on their feet (or the table under them), aim movement
  // with the headset, and see what each hand points at on the panel before the office aims.
  ctx.ticks.add('me', ({ dt }) => {
    if (!active()) return;
    if (table) {
      tabletop.follow(rig, player.pos, dt);
      // You're a little figure on the table: there to be seen.
      ctx.me.root.visible = true;
    } else {
      rig.position.set(player.pos.x, player.pos.y + player.stepOffset, player.pos.z);
    }
    rig.updateMatrixWorld(true);
    syncLookFromHeadset();
    aimed = null;
    for (const hand of HANDS) {
      const ray = panel.workerId ? rays.rayOf(hand) : null;
      if (ray) raycaster.ray.copy(ray);
      const hit = ray ? panel.hit(raycaster) : null;
      onPanelHit[hand] = hit;
      panel.setHover(hand, hit?.button ?? -1);
    }
  });

  // Passthrough: once the sky has set the fog for the frame, cut the office out of the world.
  ctx.ticks.add('env', () => passthrough.update(scene, ctx.inOffice() && !ctx.upTop(), table, player.pos.y));

  // The lasers, out to what each hand points at, and the panel's picture.
  ctx.ticks.add('hud', ({ now }) => {
    if (!active()) return;
    for (const hand of HANDS) {
      const hit = onPanelHit[hand];
      if (hit) rays.show(hand, hit.distance, 'panel');
      else if (hand === rays.active && aimed) rays.show(hand, aimed.distance, aimed.near ? 'near' : 'far');
      else rays.show(hand, null, 'far');
    }
    panel.paint(now);
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
    onPanel: () => active() && !!onPanelHit[rays.active],
    landed(point, near) {
      const ray = point && rays.rayOf(rays.active);
      aimed = ray ? { distance: ray.origin.distanceTo(point), near } : null;
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
