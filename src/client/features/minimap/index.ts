/**
 * The minimap, down in the bottom-right corner, as GTA has it: the place round you as a scale model,
 * seen at a slant from behind and above, cut off a little over head height so there's no ceiling in the
 * way, turning as you turn so what's ahead of you is up. It's drawn straight onto the screen every
 * frame (no lag), into the panel's window. Icons (blips) mark what's there: the coffee machine, the
 * elevator, the boards, the jukebox…, the workers by what they're doing and the people on the floor;
 * whoever's waiting on you, and the people, stay on its edge when they're off it, pointing the
 * way. It pulls back while you run, and further while you drive. Under it, bars for your coffee buzz
 * and how much you've had at the bar. J (or a click on it) opens the whole floor big, north up, where a
 * click on someone walks you over to them, and a click on the floor walks you there.
 */
import './minimap.css';
import * as THREE from 'three';
import { ASHTRAY, BALCONY, BOOKSHELF, CABINET, ELEVATOR, ELEVATOR_FRONT, EXIT_DOOR, FLOOR, GOLF_TEE, GONG, JUKEBOX, STATIONS, TV, WALL_T, WHITEBOARD } from '../../../shared/layout';
import { BOOZE_LIMIT } from '../../../shared/rooftop';
import type { Bounds } from '../../../shared/nav';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { BUZZ_SECONDS } from '../coffee/caffeine';
import { $, h, openModal } from '../../ui/dom';

/** Where the model's cut off indoors, over your feet: under the ceiling and the lamps, over the furniture. */
const CUT = 2.3;
/** How far under your feet it still draws: your floor, not the street or the floor below. */
const BELOW = 0.6;
/** How far back the camera sits (meters), standing, running and driving, and how steeply it looks down. */
const DIST = { stand: 15, run: 22, drive: 46 };
const TILT = THREE.MathUtils.degToRad(56);
/** How far ahead of you the camera looks, so there's more of what's in front than behind. */
const AHEAD = 0.18;
/** A worker's dot, by what it's doing. */
const WORKER: Record<string, string> = { working: '#06d6a0', needs_input: '#ffd166', starting: '#8ecae6', offline: '#8d99ae', exited: '#8d99ae' };
const IDLE = '#ffffff';
const BACKDROP = new THREE.Color('#3d3530');
/** Where the office's places are, for their icons. */
const PLACES: { icon: string; x: number; z: number }[] = [
  { icon: '☕', x: -15.4, z: 10.9 },
  { icon: '🛗', x: ELEVATOR.x, z: ELEVATOR_FRONT },
  { icon: '🚪', x: FLOOR.minX + 0.4, z: EXIT_DOOR.u },
  { icon: '📚', x: BOOKSHELF.x, z: BOOKSHELF.z - 0.4 },
  { icon: '🎵', x: JUKEBOX.x - 0.5, z: JUKEBOX.z },
  { icon: '🕹️', x: CABINET.x - 0.5, z: CABINET.z },
  { icon: '🔔', x: GONG.x, z: GONG.z + 0.3 },
  { icon: '📺', x: TV.x - 0.4, z: TV.z },
  { icon: '📝', x: WHITEBOARD.x, z: WHITEBOARD.z },
  { icon: '⛳', x: GOLF_TEE.x, z: GOLF_TEE.z },
  { icon: '🚬', x: ASHTRAY.x, z: ASHTRAY.z },
  ...STATIONS.map((s) => ({ icon: s.station === 'issues' ? '📌' : s.station === 'pulls' ? '🔀' : '🗂️', x: s.x, z: s.z })),
];

interface Blip {
  at: THREE.Vector3;
  /** A dot in this colour, or an icon. */
  color?: string;
  icon?: string;
  /** Stays on the edge when it's off the map, pointing the way. */
  edge?: boolean;
  /** Waiting on you: it pulses. */
  pulse?: boolean;
  /** Where clicking it (on the big map) takes you. */
  go?: () => void;
}

/** The whole floor from straight above, for the big map: drawn into pixels a 2D canvas can show. */
class TopView {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 40);
  private target: THREE.WebGLRenderTarget;
  private buffer: Uint8Array;
  private image: ImageData;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.target = new THREE.WebGLRenderTarget(w, h);
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.buffer = new Uint8Array(w * h * 4);
    this.image = new ImageData(w, h);
  }

  /** Frames all of `b` from straight above, north up. */
  frame(b: Bounds, y: number) {
    const c = this.camera;
    Object.assign(c, { left: -(b.maxX - b.minX) / 2, right: (b.maxX - b.minX) / 2, top: (b.maxZ - b.minZ) / 2, bottom: -(b.maxZ - b.minZ) / 2 });
    c.updateProjectionMatrix();
    c.position.set((b.minX + b.maxX) / 2, y + 20, (b.minZ + b.maxZ) / 2);
    c.up.set(0, 0, -1);
    c.lookAt(c.position.x, y, c.position.z);
    c.updateMatrixWorld();
  }

  /** Draws it with `render` and puts it on `g`. */
  draw(render: (cam: THREE.Camera) => void, renderer: THREE.WebGLRenderer, g: CanvasRenderingContext2D) {
    renderer.setRenderTarget(this.target);
    render(this.camera);
    renderer.readRenderTargetPixels(this.target, 0, 0, this.w, this.h, this.buffer);
    renderer.setRenderTarget(null);
    // WebGL's rows run bottom up.
    const row = this.w * 4;
    for (let y = 0; y < this.h; y++) this.image.data.set(this.buffer.subarray((this.h - 1 - y) * row, (this.h - y) * row), y * row);
    g.putImageData(this.image, 0, 0);
  }

  dispose() {
    this.target.dispose();
  }
}

export function installMinimap(ctx: Ctx, parts: Pick<Parts, 'worlds' | 'views' | 'peers' | 'walking' | 'actions' | 'coffee' | 'bar' | 'place'>) {
  const panel = $('minimap');
  /** The window the model's drawn into (on the game's own canvas, behind it), and the icons over it. */
  const view = h('div.minimap-view');
  const blipCanvas = h('canvas.minimap-blips') as HTMLCanvasElement;
  const coffee = h('span.fill');
  const booze = h('span.fill');
  const bars = h('div.minimap-bars', {}, h('div.minimap-bar.coffee', { title: '☕' }, coffee), h('div.minimap-bar.booze', { title: '🍺' }, booze));
  view.append(blipCanvas);
  panel.append(view, bars);
  const camera = new THREE.PerspectiveCamera(38, 1.5, 0.5, 140);
  const clip = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];
  let dist: number = DIST.stand;
  let big: { canvas: HTMLCanvasElement; view: TopView; bounds: Bounds; close: () => void } | null = null;
  let bigAt = 0;
  const last = new THREE.Vector3();
  let speed = 0;
  const v = new THREE.Vector3();
  const at = new THREE.Vector3();
  const size = new THREE.Vector2();
  const forward = new THREE.Vector3();
  /** The floor you're on: where your feet last were on the ground, so a jump doesn't lift the map off it. */
  let floorY = 0;

  /** What the big map covers: the floor, and on the office's, the balcony out front. */
  function floorBounds(): Bounds {
    const b = { ...ctx.world().nav.bounds };
    if (parts.worlds.inOffice()) b.maxZ = Math.max(b.maxZ, BALCONY.maxZ);
    return b;
  }

  /** Whether there's a ceiling over you: indoors, or anywhere under the office's footprint (the garage). */
  function underRoof(): boolean {
    if (parts.place.indoors()) return true;
    const p = ctx.player.pos;
    return parts.worlds.inOffice() && p.x > FLOOR.minX - WALL_T && p.x < FLOOR.maxX + WALL_T && p.z > FLOOR.minZ - WALL_T && p.z < FLOOR.maxZ + WALL_T;
  }

  /** The way you're looking, as an angle round from +z. */
  function heading(): number {
    const p = ctx.player;
    return p.view === 'first' ? p.camYaw + Math.PI : p.facing;
  }

  /**
   * Draws the scene through `cam` as a model: indoors cut off over head height (outdoors the trees and
   * buildings stay whole), without name tags, bubbles or you.
   */
  function renderModel(cam: THREE.Camera) {
    const { renderer, scene, me } = ctx;
    const y = floorY;
    clip[0].constant = y + CUT;
    clip[1].constant = -(y - BELOW);
    const hidden: THREE.Object3D[] = [];
    scene.traverseVisible((o) => {
      if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints) hidden.push(o);
    });
    if (me.root.visible) hidden.push(me.root);
    for (const o of hidden) o.visible = false;
    const background = scene.background;
    const shadows = renderer.shadowMap.autoUpdate;
    scene.background = BACKDROP;
    // The sun's shadows are worked out already this frame.
    renderer.shadowMap.autoUpdate = false;
    // Under a roof (indoors, or down in the garage under the office) the ceiling's cut off, and the floor
    // over it with it; outside there's no ceiling, just what's under your feet.
    renderer.clippingPlanes = underRoof() ? clip : [clip[1]];
    renderer.render(scene, cam);
    renderer.clippingPlanes = [];
    renderer.shadowMap.autoUpdate = shadows;
    scene.background = background;
    for (const o of hidden) o.visible = true;
  }

  /** What there is to mark, where it is now. */
  function blips(): Blip[] {
    const out: Blip[] = [];
    const y = ctx.player.pos.y;
    if (parts.worlds.inOffice() && !ctx.upTop()) for (const p of PLACES) out.push({ at: new THREE.Vector3(p.x, y, p.z), icon: p.icon });
    for (const [id, vw] of parts.views.workerViews) {
      const w = store.workers.get(id);
      if (!w) continue;
      const desk = ctx.plan().byId.get(w.deskId);
      const at = vw.model.root.getWorldPosition(new THREE.Vector3());
      const go = desk ? () => parts.actions.standAt(desk) : undefined;
      if (w.status === 'needs_input') out.push({ at, icon: '🙋', edge: true, pulse: true, go });
      else out.push({ at, color: WORKER[w.status] ?? IDLE, go });
    }
    for (const [id, r] of parts.peers.remotes) {
      if (!r.person.root.visible) continue;
      out.push({ at: r.person.root.position.clone(), color: store.peers.get(id)?.color ?? '#ef476f', edge: true, go: () => parts.walking.walkTo(id) });
    }
    return out;
  }

  /** Where `p` is on a `w` × `hgt` map, or on its edge (along the line from the middle) if it's off it; and whether it is. */
  function place(p: THREE.Vector3, w: number, hgt: number, pad: number): { x: number; y: number; off: boolean } {
    // Behind the camera, from where it is in the camera's own space: a point past the far plane
    // projects with z over 1 too (north's N is far off), and isn't behind.
    // (`p` may be the scratch vector itself: what's worked out goes in another.)
    const q = at.copy(p);
    const behind = v.copy(q).applyMatrix4(camera.matrixWorldInverse).z > 0;
    v.copy(q).project(camera);
    let x = ((v.x + 1) / 2) * w;
    let y = ((1 - v.y) / 2) * hgt;
    const off = behind || x < pad || y < pad || x > w - pad || y > hgt - pad;
    if (off) {
      let dx = x - w / 2;
      let dy = y - hgt / 2;
      if (behind) [dx, dy] = [-dx, -dy];
      const k = Math.min((w / 2 - pad) / Math.abs(dx || 1e-6), (hgt / 2 - pad) / Math.abs(dy || 1e-6));
      x = w / 2 + dx * k;
      y = hgt / 2 + dy * k;
    }
    return { x, y, off };
  }

  /** The icons over the model: each where it is, or on the edge pointing the way for one that keeps to it; north's N; and you. */
  function drawBlips(g: CanvasRenderingContext2D, w: number, hgt: number, beat: number) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const b of blips()) {
      const { x, y, off } = place(v.copy(b.at).setY(b.at.y + 0.3), w, hgt, 11);
      if (off && !b.edge) continue;
      if (b.pulse) {
        g.beginPath();
        g.arc(x, y, 9 + 6 * beat, 0, Math.PI * 2);
        g.lineWidth = 2.5;
        g.strokeStyle = `rgba(255, 209, 102, ${1 - beat})`;
        g.stroke();
      }
      g.beginPath();
      if (b.icon) {
        g.arc(x, y, 9, 0, Math.PI * 2);
        g.fillStyle = 'rgba(29, 29, 29, 0.72)';
        g.fill();
        g.font = '12px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        g.fillText(b.icon, x, y + 1);
      } else {
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fillStyle = b.color!;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = '#1d1d1d';
        g.stroke();
      }
    }
    // North, always on the edge.
    const p = ctx.player.pos;
    const n = place(v.set(p.x, p.y, p.z - 400), w, hgt, 10);
    g.beginPath();
    g.arc(n.x, n.y, 8, 0, Math.PI * 2);
    g.fillStyle = '#1d1d1d';
    g.fill();
    g.font = '900 11px system-ui, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText('N', n.x, n.y + 0.5);
    // You: a white arrow, the way you're facing, which is up (the map turns with you).
    const me = place(v.copy(p), w, hgt, 0);
    g.save();
    g.translate(me.x, me.y);
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(8, 8);
    g.lineTo(0, 4);
    g.lineTo(-8, 8);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = '#1d1d1d';
    g.stroke();
    g.restore();
  }

  /** The icons on the big map (north up, `k` pixels a meter), and you as an arrow the way you're facing. */
  function drawBigBlips(g: CanvasRenderingContext2D, b: Bounds, k: number, beat: number) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const bl of blips()) {
      const x = (bl.at.x - b.minX) * k;
      const y = (bl.at.z - b.minZ) * k;
      if (bl.pulse) {
        g.beginPath();
        g.arc(x, y, 12 + 8 * beat, 0, Math.PI * 2);
        g.lineWidth = 3;
        g.strokeStyle = `rgba(255, 209, 102, ${1 - beat})`;
        g.stroke();
      }
      g.beginPath();
      if (bl.icon) {
        g.arc(x, y, 12, 0, Math.PI * 2);
        g.fillStyle = 'rgba(29, 29, 29, 0.72)';
        g.fill();
        g.font = '15px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        g.fillText(bl.icon, x, y + 1);
      } else {
        g.arc(x, y, 7, 0, Math.PI * 2);
        g.fillStyle = bl.color!;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = '#1d1d1d';
        g.stroke();
      }
    }
    const p = ctx.player.pos;
    g.save();
    g.translate((p.x - b.minX) * k, (p.z - b.minZ) * k);
    // Forward is (sin yaw, cos yaw) in x and z, which is down the map at yaw 0; the arrow's drawn pointing up.
    g.rotate(Math.PI - heading());
    g.beginPath();
    g.moveTo(0, -14);
    g.lineTo(10, 10);
    g.lineTo(0, 5);
    g.lineTo(-10, 10);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = '#1d1d1d';
    g.stroke();
    g.restore();
  }

  /** The whole floor big in the middle of the screen, north up: click someone to walk over to them, or the floor to walk there. */
  function openBig() {
    if (big) return;
    const bounds = floorBounds();
    const aspect = (bounds.maxZ - bounds.minZ) / (bounds.maxX - bounds.minX);
    const width = Math.round(Math.min(window.innerWidth - 80, 1000, (window.innerHeight - 190) / aspect));
    const tv = new TopView(width, Math.round(width * aspect));
    const c = h('canvas.minimap-big-canvas', { width: tv.w, height: tv.h }) as HTMLCanvasElement;
    const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
    const el = h(
      'div.modal.minimap-big',
      { role: 'dialog', 'aria-label': 'Floor map' },
      h('header', {}, h('h2', {}, '🗺️ Floor map'), close),
      c,
      h('p.minimap-tip', {}, 'Click someone to walk over to them, or the floor to walk there · Esc closes it'),
    );
    const modal = openModal(el, {
      onClose: () => {
        tv.dispose();
        big = null;
      },
    });
    close.addEventListener('click', () => modal.close());
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect();
      const k = (bounds.maxX - bounds.minX) / r.width;
      const x = bounds.minX + (e.clientX - r.left) * k;
      const z = bounds.minZ + (e.clientY - r.top) * k;
      // Someone near where you clicked, the nearest first; else the floor there, if you can stand on it.
      const near = blips()
        .filter((b) => b.go)
        .sort((a, b) => Math.hypot(a.at.x - x, a.at.z - z) - Math.hypot(b.at.x - x, b.at.z - z))[0];
      if (near && Math.hypot(near.at.x - x, near.at.z - z) < 1.2) {
        modal.close();
        near.go!();
      } else if (ctx.world().nav.walkable(x, z)) {
        modal.close();
        parts.walking.walkThen({ x, z }, 'there', () => {});
      }
    });
    big = { canvas: c, view: tv, bounds, close: () => modal.close() };
  }

  panel.addEventListener('click', openBig);
  // J opens it (while a window's open the office's keys are off: ✕ or Esc closes it).
  ctx.keys.bind({ code: 'KeyJ', run: () => openBig() });

  // After the frame's drawn (see drawScene in core/loop.ts): the model goes into the panel's window.
  ctx.ticks.add('render', ({ now, dt }) => {
    const { renderer, player } = ctx;
    const shown = !panel.classList.contains('hud-off') && !document.body.classList.contains('telescope-active');
    panel.classList.toggle('away', !shown);
    // How fast you're going, for how far back it pulls.
    if (player.grounded) floorY = player.pos.y;
    if (dt > 0) speed += (last.distanceTo(player.pos) / dt - speed) * Math.min(1, dt * 4);
    last.copy(player.pos);
    const want = ctx.activities.running('driver') ? DIST.drive : speed > 5.5 ? DIST.run : DIST.stand;
    dist += (want - dist) * Math.min(1, dt * 1.5);
    const secs = now / 1000;
    const buzz = parts.coffee.caffeine.left(secs) / BUZZ_SECONDS;
    const drunk = parts.bar.booze.amount(secs) / BOOZE_LIMIT;
    coffee.style.width = `${Math.min(1, buzz) * 100}%`;
    booze.style.width = `${Math.min(1, drunk) * 100}%`;
    bars.classList.toggle('hidden', buzz <= 0 && drunk <= 0.01);
    // The big map, ten times a second, whether the corner one's showing or not.
    if (big && now - bigAt > 100) {
      bigAt = now;
      big.view.frame(big.bounds, floorY);
      const bg = big.canvas.getContext('2d')!;
      big.view.draw(renderModel, renderer, bg);
      drawBigBlips(bg, big.bounds, big.view.w / (big.bounds.maxX - big.bounds.minX), (now / 900) % 1);
    }
    if (!shown) return;

    // The camera: behind you and up, looking down at a slant just past you, turned the way you face.
    const r = view.getBoundingClientRect();
    const c = renderer.domElement.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const yaw = heading();
    forward.set(Math.sin(yaw), 0, Math.cos(yaw));
    const p = player.pos;
    const look = new THREE.Vector3()
      .copy(p)
      .setY(floorY)
      .addScaledVector(forward, dist * AHEAD);
    camera.position
      .copy(look)
      .addScaledVector(forward, -dist * Math.cos(TILT))
      .setY(floorY + dist * Math.sin(TILT));
    camera.lookAt(look);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.getSize(size);
    const x = r.left - c.left;
    const y = c.bottom - r.bottom;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, r.width, r.height);
    renderer.setViewport(x, y, r.width, r.height);
    renderModel(camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);

    // The icons on top.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width);
    const hgt = Math.round(r.height);
    if (blipCanvas.width !== w * dpr || blipCanvas.height !== hgt * dpr) {
      blipCanvas.width = w * dpr;
      blipCanvas.height = hgt * dpr;
    }
    const g = blipCanvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    drawBlips(g, w, hgt, (now / 900) % 1);
  });
}
