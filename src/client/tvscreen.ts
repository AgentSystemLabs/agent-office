// The big TV's picture: an ordinary `<iframe>` or `<video>` laid over the canvas and re-projected
// onto the TV's rectangle every frame, because WebGL can't draw a cross-origin player (see
// docs/tv-streaming.md). What's on it is shared state like the jukebox's; this keeps whatever is
// playing here in step with it, and takes the picture away whenever the TV can't be seen.

import * as THREE from 'three';
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

// ---- YouTube's IFrame API, which is how play, pause and seek reach a YouTube link ----------------

interface YoutubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
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
  /** What the element was loaded with, and where from (for an embed, which can't be asked). */
  private link = '';
  private from = 0;
  private started = 0;
  private ran = false;
  private checked = 0;
  /** When the browser last refused to start it with sound (see blocked). */
  private refusedAt = 0;
  /** Whether your own speakers are turned down, for whatever player can turn them down. */
  muted = false;
  /** Told when `muted` changes here rather than in the window (the autoplay fallback does it). */
  onMute: (() => void) | null = null;
  private readonly corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly scratch = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
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
      if (this.kind === 'youtube' && this.yt) return this.yt.getDuration() || 0;
    } catch {
      // not far enough into the video to know yet
    }
    return 0;
  }

  /** Turns your own speakers down or up. False when this player won't take the order (see the window). */
  toggleMute(): boolean {
    const media = this.kind === 'media' && this.el instanceof HTMLVideoElement ? this.el : null;
    if (!media && !(this.kind === 'youtube' && this.yt)) return false;
    this.muted = !this.muted;
    if (media) media.muted = this.muted;
    else (this.muted ? this.yt!.mute() : this.yt!.unMute());
    this.onMute?.();
    return true;
  }

  /**
   * Every frame: keep the picture where the floor says it should be, then put it on the TV's
   * rectangle — or take it away, if the TV isn't somewhere you can see it (call after rendering).
   */
  update(camera: THREE.PerspectiveCamera, show: boolean, colliders: readonly Collider[]) {
    this.align(store.officeNow());
    if (!this.layer) return;
    const here = show && this.state.on && !!this.el && this.sited(camera, colliders);
    this.layer.style.display = here ? '' : 'none';
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
    this.el?.remove();
    this.el = null;
    this.kind = null;
    this.link = '';
    this.from = 0;
    this.started = 0;
    this.ran = false;
  }

  /** A direct media file: the only player that can be asked anything at all, and asked at once. */
  private loadMedia(url: string, start: number, playing: boolean) {
    const video = h('video', { src: url, autoplay: '', playsinline: '', preload: 'auto' }) as HTMLVideoElement;
    video.muted = this.muted;
    this.el = video;
    this.frame.append(video);
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
          if (this.muted) player.mute();
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
      this.onMute?.();
      toast('The browser held the TV’s sound back — 🔊 in the TV window turns it on', 'warn');
    }
    player.mute();
    player.playVideo();
  }

  /** Started (or started again) with sound the browser may not allow yet: quietly is better than never. */
  private roll(video: HTMLVideoElement) {
    void video.play().catch(() => {
      if (this.muted) return;
      this.muted = true;
      video.muted = true;
      this.onMute?.();
      toast('The browser held the TV’s sound back — 🔊 in the TV window turns it on', 'warn');
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
    if (this.kind === 'youtube' && this.yt) {
      const end = this.yt.getDuration();
      const away = end > 0 && want >= end - 0.2;
      const state = this.yt.getPlayerState();
      if (Math.abs(want - this.yt.getCurrentTime()) > CATCH_UP && !away) this.yt.seekTo(want, true);
      // Not straight after a refusal: that only makes it refuse again (see blocked).
      const stubborn = Date.now() - this.refusedAt < 4000;
      if (s.playing && !away && !stubborn && state !== 1 && state !== 3) this.yt.playVideo();
      else if (!s.playing && (state === 1 || state === 3)) this.yt.pauseVideo();
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
    this.centre.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const corner = this.corners[i].set(local[i][0], local[i][1], 0).applyMatrix4(this.screen.matrixWorld);
      this.centre.add(corner);
      // Behind your eye: it would project inside out, so it isn't on screen at all.
      this.scratch.copy(corner).applyMatrix4(camera.matrixWorldInverse);
      if (this.scratch.z > -camera.near) return false;
      corner.project(camera);
      this.pixels[i] = [(corner.x * 0.5 + 0.5) * w, (-corner.y * 0.5 + 0.5) * hgt];
    }
    this.centre.multiplyScalar(0.25);
    this.eye.copy(camera.position);
    for (const c of colliders) {
      // Glass you can see a TV through; a fence is only there to stop you walking into something.
      if (c.glass || c.fence) continue;
      if (blocks(this.eye, this.centre, c)) return false;
    }
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
    return true;
  }
}
