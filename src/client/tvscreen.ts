// The big TV's picture: an ordinary `<iframe>` or `<video>` laid over the canvas and re-projected
// onto the TV's rectangle every frame, because WebGL can't draw a cross-origin player (see
// docs/tv-streaming.md). What's on it is shared state like the jukebox's; this keeps whatever is
// playing here in step with it, and takes the picture away whenever the TV can't be seen.

import * as THREE from 'three';
import { TV } from '../shared/layout';
import { classify, embedUrl, positionAt, youtubeId, type TvKind, type TvState } from '../shared/tv';
import { store } from './state';
import { h, toast } from './ui/dom';
import type { Collider } from './world/office';

/** The picture's own size: the TV is 16:9, so what goes on it is too (see .tv-frame in style.css). */
const WIDTH = 1280;
const HEIGHT = 720;
/** Seconds out of step with the floor before the picture is dragged back to where it should be. */
const CATCH_UP = 1.5;
/** How often that's checked (ms). */
const TICK = 500;
/** The grid the picture's occlusion is worked out on: one cell per mask pixel (the TV is 16:9 too). */
const MASK_W = 32;
const MASK_H = 18;
/** How often that's worked out (ms). People move slowly, and building the mask isn't free. */
const MASK_TICK = 80;
/** Match the jukebox's near-field volume and inverse-distance falloff. */
const TV_REF = 2.5;
const TV_ROLLOFF = 1.3;

// ---- YouTube's IFrame API, which is how play, pause and seek reach a YouTube link ----------------

interface YoutubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  /** 0–100, as YouTube counts it. */
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  /** -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
  getPlayerState(): number;
  destroy(): void;
}

interface YoutubeApi {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YoutubePlayer;
}

interface ListenerPosition {
  x: number;
  y: number;
  z: number;
}

declare global {
  interface Window {
    YT?: YoutubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** YouTube's API, loaded the first time a link of its kind goes on; null when it can't be had. */
let youtube: Promise<YoutubeApi | null> | null = null;
function youtubeApi(): Promise<YoutubeApi | null> {
  if (youtube) return youtube;
  youtube = new Promise((resolve) => {
    const done = () => resolve(window.YT?.Player ? window.YT : null);
    if (window.YT?.Player) return done();
    const was = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      was?.();
      done();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = done;
    document.head.append(script);
    // Blocked or offline: fall back to a plain iframe rather than wait for a page that never comes.
    setTimeout(done, 10_000);
  });
  return youtube;
}

/**
 * The 2D transform taking four points to four others, as `[a, b, c, d, e, f, g, h]` for the matrix
 * `[[a b c], [d e f], [g h 1]]` — a CSS `matrix3d`, solved the long way so any four corners work.
 * Returns null when they're flat against the camera, where no planar transform will do.
 */
function homography(from: readonly (readonly [number, number])[], to: readonly (readonly [number, number])[]): number[] | null {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gauss-Jordan, with partial pivoting so a near-edge-on screen doesn't come out as noise.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-6) return null;
    if (pivot !== col) [rows[pivot], rows[col]] = [rows[col], rows[pivot]];
    const lead = rows[col][col];
    for (let k = col; k < 9; k++) rows[col][k] /= lead;
    for (let row = 0; row < 8; row++) {
      if (row === col || !rows[row][col]) continue;
      const times = rows[row][col];
      for (let k = col; k < 9; k++) rows[row][k] -= times * rows[col][k];
    }
  }
  return rows.map((r) => r[8]);
}

/** Whether the way from `eye` to the TV runs through `c` (a wall, the loft's floor, a desk…). */
function blocks(eye: THREE.Vector3, to: THREE.Vector3, c: Collider): boolean {
  const from = [eye.x, eye.y, eye.z];
  const delta = [to.x - eye.x, to.y - eye.y, to.z - eye.z];
  const low = [c.minX, c.bottom ?? 0, c.minZ];
  const high = [c.maxX, c.top, c.maxZ];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(delta[i]) < 1e-9) {
      if (from[i] < low[i] || from[i] > high[i]) return false;
      continue;
    }
    let a = (low[i] - from[i]) / delta[i];
    let b = (high[i] - from[i]) / delta[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

/** The link on the TV, as it plays here: the element itself, and where it is against everyone else's. */
export class TvScreen {
  /** The layer over the canvas (index.html); null on a page without one. */
  private readonly layer: HTMLElement | null;
  /** The 1280×720 element that gets transformed onto the TV's corners. */
  private readonly frame: HTMLElement;
  private state: TvState = { on: false, playing: false, position: 0, at: 0 };
  /** How the picture is being driven, which is embed rather than youtube when the API can't load. */
  private kind: TvKind | null = null;
  private el: HTMLElement | null = null;
  private yt: YoutubePlayer | null = null;
  /**
   * Whether YouTube's player has said it's ready. `new YT.Player(…)` hands back an object whose
   * methods only arrive with `onReady`; asking it anything before then throws, and one throw in the
   * frame loop used to leave the whole office frozen.
   */
  private ready = false;
  /** What the element was loaded with, and where from (for an embed, which can't be asked). */
  private link = '';
  private from = 0;
  private started = 0;
  private ran = false;
  private checked = 0;
  /** When the browser last refused to start it with sound (see blocked). */
  private refusedAt = 0;
  /** How loud your own speakers are, 0–1, and whether they're off. Just yours, like the jukebox's. */
  volume = 1;
  muted = false;
  private soundDistance = Infinity;
  /** Told when the sound changes here rather than in the window (the autoplay fallback does it). */
  onSound: (() => void) | null = null;
  private readonly corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly scratch = new THREE.Vector3();
  /** A second scratch for the occlusion cull, which needs the point both in view and in world space. */
  private readonly probe = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  /** The last thing in front of each cell of the picture, as a mask for the frame (see occlude). */
  private readonly mask = document.createElement('canvas');
  private readonly maskCtx = this.mask.getContext('2d');
  private readonly maskPixels = this.maskCtx?.createImageData(MASK_W, MASK_H);
  private maskedAt = 0;
  private maskUrl = '';
  private walled = false;
  private readonly pixels: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];

  constructor(private readonly screen: THREE.Mesh) {
    this.layer = document.getElementById('stream-layer');
    this.frame = h('div.tv-frame');
    this.layer?.append(this.frame);
    this.mask.width = MASK_W;
    this.mask.height = MASK_H;
  }

  /** The floor says the TV changed: take it down, put what's on it up, or bring it back in step. */
  sync(state: TvState) {
    this.state = state;
    if (!state.on || !state.url || state.url !== this.link) this.load();
    else this.align(store.officeNow(), true);
  }

  /** How long the video is here, when the player will say (an arbitrary embed never will): 0 for none. */
  duration(): number {
    try {
      if (this.kind === 'media' && this.el instanceof HTMLVideoElement) return Number.isFinite(this.el.duration) ? this.el.duration : 0;
      if (this.kind === 'youtube' && this.yt && this.ready) return this.yt.getDuration() || 0;
    } catch {
      // not far enough into the video to know yet
    }
    return 0;
  }

  /** Your own speakers: how loud, and whether they're off. False when this player won't take it. */
  setVolume(volume: number, muted: boolean): boolean {
    this.volume = Math.max(0, Math.min(1, volume));
    this.muted = muted;
    return this.applySound();
  }

  /** Updates the listener used to make the TV quieter with distance, like the jukebox. */
  setListener(position: ListenerPosition) {
    const distance = Math.hypot(position.x - TV.x, position.y - TV.y, position.z - TV.z);
    if (Math.abs(distance - this.soundDistance) < 0.02) return;
    this.soundDistance = distance;
    this.applySound(false);
  }

  /** Turns your own speakers down or up. False when this player won't take the order (see the window). */
  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.applySound()) return true;
    this.muted = !this.muted;
    return false;
  }

  /**
   * Puts the level and the mute on whatever is playing here, so the window, the settings and the
   * autoplay fallback all come out the same. Not every player takes orders: an arbitrary embed has
   * no sound knob at all, and says so (see the window).
   */
  private applySound(notify = true): boolean {
    const media = this.kind === 'media' && this.el instanceof HTMLVideoElement ? this.el : null;
    const youtube = this.kind === 'youtube' && this.yt && this.ready ? this.yt : null;
    if (!media && !youtube) return false;
    const off = this.muted || this.volume === 0;
    const distance = Math.max(TV_REF, this.soundDistance === Infinity ? TV_REF : this.soundDistance);
    const distanceGain = TV_REF / (TV_REF + TV_ROLLOFF * (distance - TV_REF));
    if (media) {
      media.volume = this.volume * distanceGain;
      media.muted = off;
    } else if (youtube) {
      youtube.setVolume(Math.round(this.volume * distanceGain * 100));
      if (off) youtube.mute();
      else youtube.unMute();
    }
    if (notify) this.onSound?.();
    return true;
  }

  /**
   * Every frame: keep the picture where the floor says it should be, then put it on the TV's
   * rectangle — or take it away, if the TV isn't somewhere you can see it (call after rendering).
   */
  update(camera: THREE.PerspectiveCamera, show: boolean, colliders: readonly Collider[], listener: ListenerPosition) {
    this.setListener(listener);
    try {
      this.align(store.officeNow());
    } catch {
      // A player that won't answer is no reason to take the frame down; the next tick tries again.
    }
    if (!this.layer) return;
    const sited = show && this.state.on && !!this.el && this.sited(camera, colliders);
    this.layer.style.display = sited && !this.walled ? '' : 'none';
  }

  // ---- What's on it ---------------------------------------------------------------------------

  private load() {
    this.clear();
    const s = this.state;
    if (!this.layer || !s.on || !s.url) return;
    this.link = s.url;
    this.kind = classify(s.url);
    this.from = positionAt(s, store.officeNow());
    this.started = Date.now();
    this.ran = s.playing;
    if (this.kind === 'youtube') void this.loadYoutube(s.url, this.from, s.playing);
    else if (this.kind === 'media') this.loadMedia(s.url, this.from, s.playing);
    else this.loadEmbed(s.url, this.from, s.playing);
  }

  private clear() {
    this.yt?.destroy();
    this.yt = null;
    this.ready = false;
    this.el?.remove();
    this.el = null;
    this.kind = null;
    this.link = '';
    this.from = 0;
    this.started = 0;
    this.ran = false;
    // The mask belongs to what was on, not to what comes next.
    this.walled = false;
    this.maskedAt = 0;
    if (this.maskUrl) {
      this.maskUrl = '';
      this.frame.style.maskImage = '';
      this.frame.style.setProperty('-webkit-mask-image', '');
    }
  }

  /** A direct media file: the only player that can be asked anything at all, and asked at once. */
  private loadMedia(url: string, start: number, playing: boolean) {
    const video = h('video', { src: url, autoplay: '', playsinline: '', preload: 'auto' }) as HTMLVideoElement;
    this.el = video;
    this.frame.append(video);
    this.applySound(false);
    const begin = () => {
      if (start > 1 && Math.abs(video.currentTime - start) > 1) {
        try {
          video.currentTime = start;
        } catch {
          // no metadata yet: the first tick will try again
        }
      }
      if (playing) this.roll(video);
    };
    if (video.readyState > 0) begin();
    else video.addEventListener('loadedmetadata', begin, { once: true });
  }

  /** Anything else in an iframe: it plays or it doesn't, at the site's discretion. */
  private loadEmbed(url: string, start: number, playing: boolean) {
    let src = embedUrl(url, start);
    if (!playing) {
      // Loaded while it's paused (you joined half way through): don't start it going.
      try {
        const u = new URL(src);
        u.searchParams.delete('autoplay');
        src = u.href;
      } catch {
        // a link that can't be re-read is played as it came
      }
    }
    const frame = h('iframe', { src, title: 'Office TV', allow: 'autoplay; fullscreen; picture-in-picture', allowfullscreen: '' }) as HTMLIFrameElement;
    this.el = frame;
    this.frame.append(frame);
  }

  private async loadYoutube(url: string, start: number, playing: boolean) {
    const link = this.link;
    const wrap = h('div.tv-player');
    const host = h('div');
    wrap.append(host);
    this.el = wrap;
    this.frame.append(wrap);
    const id = youtubeId(url);
    const api = await youtubeApi();
    // Something else went on (or came off) while the API was fetched.
    if (this.link !== link || this.el !== wrap) return;
    if (!api || !id) {
      // No API: a plain iframe, which starts where it's told and then runs as it likes.
      wrap.remove();
      this.kind = 'embed';
      this.loadEmbed(url, start, playing);
      return;
    }
    const player = new api.Player(host, {
      width: WIDTH,
      height: HEIGHT,
      videoId: id,
      playerVars: { autoplay: playing ? 1 : 0, start: Math.floor(start), playsinline: 1, rel: 0, controls: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          // Only if this is still the player on the TV (a new link may have arrived meanwhile).
          if (this.yt !== player) return;
          this.ready = true;
          this.applySound(false);
          if (start > 1 && Math.abs(player.getCurrentTime() - start) > 1) player.seekTo(start, true);
          if (playing) player.playVideo();
          else player.pauseVideo();
        },
        onAutoplayBlocked: () => this.blocked(player),
      },
    });
    if (this.link !== link) {
      // Synced on again to something else while it was being built.
      player.destroy();
      return;
    }
    this.yt = player;
  }

  /** The browser won't start it with sound: turn the sound down, try again, and say so. */
  private blocked(player: YoutubePlayer) {
    const now = Date.now();
    if (now - this.refusedAt < 4000) return;
    this.refusedAt = now;
    if (!this.muted) {
      this.muted = true;
      this.onSound?.();
      toast('The browser held the TV’s sound back — the sound row in the TV window turns it on', 'warn');
    }
    try {
      player.mute();
      player.playVideo();
    } catch {
      // a player that won't take the order yet: the next tick tries again
    }
  }

  /** Started (or started again) with sound the browser may not allow yet: quietly is better than never. */
  private roll(video: HTMLVideoElement) {
    void video.play().catch(() => {
      if (this.muted) return;
      this.muted = true;
      video.muted = true;
      this.onSound?.();
      toast('The browser held the TV’s sound back — the sound row in the TV window turns it on', 'warn');
      void video.play().catch(() => {});
    });
  }

  // ---- Keeping in step ------------------------------------------------------------------------

  /** Puts this browser back where the floor says the TV is: playing, paused, and at the right second. */
  private align(now: number, force = false) {
    if (!force && now - this.checked < TICK) return;
    this.checked = now;
    const s = this.state;
    if (!s.on || !this.el || !this.kind) return;
    const want = positionAt(s, now);
    if (this.kind === 'media' && this.el instanceof HTMLVideoElement) {
      const video = this.el;
      const end = video.duration;
      const away = Number.isFinite(end) && want >= end - 0.2;
      if (Math.abs(want - video.currentTime) > CATCH_UP && !away) {
        try {
          video.currentTime = want;
        } catch {
          // no metadata yet; next tick
        }
      }
      if (s.playing && !away && video.paused) this.roll(video);
      else if (!s.playing && !video.paused) video.pause();
      return;
    }
    if (this.kind === 'youtube') {
      // Its methods only arrive with `onReady`; until then there is nothing to ask (see ready).
      if (!this.yt || !this.ready) return;
      const yt = this.yt;
      const end = yt.getDuration();
      const away = end > 0 && want >= end - 0.2;
      const state = yt.getPlayerState();
      if (Math.abs(want - yt.getCurrentTime()) > CATCH_UP && !away) yt.seekTo(want, true);
      // Not straight after a refusal: that only makes it refuse again (see blocked).
      const stubborn = Date.now() - this.refusedAt < 4000;
      if (s.playing && !away && !stubborn && state !== 1 && state !== 3) yt.playVideo();
      else if (!s.playing && (state === 1 || state === 3)) yt.pauseVideo();
      return;
    }
    // An embed can't be asked, so it's reloaded when the floor moves it on or back.
    const have = this.from + (this.ran ? (Date.now() - this.started) / 1000 : 0);
    if (s.playing !== this.ran || Math.abs(want - have) > CATCH_UP) this.load();
  }

  // ---- Where it goes on screen ----------------------------------------------------------------

  /** The TV's corners here and in pixels, the way it's looking now: false when it isn't in view. */
  private sited(camera: THREE.PerspectiveCamera, colliders: readonly Collider[]): boolean {
    this.screen.updateWorldMatrix(true, false);
    const geo = this.screen.geometry;
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) return false;
    const local: [number, number][] = [
      [box.min.x, box.max.y],
      [box.max.x, box.max.y],
      [box.max.x, box.min.y],
      [box.min.x, box.min.y],
    ];
    const w = this.layer!.clientWidth || window.innerWidth;
    const hgt = this.layer!.clientHeight || window.innerHeight;
    for (let i = 0; i < 4; i++) {
      const corner = this.corners[i].set(local[i][0], local[i][1], 0).applyMatrix4(this.screen.matrixWorld);
      // Behind your eye: it would project inside out, so it isn't on screen at all.
      this.scratch.copy(corner).applyMatrix4(camera.matrixWorldInverse);
      if (this.scratch.z > -camera.near) return false;
      corner.project(camera);
      this.pixels[i] = [(corner.x * 0.5 + 0.5) * w, (-corner.y * 0.5 + 0.5) * hgt];
    }
    this.eye.copy(camera.position);
    const from: [number, number][] = [
      [0, 0],
      [WIDTH, 0],
      [WIDTH, HEIGHT],
      [0, HEIGHT],
    ];
    const matrix = homography(from, this.pixels);
    if (!matrix) return false;
    const [a, b, c, d, e, f, g, i] = matrix;
    this.frame.style.transform = `matrix3d(${a},${d},0,${g},${b},${e},0,${i},0,0,1,0,${c},${f},0,1)`;
    // What's standing in front of it, so the picture is hidden behind it (see occlude).
    this.occlude(camera, colliders);
    return true;
  }

  /**
   * Puts what's between your eye and each part of the screen into the frame's own mask, so the
   * picture is hidden behind it. Ordinary HTML can't be depth-tested against the scene, and the TV
   * is only ever a metre or two from a wall, a desk, a plant or someone standing in the way — so
   * each cell of the picture is asked whether anything is in front of it. Glass you can see through
   * and fences aren't in the way; people are. Answered every MASK_TICK, into a small canvas that
   * the browser stretches over the frame (see .tv-frame in style.css), and the whole frame is taken
   * away rather than masked when every last cell is behind something.
   */
  private occlude(camera: THREE.PerspectiveCamera, colliders: readonly Collider[]) {
    const ctx = this.maskCtx;
    const pixels = this.maskPixels;
    if (!ctx || !pixels) return;
    const now = performance.now();
    if (now - this.maskedAt < MASK_TICK) return;
    this.maskedAt = now;
    const box = this.screen.geometry.boundingBox;
    if (!box) return;
    const inTheWay = this.inTheWay(camera, colliders);
    const eye = this.eye;
    const scratch = this.scratch;
    const data = pixels.data;
    let hidden = 0;
    for (let my = 0; my < MASK_H; my++) {
      const y = box.min.y + ((my + 0.5) / MASK_H) * (box.max.y - box.min.y);
      for (let mx = 0; mx < MASK_W; mx++) {
        const x = box.min.x + ((mx + 0.5) / MASK_W) * (box.max.x - box.min.x);
        scratch.set(x, y, 0).applyMatrix4(this.screen.matrixWorld);
        let blocked = false;
        for (const c of inTheWay) {
          if (blocks(eye, scratch, c)) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          for (const p of store.peers.values()) {
            if (p.id === store.you || p.lite || !store.onMyFloor(p)) continue;
            // People aren't colliders: a person-sized box standing where they are.
            if (blocks(eye, scratch, { minX: p.x - 0.35, maxX: p.x + 0.35, minZ: p.z - 0.35, maxZ: p.z + 0.35, bottom: p.y, top: p.y + 1.8 })) {
              blocked = true;
              break;
            }
          }
        }
        const i = (my * MASK_W + mx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = blocked ? 0 : 255;
        if (blocked) hidden++;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    const url = `url("${this.mask.toDataURL()}")`;
    if (url !== this.maskUrl) {
      this.maskUrl = url;
      this.frame.style.maskImage = url;
      this.frame.style.setProperty('-webkit-mask-image', url);
    }
    this.walled = hidden === MASK_W * MASK_H;
  }

  /**
   * The colliders that could possibly show up in front of the TV from here: the office has hundreds,
   * and testing every one against every cell of the mask would cost more than the rest of the frame.
   * A collider that reaches the TV's rectangle on screen (or straddles the camera, where its corners
   * say nothing) is kept; the rest of the building is culled.
   */
  private inTheWay(camera: THREE.PerspectiveCamera, colliders: readonly Collider[]): Collider[] {
    const w = this.layer!.clientWidth || window.innerWidth;
    const hgt = this.layer!.clientHeight || window.innerHeight;
    let tvMinX = Infinity;
    let tvMinY = Infinity;
    let tvMaxX = -Infinity;
    let tvMaxY = -Infinity;
    for (const [x, y] of this.pixels) {
      if (x < tvMinX) tvMinX = x;
      if (x > tvMaxX) tvMaxX = x;
      if (y < tvMinY) tvMinY = y;
      if (y > tvMaxY) tvMaxY = y;
    }
    const out: Collider[] = [];
    const scratch = this.scratch;
    for (const c of colliders) {
      // Glass you can see a TV through; a fence is only there to stop you walking into something.
      if (c.glass || c.fence) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let straddles = false;
      for (let i = 0; i < 8 && !straddles; i++) {
        scratch.set(i & 1 ? c.maxX : c.minX, i & 2 ? c.top : (c.bottom ?? 0), i & 4 ? c.maxZ : c.minZ);
        if (this.probe.copy(scratch).applyMatrix4(camera.matrixWorldInverse).z > -camera.near) {
          // Behind your eye: its corners project inside out, so it can't be culled by them.
          straddles = true;
          break;
        }
        scratch.project(camera);
        const px = (scratch.x * 0.5 + 0.5) * w;
        const py = (-scratch.y * 0.5 + 0.5) * hgt;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      if (straddles || (maxX >= tvMinX && minX <= tvMaxX && maxY >= tvMinY && minY <= tvMaxY)) out.push(c);
    }
    return out;
  }
}
