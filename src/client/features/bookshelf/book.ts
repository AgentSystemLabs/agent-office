import * as THREE from 'three';
import { mesh, toon, toonUnique } from '../../world/toon';

// An open book, held by someone reading off the bookshelf: two page blocks in a shallow V on a
// hardcover, and every few seconds a page lifts off the right-hand side, curls over and lands on the
// left. Built with its spine up the y axis and its pages facing +z, toward whoever reads it.

/** One page, in meters: the book open is a little over twice as wide. */
const PAGE_W = 0.2;
const PAGE_H = 0.27;
/** How far each half tips toward the reader off flat, so the pages make a shallow V. */
const TIP = 0.28;
/** How long a page takes to turn, and the wait (at random, between these) before the next. */
const TURN_TIME = 0.75;
const GAP: [number, number] = [1.6, 3.6];
/** Strips across the turning page, for its curl. */
const STRIPS = 8;

const COVERS = ['#b5413b', '#2a6f97', '#2d6a4f', '#6a4c93', '#bc6c25', '#264653'];

let pages: { print: THREE.MeshToonMaterial; leaf: THREE.MeshToonMaterial } | null = null;

/** Printed pages: a heading, then rows of words in grey lines, drawn once and shared by every book. */
function pageMaterials(): { print: THREE.MeshToonMaterial; leaf: THREE.MeshToonMaterial } {
  if (pages) return pages;
  const W = 128;
  const H = 172;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, W, H);
  // Seeded, so every page (and every browser) prints the same.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#5c5f7a';
  g.fillRect(14, 14, 62, 7);
  g.fillStyle = '#a3a6b8';
  for (let y = 32; y < H - 12; y += 9) {
    // A short last line now and then, as at the end of a paragraph.
    const end = rand() < 0.18 ? 30 + rand() * 50 : W - 14;
    for (let x = 14; x < end; ) {
      const w = 6 + rand() * 16;
      g.fillRect(x, y, Math.min(w, end - x), 3);
      x += w + 4;
    }
    if (end < W - 14) y += 5;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const print = toonUnique('#ffffff');
  print.map = tex;
  // The page that turns shows print on its back too.
  const leaf = toonUnique('#ffffff');
  leaf.map = tex;
  leaf.side = THREE.DoubleSide;
  pages = { print, leaf };
  return pages;
}

export class OpenBook {
  readonly group = new THREE.Group();
  private leaf: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  /** Seconds into the page turning now, or -1 between turns. */
  private turnT = -1;
  /** Seconds until the next page turns by itself. */
  private wait: number;
  /** A turn asked for (see turn) while one was under way. */
  private queued = false;

  constructor(cover = COVERS[Math.floor(Math.random() * COVERS.length)]) {
    const coverMat = toon(cover);
    const { print, leaf } = pageMaterials();
    const edge = toon('#f3ead8');
    for (const side of [-1, 1]) {
      // Each half turns on the spine, its outer edge coming toward the reader.
      const half = new THREE.Group();
      half.rotation.y = -side * TIP;
      half.add(mesh(new THREE.BoxGeometry(PAGE_W + 0.016, PAGE_H + 0.022, 0.01), coverMat, side * (PAGE_W / 2 + 0.006), 0, -0.017));
      // Box faces go +x, -x, +y, -y, +z, -z: the print is on the front.
      const block = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W, PAGE_H, 0.024), [edge, edge, edge, edge, print, edge]);
      block.position.x = side * (PAGE_W / 2 + 0.002);
      block.castShadow = true;
      half.add(block);
      this.group.add(half);
    }
    this.group.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, PAGE_H + 0.022, 8), coverMat, 0, 0, -0.02));

    // The page that turns: a strip of quads out from the spine, bent a little more each frame.
    const n = STRIPS + 1;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    const uv = new Float32Array(n * 2 * 2);
    const index: number[] = [];
    for (let i = 0; i < n; i++) {
      uv.set([i / STRIPS, 1, i / STRIPS, 0], i * 4);
      if (i < STRIPS) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geo.setAttribute('position', this.pos);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    this.leaf = new THREE.Mesh(geo, leaf);
    this.leaf.position.z = 0.014;
    this.leaf.visible = false;
    this.leaf.castShadow = false;
    this.group.add(this.leaf);
    this.wait = 0.4 + Math.random() * 1.2;
  }

  /** Turns a page now (or straight after the one turning). */
  turn() {
    if (this.turnT >= 0) this.queued = true;
    else this.start();
  }

  private start() {
    this.turnT = 0;
    this.leaf.visible = true;
  }

  update(dt: number) {
    if (this.turnT < 0) {
      this.wait -= dt;
      if (this.wait <= 0) this.start();
      return;
    }
    this.turnT += dt;
    const p = Math.min(1, this.turnT / TURN_TIME);
    if (p >= 1) {
      this.turnT = -1;
      this.leaf.visible = false;
      this.wait = this.queued ? 0.05 : GAP[0] + Math.random() * (GAP[1] - GAP[0]);
      this.queued = false;
      return;
    }
    this.bend(p);
  }

  /**
   * Lays the turning page out `p` of the way over: its root swings from lying on the right-hand
   * page, up toward the reader and down onto the left one, and its free edge trails behind, curled.
   */
  private bend(p: number) {
    const e = p * p * (3 - 2 * p);
    const root = -TIP - e * (Math.PI - 2 * TIP);
    const curl = Math.sin(p * Math.PI) * 0.9;
    const step = PAGE_W / STRIPS;
    let x = 0;
    let z = 0;
    const a = this.pos.array as Float32Array;
    for (let i = 0; i <= STRIPS; i++) {
      a.set([x, PAGE_H / 2, z, x, -PAGE_H / 2, z], i * 6);
      const ang = root + curl * Math.pow((i + 0.5) / STRIPS, 1.6);
      x += Math.cos(ang) * step;
      z -= Math.sin(ang) * step;
    }
    this.pos.needsUpdate = true;
    this.leaf.geometry.computeVertexNormals();
    this.leaf.geometry.computeBoundingSphere();
  }

  /** Its materials are shared, so only its shapes go. */
  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
