import * as THREE from 'three';
import { HATCH, HULL, wallOut, type WallOpening, type WallSide } from '../../../shared/maps';
import type { Bounds, Pt } from '../../../shared/nav';
import { canvasTexture, tilingCanvasTexture } from '../texture';
import { mesh, textPlane } from '../toon';
import { Batch, PANEL, PLATE, box, lit, placed, tileBox, type Kit } from './kit';
import { ceilingPanels, deckPlates, hullPanels, toonMap } from './textures';

// The station's shell: the deck, the hull's four walls with the windows, the way in and the airlock's
// door cut through them, the ceiling, the hatch workers come and go by with the docking tunnel
// beyond it, and what shows of the station from its windows: its solar wings.

const SIDES: readonly WallSide[] = ['west', 'east', 'north', 'south'];

/** A wall as somewhere to build: `at(u, d)` is the point `u` along it and `d` out through it from its inside face. */
export interface WallFrame {
  side: WallSide;
  out: Pt;
  alongX: boolean;
  /** Turned so +z is the way out through it, and +x runs along it. */
  rotY: number;
  at(u: number, d: number): Pt;
  /** A box `su` along the wall, `h` high and `sd` through it. */
  box(su: number, h: number, sd: number): THREE.BoxGeometry;
}

export function wallFrame(b: Bounds, side: WallSide): WallFrame {
  const out = wallOut(side);
  const alongX = side === 'north' || side === 'south';
  const face = side === 'west' ? b.minX : side === 'east' ? b.maxX : side === 'north' ? b.minZ : b.maxZ;
  return {
    side,
    out,
    alongX,
    rotY: Math.atan2(out[0], out[1]),
    at: (u, d) => (alongX ? [u, face + out[1] * d] : [face + out[0] * d, u]),
    box: (su, h, sd) => (alongX ? box(su, h, sd) : box(sd, h, su)),
  };
}

/** Deep blue cells in a gold frame: a solar panel. */
function solarCells(g: CanvasRenderingContext2D) {
  g.fillStyle = '#c9a23a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 4; j++) {
      g.fillStyle = (i + j) % 2 ? '#16306b' : '#1b3a80';
      g.fillRect(6 + i * 41.3, 6 + j * 61.5, 38.5, 58.5);
    }
  }
  g.strokeStyle = 'rgba(150, 190, 255, 0.35)';
  g.lineWidth = 1;
  for (let y = 12; y < 256; y += 10) {
    g.beginPath();
    g.moveTo(6, y);
    g.lineTo(250, y);
    g.stroke();
  }
}

/** Yellow and black stripes: mind the door. */
function hazard(g: CanvasRenderingContext2D) {
  g.fillStyle = '#f2c230';
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#1b212b';
  for (let x = -32; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.fill();
  }
}

/**
 * Puts up the shell. Returns where the way in is, which way is out through it, and how to slide its
 * doors (0 shut, 1 open).
 */
export function buildShell(kit: Kit, pal: { hull: string; deck: string }): { doorAt: THREE.Vector3; out: Pt; slide(open: number): void } {
  const { plan, group, still, mats } = kit;
  const b = plan.bounds;
  const H = plan.height;
  const T = HULL;
  const W = b.maxX - b.minX;
  const L = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const openings = plan.openings ?? [];
  const hull = toonMap(tilingCanvasTexture(512, 512, hullPanels(pal.hull)));
  const pieces = new Batch();
  const panes = new Batch();

  // The deck and the ceiling: slabs the size of the hull, so the Sun only gets in by the windows.
  pieces.add(tileBox(W + 2 * T, T, L + 2 * T, PLATE, { x: cx, y: -T / 2, z: cz }), toonMap(tilingCanvasTexture(512, 512, deckPlates(pal.deck))));
  pieces.add(tileBox(W + 2 * T, T, L + 2 * T, PANEL, { x: cx, y: H + T / 2, z: cz }), toonMap(tilingCanvasTexture(256, 256, ceilingPanels('#8d98a8'))));
  kit.colliders.push({ minX: b.minX - 8, maxX: b.maxX + 8, minZ: b.minZ - 8, maxZ: b.maxZ + 8, top: 0 });

  for (const side of SIDES) {
    const f = wallFrame(b, side);
    // The side walls run past the end walls, to close the corners.
    const [lo, hi] = f.alongX ? [b.minX, b.maxX] : [b.minZ - T, b.maxZ + T];
    const piece = (u0: number, u1: number, y0: number, y1: number) => {
      if (u1 - u0 < 0.01 || y1 - y0 < 0.01) return;
      const [x, z] = f.at((u0 + u1) / 2, T / 2);
      const [w, d] = f.alongX ? [u1 - u0, T] : [T, u1 - u0];
      pieces.add(tileBox(w, y1 - y0, d, PANEL, { x, y: (y0 + y1) / 2, z }), hull);
    };
    const cut = openings.filter((o) => o.wall === side).sort((p, q) => p.u - q.u);
    let from = lo;
    for (const o of cut) {
      const a = o.u - o.width / 2;
      const z = o.u + o.width / 2;
      piece(from, a, 0, H);
      piece(a, z, 0, o.y);
      piece(a, z, o.y + o.height, H);
      from = z;
      if (o.kind === 'viewport') viewport(kit, f, o, panes);
    }
    piece(from, hi, 0, H);
    // You stay inside: the windows, the way in and the airlock are the workers' to go through.
    const [x0, z0] = f.at(lo, 0);
    const [x1, z1] = f.at(hi, T);
    kit.colliders.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), top: 99, fence: true });

    // A dark skirting along the foot of it, a line of light on top, broken where there's a door.
    const doors = cut.filter((o) => o.kind !== 'viewport');
    let s = f.alongX ? b.minX : b.minZ;
    const end = f.alongX ? b.maxX : b.maxZ;
    const skirt = (u0: number, u1: number) => {
      if (u1 - u0 < 0.05) return;
      const [x, z] = f.at((u0 + u1) / 2, -0.05);
      still.add(mesh(f.box(u1 - u0, 0.5, 0.1), mats.metalDark, x, 0.25, z, false));
      const [lx, lz] = f.at((u0 + u1) / 2, -0.11);
      still.add(mesh(f.box(u1 - u0, 0.05, 0.03), mats.accent, lx, 0.56, lz, false));
    };
    for (const o of doors) {
      skirt(s, o.u - o.width / 2 - 0.3);
      s = o.u + o.width / 2 + 0.3;
    }
    skirt(s, end);
  }

  // Down each long wall, where it meets the ceiling: a slanted cove, a line of light under it, and a trough of light over the deck.
  for (const sx of [-1, 1]) {
    const cove = mesh(box(0.14, 1.7, L), mats.hullDark, cx + sx * (W / 2 - 0.58), H - 0.58, cz, false);
    cove.rotation.z = (sx * Math.PI) / 4;
    still.add(cove);
    still.add(mesh(box(0.04, 0.07, L), mats.accent, cx + sx * (W / 2 - 0.03), H - 1.22, cz, false));
    still.add(mesh(box(0.55, 0.05, L - 5), mats.lamp, cx + sx * (W / 2 - 3.4), H - 0.03, cz, false));
  }
  group.add(pieces.build());
  group.add(panes.build(false));

  // The way in: a hatch whose two doors slide apart into the wall, and the docking tunnel beyond.
  const way = openings.find((o) => o.kind === 'door')!;
  const f = wallFrame(b, way.wall);
  const [dx, dz] = f.at(way.u, 0);
  const doorAt = new THREE.Vector3(dx, 0, dz);
  const frame = placed(dx, 0, dz, f.rotY);
  const w = HATCH.width;
  const h = HATCH.height;
  // Lapping a little into the opening (see viewport).
  for (const sx of [-1, 1]) frame.add(mesh(box(0.3, h + 0.3, T + 0.3), mats.metalDark, sx * (w / 2 + 0.11), (h + 0.3) / 2, T / 2));
  frame.add(mesh(box(w + 0.6, 0.3, T + 0.3), mats.metalDark, 0, h + 0.11, T / 2));
  const stripes = new THREE.MeshBasicMaterial({ map: canvasTexture(256, 32, hazard, [w / 2, 1]) });
  const band = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, 0.26), stripes);
  band.position.set(0, h + 0.15, -0.16);
  band.rotation.y = Math.PI;
  frame.add(band);
  const sign = textPlane('🚀 Docking port', { bg: '#0f1a26', color: '#cfeeff', border: '#3a5a78', size: 56 });
  sign.scale.multiplyScalar(0.9);
  sign.position.set(0, h + 0.75, -0.06);
  sign.rotation.y = Math.PI;
  frame.add(sign);
  const leaves: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const leaf = new THREE.Group();
    leaf.add(mesh(box(w / 2, h, 0.16), mats.metal, 0, h / 2, 0));
    leaf.add(mesh(box(w / 2 - 0.5, 0.5, 0.2), mats.black, 0, h * 0.62, 0, false));
    leaf.add(mesh(box(0.06, h - 0.3, 0.2), mats.accent, (-sx * w) / 4 + sx * 0.09, h / 2, 0, false));
    leaf.position.set((sx * w) / 4, 0, T / 2);
    frame.add(leaf);
    leaves.push(leaf);
  }
  group.add(frame);
  // The tunnel: somewhere for workers to walk off to, and come in from.
  const tunnel = placed(dx, 0, dz, f.rotY);
  const len = 6;
  tunnel.add(mesh(box(w + 0.8, 0.2, len), mats.metalDark, 0, -0.1, T + len / 2, false));
  tunnel.add(mesh(box(w + 0.8, 0.2, len), mats.hullDark, 0, h + 0.5, T + len / 2));
  for (const sx of [-1, 1]) {
    tunnel.add(mesh(box(0.2, h + 0.6, len), mats.hull, sx * (w / 2 + 0.3), (h + 0.4) / 2, T + len / 2));
    tunnel.add(mesh(box(0.05, 0.08, len - 0.4), mats.lamp, sx * (w / 2 + 0.17), h, T + len / 2, false));
  }
  tunnel.add(mesh(box(w + 0.8, h + 0.6, 0.2), mats.hull, 0, (h + 0.4) / 2, T + len + 0.1));
  const port = mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.16, 28).rotateX(Math.PI / 2), mats.metal, 0, h / 2, T + len - 0.08, false);
  tunnel.add(port);
  tunnel.add(mesh(new THREE.TorusGeometry(1.25, 0.07, 8, 32), mats.accent, 0, h / 2, T + len - 0.18, false));
  still.add(tunnel);

  // Out of the windows: solar wings off both sides of the hull, a light winking at the tip of each.
  const cells = toonMap(canvasTexture(256, 256, solarCells));
  cells.side = THREE.DoubleSide;
  const wingZ = [b.minZ + L * 0.2, b.minZ + L * 0.72];
  for (const [sx, z] of [
    [-1, wingZ[0]],
    [-1, wingZ[1]],
    [1, wingZ[0]],
  ] as const) {
    const wing = placed(sx < 0 ? b.minX - T : b.maxX + T, 3.1, z, sx < 0 ? Math.PI : 0);
    const boom = 21;
    wing.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, boom, 10).rotateZ(Math.PI / 2), mats.metal, boom / 2, 0, 0, false));
    for (let i = 0; i < 5; i++) {
      for (const up of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.5), cells);
        panel.position.set(5.2 + i * 3.25, up * 1.5, 0);
        // Tipped back toward the Sun a little, so they catch it.
        panel.rotation.x = -0.5;
        wing.add(panel);
      }
      wing.add(mesh(box(0.08, 5.6, 0.08), mats.metalDark, 3.6 + i * 3.25, 0, 0, false));
    }
    const tip = lit(sx < 0 ? '#ff4d4d' : '#3dff8a');
    wing.add(mesh(new THREE.SphereGeometry(0.22, 10, 8), tip, boom + 0.2, 0, 0, false));
    const on = new THREE.Color(sx < 0 ? '#ff4d4d' : '#3dff8a');
    kit.pulses.push({ set: (k) => tip.color.copy(on).multiplyScalar(k > 0.8 ? 1 : 0.12), rate: 0.7, phase: sx < 0 ? 0 : 0.5 });
    group.add(wing);
  }

  return {
    doorAt,
    out: f.out,
    slide(open) {
      const e = open * open * (3 - 2 * open);
      leaves.forEach((leaf, i) => (leaf.position.x = (i ? 1 : -1) * (w / 4 + e * (w / 2 - 0.12))));
    },
  };
}

/** A window's frame and its glass, in the hole the shell left for it. */
function viewport(kit: Kit, f: WallFrame, o: WallOpening, panes: Batch) {
  const { still, mats } = kit;
  const T = HULL;
  const deep = T + 0.24;
  const mid = o.y + o.height / 2;
  const [cx, cz] = f.at(o.u, T / 2);
  // Lapping a little way into the opening, so the frame's faces never lie on the wall's cut edges.
  const lap = 0.05;
  for (const sy of [-1, 1]) still.add(mesh(f.box(o.width + 0.36, 0.18, deep), mats.metalDark, cx, mid + sy * (o.height / 2 + 0.09 - lap), cz));
  for (const su of [-1, 1]) {
    const [x, z] = f.at(o.u + su * (o.width / 2 + 0.09 - lap), T / 2);
    still.add(mesh(f.box(0.18, o.height, deep), mats.metalDark, x, mid, z));
  }
  // A wide one is glazed in two or three lights.
  const lights = o.width > 7 ? 3 : o.width > 5.2 ? 2 : 1;
  for (let i = 1; i < lights; i++) {
    const [x, z] = f.at(o.u - o.width / 2 + (i * o.width) / lights, T / 2);
    still.add(mesh(f.box(0.1, o.height, 0.2), mats.metalDark, x, mid, z, false));
  }
  // A sill to lean on, inside.
  const [sx, sz] = f.at(o.u, -0.2);
  still.add(mesh(f.box(o.width + 0.5, 0.08, 0.4), mats.metal, sx, o.y - 0.04, sz, false));
  const glass = new THREE.PlaneGeometry(o.width, o.height);
  glass.rotateY(f.rotY);
  glass.translate(cx, mid, cz);
  panes.add(glass, mats.glass);
}
