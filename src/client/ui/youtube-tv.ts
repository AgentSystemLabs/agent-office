import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { TV } from '../../shared/layout';
import { clampVolume, parseYoutubeLink, type YoutubeTarget } from '../youtube';
import { h, openModal, toast } from './dom';

const URL_KEY = 'droid-office.tv.url';
const VOL_KEY = 'droid-office.tv.volume';
const MUTE_KEY = 'droid-office.tv.muted';
/** The embed is drawn at this size, then scaled onto the TV (6.4 m × 3.6 m, 16:9). */
const PX = 1280;
const PY = 720;

interface YtPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  loadPlaylist(opts: { list: string; listType?: string }): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  destroy(): void;
  getIframe(): HTMLIFrameElement;
}

interface YtReady {
  target: YtPlayer;
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YtPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function readUrl(): string {
  try {
    return localStorage.getItem(URL_KEY) ?? '';
  } catch {
    return '';
  }
}

function readVolume(): number {
  try {
    const n = Number(localStorage.getItem(VOL_KEY));
    return Number.isFinite(n) ? clampVolume(n) : 40;
  } catch {
    return 40;
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked
  }
}

let apiReady: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiReady = null;
      reject(new Error('youtube'));
    };
    document.head.append(s);
  });
  return apiReady;
}

export interface YoutubeTv {
  /** Paste a link, or change the one that's on. */
  ask(): void;
  hasVideo(): boolean;
  resize(w: number, h: number): void;
  /** Place the player on the TV. `show` is false on the roof, in the garage, and in VR. */
  frame(show: boolean): void;
}

/**
 * The lounge TV's YouTube player. youtube.com itself refuses to be framed, so this is
 * YouTube's embed, stuck to the screen with a CSS 3D layer. Clicks pass through to the
 * office unless Controls is on, because the layer can't tell a person standing in front
 * of the TV from the screen behind them.
 */
export function mountYoutubeTv(screen: THREE.Object3D, camera: THREE.Camera, app: HTMLElement, before: HTMLElement): YoutubeTv {
  const cssRenderer = new CSS3DRenderer();
  cssRenderer.domElement.className = 'yt-layer';
  app.insertBefore(cssRenderer.domElement, before);

  const cssScene = new THREE.Scene();
  const host = document.createElement('div');
  host.className = 'yt-host';
  const object = new CSS3DObject(host);
  object.matrixAutoUpdate = false;
  object.visible = false;
  cssScene.add(object);

  const bar = h(
    'div.tv-volume.panel.hidden',
    {},
    h('span.lbl', {}, 'TV'),
    h('button.btn', { type: 'button' }, 'Play'),
    h('input', { type: 'range', min: '0', max: '100', value: String(readVolume()), 'aria-label': 'TV volume' }),
    h('button.btn', { type: 'button' }, 'Mute'),
    h('button.btn', { type: 'button', title: 'Hand the mouse to the YouTube player. Click again to give it back to the office.' }, 'Controls'),
    h('button.btn', { type: 'button' }, 'Change'),
    h('button.btn', { type: 'button' }, 'Off'),
  );
  const slider = bar.querySelector('input') as HTMLInputElement;
  const [playBtn, muteBtn, controlsBtn, changeBtn, offBtn] = [...bar.querySelectorAll('button')];
  if (!playBtn || !muteBtn || !controlsBtn || !changeBtn || !offBtn) throw new Error('tv controls');
  before.append(bar);

  let player: YtPlayer | null = null;
  let ready = false;
  let starting = false;
  let builtFor = '';
  let pending: YoutubeTarget | null = parseYoutubeLink(readUrl());
  let volume = readVolume();
  let muted = readMuted();
  let interactive = false;
  let userPaused = false;
  let playing = false;
  let hiding = false;
  let wasShowing = false;
  const normal = new THREE.Vector3();
  const at = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const local = new THREE.Matrix4();
  const scale = new THREE.Matrix4().makeScale(TV.width / PX, TV.height / PY, 1);
  const nudge = new THREE.Matrix4().makeTranslation(0, 0, 0.04);

  function applyVolume() {
    if (!ready || !player) return;
    player.setVolume(volume);
    if (muted || volume === 0) player.mute();
    else player.unMute();
  }

  function setInteractive(on: boolean) {
    interactive = on;
    host.classList.toggle('live', on);
    controlsBtn.classList.toggle('on', on);
    controlsBtn.textContent = on ? 'Office' : 'Controls';
  }

  function paintBar() {
    playBtn.textContent = playing ? 'Pause' : 'Play';
    muteBtn.textContent = muted || volume === 0 ? 'Sound' : 'Mute';
    slider.value = String(volume);
    bar.classList.toggle('hidden', !pending);
  }

  function idOf(target: YoutubeTarget): string {
    return `${target.videoId ?? ''}|${target.list ?? ''}|${target.start ?? 0}`;
  }

  function play(target: YoutubeTarget) {
    pending = target;
    userPaused = false;
    paintBar();
    if (!ready || !player) {
      void ensure();
      return;
    }
    builtFor = idOf(target);
    if (target.videoId) player.loadVideoById({ videoId: target.videoId, startSeconds: target.start ?? 0 });
    else if (target.list) player.loadPlaylist({ list: target.list, listType: 'playlist' });
  }

  async function ensure() {
    if (player || starting || !pending) return;
    starting = true;
    try {
      await loadApi();
    } catch {
      toast('Could not load YouTube', 'warn');
      return;
    } finally {
      starting = false;
    }
    if (player || !pending || !window.YT) return;
    const slot = document.createElement('div');
    host.append(slot);
    const target = pending;
    builtFor = idOf(target);
    const playerVars: Record<string, string | number> = {
      autoplay: 1,
      controls: 1,
      rel: 0,
      playsinline: 1,
      // White progress bar on the player's black chrome: the embed has no theme switch, and this is its dark UI.
      color: 'white',
      enablejsapi: 1,
      origin: location.origin,
      fs: 1,
      iv_load_policy: 3,
    };
    if (target.start) playerVars.start = target.start;
    if (target.list) {
      playerVars.list = target.list;
      playerVars.listType = 'playlist';
    }
    player = new window.YT.Player(slot, {
      width: String(PX),
      height: String(PY),
      videoId: target.videoId,
      playerVars,
      events: {
        onReady: (e: YtReady) => {
          ready = true;
          const frame = e.target.getIframe();
          frame.allow = 'autoplay; encrypted-media; picture-in-picture; storage-access; fullscreen';
          frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
          applyVolume();
          setInteractive(interactive);
          if (pending && idOf(pending) !== builtFor) play(pending);
        },
        onStateChange: (e: { data: number }) => {
          // 1 playing, 2 paused. display:none (looking away) pauses the embed; that isn't the viewer.
          if (e.data === 1) playing = true;
          if (e.data === 2) playing = false;
          paintBar();
          if (hiding) return;
          if (e.data === 1) userPaused = false;
          if (e.data === 2) userPaused = true;
        },
      },
    });
  }

  function stop() {
    pending = null;
    ready = false;
    playing = false;
    userPaused = true;
    write(URL_KEY, null);
    setInteractive(false);
    paintBar();
    object.visible = false;
    if (player) {
      try {
        player.stopVideo();
        player.destroy();
      } catch {
        // already gone
      }
      player = null;
    }
    host.replaceChildren();
  }

  playBtn.addEventListener('click', () => {
    if (!player || !ready) return;
    if (playing) {
      userPaused = true;
      player.pauseVideo();
    } else {
      userPaused = false;
      player.playVideo();
    }
  });
  slider.addEventListener('input', () => {
    volume = clampVolume(Number(slider.value));
    muted = volume === 0;
    write(VOL_KEY, String(volume));
    write(MUTE_KEY, muted ? '1' : '0');
    applyVolume();
    paintBar();
  });
  muteBtn.addEventListener('click', () => {
    muted = !(muted || volume === 0);
    write(MUTE_KEY, muted ? '1' : '0');
    applyVolume();
    paintBar();
  });
  controlsBtn.addEventListener('click', () => setInteractive(!interactive));
  changeBtn.addEventListener('click', () => ask());
  offBtn.addEventListener('click', () => stop());

  function ask() {
    const input = h('input', { type: 'text', placeholder: 'https://www.youtube.com/watch?v=…', value: readUrl(), 'aria-label': 'YouTube link' }) as HTMLInputElement;
    const submit = h('button.btn.primary', { type: 'submit' }, 'Play');
    const cancel = h('button.btn', { type: 'button' }, 'Cancel');
    const form = h(
      'form.modal',
      { role: 'dialog', 'aria-label': 'YouTube' },
      h('header', {}, h('h2', {}, '📺 YouTube')),
      h('div.body', {}, h('p', { style: 'margin:0 0 10px;color:var(--text-secondary)' }, 'Paste a link. It plays on the lounge TV. Play and the volume slider stay at the bottom right.'), input),
      h('footer', {}, cancel, submit),
    ) as HTMLFormElement;
    form.noValidate = true;
    const modal = openModal(form);
    cancel.addEventListener('click', () => modal.close());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const target = parseYoutubeLink(input.value);
      if (!target) {
        toast("That isn't a YouTube link", 'warn');
        input.focus();
        return;
      }
      write(URL_KEY, input.value.trim());
      modal.close();
      play(target);
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 30);
  }

  // Load the player API now, so the first Play click can start it with sound. A click's
  // permission doesn't survive waiting on the script.
  void loadApi().catch(() => {});
  if (pending) {
    paintBar();
    void ensure();
  }

  return {
    ask,
    hasVideo: () => !!pending,
    resize: (w, h) => cssRenderer.setSize(w, h),
    frame(show) {
      if (!pending) {
        object.visible = false;
        wasShowing = false;
        cssRenderer.render(cssScene, camera);
        return;
      }
      screen.updateWorldMatrix(true, false);
      local.copy(nudge).multiply(scale);
      object.matrix.multiplyMatrices(screen.matrixWorld, local);
      object.updateMatrixWorld(true);
      normal.set(0, 0, 1).transformDirection(screen.matrixWorld);
      screen.getWorldPosition(at);
      const facing = normal.dot(toCam.subVectors(camera.position, at)) > 0.15;
      const visible = show && facing;
      hiding = !visible;
      object.visible = visible;
      if (visible && !wasShowing && ready && player && !userPaused) player.playVideo();
      wasShowing = visible;
      cssRenderer.render(cssScene, camera);
    },
  };
}
