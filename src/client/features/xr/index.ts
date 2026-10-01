/**
 * Immersive WebXR (Quest / headset): Enter VR button, a locomotion rig the headset sits on,
 * controller → office key mapping, and leaving VR when an HTML window opens (terminals, menus).
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { toast } from '../../ui/dom';
import { makeXrControls } from './controller';
import './ui.css';

const XR_SHADOW = 1024;

/** Optional features every Quest / desktop headset is happy to negotiate. */
const XR_OPTIONAL = ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] as const;

export interface XrApi {
  /** Whether an immersive-vr session is presenting right now. */
  active(): boolean;
  /**
   * Prefer a plain renderer.render over OutlineEffect: settings say so, or the headset
   * has been dropping below ~72 fps.
   */
  preferPlain(): boolean;
  /** End the session if one is running (windows open, or the button). */
  end(): void;
  /** Enter VR (or exit if already in). Same as the on-screen button. */
  toggle(): void;
  /** Whether this browser can start immersive-vr (Quest Browser, etc.). */
  supported(): boolean;
}

/** Enables WebXR on the renderer, the Enter VR control, and the per-frame rig / controllers. */
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
  const controls = makeXrControls(player);

  let session: XRSession | null = null;
  let canEnter = false;
  let savedParent: THREE.Object3D | null = null;
  let savedView = player.view;
  let savedShadow = sun.shadow.mapSize.x;
  /** Rolling frame-time estimate while presenting (ms). */
  let frameMs = 1000 / 90;
  let plain = false;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'xr-enter';
  btn.className = 'xr-enter';
  btn.textContent = '🥽 Enter VR';
  btn.title = 'Put on the headset and walk the office in VR';
  // Always visible: if VR isn't available, the label says why (was silently hidden before).
  document.body.appendChild(btn);

  function active() {
    return session !== null && renderer.xr.isPresenting;
  }

  function preferPlain() {
    return !parts.settings.xrOutline || plain;
  }

  function supported() {
    return canEnter;
  }

  function paintBtn() {
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
    if (!canEnter) {
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
    player.facing = Math.atan2(Math.sin(player.camYaw + Math.PI), Math.cos(player.camYaw + Math.PI));
  }

  function onSessionEnd() {
    if (!session) return;
    session = null;
    controls.reset();
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

  async function startSession() {
    if (!navigator.xr || session) return;
    if (!window.isSecureContext) {
      toast('WebXR needs HTTPS — open the https:// link on the Quest, or adb reverse to localhost', 'warn');
      return;
    }
    try {
      const s = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: [...XR_OPTIONAL],
      });
      s.addEventListener('end', onSessionEnd);
      await renderer.xr.setSession(s);
      session = s;
      savedView = player.view;
      player.view = 'first';
      player.xrCamera = true;
      savedShadow = sun.shadow.mapSize.x;
      sun.shadow.mapSize.set(XR_SHADOW, XR_SHADOW);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      savedParent = camera.parent;
      scene.add(rig);
      rig.position.set(player.pos.x, player.pos.y + player.stepOffset, player.pos.z);
      // Align the rig so "forward" matches where you were looking before Enter VR.
      rig.rotation.set(0, player.camYaw, 0);
      camera.rotation.set(0, 0, 0);
      camera.position.set(0, 0, 0);
      rig.add(camera);
      document.body.classList.add('xr-active');
      frameMs = 1000 / 90;
      plain = !parts.settings.xrOutline;
      paintBtn();
      toast('VR on — left stick walk, A interact, B back. Opening a window leaves VR');
    } catch (err) {
      console.warn('WebXR session failed', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Could not enter VR: ${msg}`, 'warn');
      btn.textContent = 'VR failed — tap to retry';
      btn.disabled = false;
    }
  }

  function end() {
    session?.end().catch(() => {});
  }

  function toggle() {
    if (session) end();
    else void startSession();
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });

  paintBtn();

  // Probe support; keep the button visible either way so a missing headset isn't silent.
  if (navigator.xr?.isSessionSupported) {
    void navigator.xr
      .isSessionSupported('immersive-vr')
      .then((ok) => {
        canEnter = ok;
        if (!ok && window.isSecureContext) {
          btn.textContent = 'VR headset not found';
          btn.disabled = true;
          btn.title = 'Open this page in the Meta Quest Browser (not a desktop tab)';
        } else {
          paintBtn();
        }
      })
      .catch(() => {
        canEnter = false;
        btn.textContent = 'VR check failed';
        btn.disabled = true;
      });
  } else {
    paintBtn();
  }

  // HTML overlays can't draw inside an immersive session: leave VR so the window is usable.
  ctx.windowOpened.add(() => {
    if (!active()) return;
    end();
    toast('Left VR so you can use the window — tap Enter VR to go back');
  });

  ctx.ticks.add('pre', ({ delta }) => {
    if (!active() || !session) return;
    frameMs = frameMs * 0.9 + delta * 1000 * 0.1;
    if (frameMs > 1000 / 72) plain = true;
    controls.tick(session, (dyaw) => {
      rig.rotation.y += dyaw;
    });
  });

  // After the player has moved: put the rig on their feet and aim movement with the headset.
  ctx.ticks.add('me', () => {
    if (!active()) return;
    rig.position.set(player.pos.x, player.pos.y + player.stepOffset, player.pos.z);
    syncLookFromHeadset();
  });

  return { active, preferPlain, end, toggle, supported };
}
