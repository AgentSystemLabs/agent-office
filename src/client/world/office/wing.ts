import * as THREE from 'three';
import { DESKS, DESK_SIZE, FLOOR, SLAB, WALL_HEIGHT, WALL_T, WING, WING_DESKS, deskSeat, wingMinZ, wingRowZ } from '../../../shared/layout';
import type { NightParts } from '../outside';
import { mesh, roundedBox, toon } from '../toon';
import { wingWindows } from '../tower';
import type { Collider, DeskView, Interactable } from '../types';
import type { Fixture } from './fixture';
import { PALETTE, box, type Looks } from './materials';
import { pendant } from './props';
import { buildDesk } from './seats';
import { wallRun, wetPane, windowIn } from './shell';

// The back office through the north wall, built out a row of desks at a time as the floor fills up.

/** The back office, as far as it's built out (see WING). */
export interface WingView {
  /** How many rows it's built out. */
  level: number;
  /** Builds it out `level` rows (or walls it up): walls, floor, ceiling, desks and all. */
  set(level: number): void;
}

/** The sign that says there's room to grow, painted for how far the back office is built out. */
function paintGrowSign(c: HTMLCanvasElement, level: number) {
  const g = c.getContext('2d')!;
  const w = c.width;
  const h = c.height;
  const full = level >= WING.rows;
  g.fillStyle = full ? '#e9ecef' : '#ffd166';
  g.fillRect(0, 0, w, h);
  // Hazard stripes along the top and the bottom, while there's building to do.
  if (!full) {
    g.save();
    for (const y of [0, h - 34]) {
      g.beginPath();
      g.rect(0, y, w, 34);
      g.clip();
      g.fillStyle = '#2b2d42';
      for (let x = -40; x < w + 40; x += 56) {
        g.beginPath();
        g.moveTo(x, y + 34);
        g.lineTo(x + 28, y + 34);
        g.lineTo(x + 56, y);
        g.lineTo(x + 28, y);
        g.fill();
      }
      g.restore();
      g.save();
    }
    g.restore();
  }
  g.fillStyle = '#2b2d42';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 88px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText(full ? '🏢 As big as it gets' : '🚧 Room to grow', w / 2, h * 0.4);
  g.font = '700 46px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText(full ? 'The back office is built all the way out' : level ? 'Press E to go back another row: 2 more desks' : 'Press E to knock through: 2 more desks', w / 2, h * 0.68);
}

/**
 * The back office: the bit of north wall between the gong and the east wall, which comes down when
 * the floor's built out, and behind it the bay, a row deeper each time, with a pair of desks down the
 * middle of each row, a rug under them, a lamp over them and a window in the east wall. The sign that
 * says there's room to grow hangs on whichever wall is at the back.
 */
export function buildWing(group: THREE.Group, colliders: Collider[], interactables: Interactable[], desks: Map<string, DeskView>, looks: Looks, trimMat: THREE.Material, planks: THREE.Material, ceiling: THREE.Material, night: NightParts): WingView {
  const T = WALL_T;
  const midX = (WING.minX + WING.maxX) / 2;

  // The wall where it goes through, standing while there's none.
  const plug = new THREE.Group();
  const plugCols: Collider[] = [];
  wallRun(plug, plugCols, 'x', FLOOR.minZ - T / 2, WING.minX, FLOOR.maxX + T, -1, [], looks, [false, true]);
  group.add(plug);

  // Each row's desks, and its rug and lamp.
  const rows = Array.from({ length: WING.rows }, (_, i) => {
    const row = i + 1;
    const z = wingRowZ(row);
    const extras = new THREE.Group();
    extras.add(mesh(roundedBox(3.4, 0.02, WING.row - 1, 0.5), toon(PALETTE.rugs[(row + 1) % PALETTE.rugs.length]), midX, 0.011, z, false));
    const lamp = pendant(WALL_HEIGHT - 4.05);
    lamp.position.set(midX, 4.05, z);
    extras.add(lamp);
    extras.visible = false;
    group.add(extras);
    const seats = WING_DESKS.filter((d) => d.wing === row).map((def) => {
      const view = buildDesk(def, DESKS.length + WING_DESKS.indexOf(def), trimMat);
      view.group.visible = false;
      group.add(view.group);
      desks.set(def.id, view);
      const hw = DESK_SIZE.width / 2 - 0.05;
      const hd = DESK_SIZE.depth / 2 - 0.02;
      const collider: Collider = { minX: def.x - hw, maxX: def.x + hw, minZ: def.z - hd, maxZ: def.z + hd, top: DESK_SIZE.height };
      const at = deskSeat(def, 1.25);
      const it: Interactable = { kind: 'desk', deskId: def.id, x: at.x, z: at.z, radius: 1.3, off: true };
      interactables.push(it);
      view.group.userData.interact = it;
      return { view, collider, it };
    });
    return { extras, seats };
  });

  // The sign: on the wall at the back, high enough to read from across the room over the desks.
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 420;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const sign = new THREE.Group();
  const board = mesh(roundedBox(2.64, 0.06, 1.12, 0.06), toon(PALETTE.ink), 0, 0, 0, false);
  board.rotation.x = Math.PI / 2;
  sign.add(board);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.56, 1.05), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.z = 0.032;
  sign.add(face);
  group.add(sign);
  const it: Interactable = { kind: 'expand', x: midX, z: FLOOR.minZ + 0.3, radius: 2.2 };
  interactables.push(it);
  sign.userData.interact = it;

  let built: THREE.Object3D[] = [];
  let mine: Collider[] = [];
  const view: WingView = {
    level: -1,
    set(level) {
      level = Math.max(0, Math.min(WING.rows, level));
      if (level === view.level) return;
      view.level = level;
      for (const o of built) {
        o.removeFromParent();
        o.traverse((m) => {
          if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).geometry.dispose();
        });
      }
      built = [];
      for (const c of mine) {
        const i = colliders.indexOf(c);
        if (i >= 0) colliders.splice(i, 1);
      }
      mine = [];
      const take = (o: THREE.Object3D) => {
        group.add(o);
        built.push(o);
        return o;
      };

      plug.visible = level === 0;
      if (level === 0) mine.push(...plugCols);
      rows.forEach(({ extras, seats }, i) => {
        const on = i < level;
        extras.visible = on;
        for (const s of seats) {
          s.view.group.visible = on;
          s.it.off = !on;
          if (on) mine.push(s.collider);
        }
      });

      const back = wingMinZ(level);
      if (level > 0) {
        const shell = new THREE.Group();
        wallRun(shell, mine, 'z', WING.minX - T / 2, back, FLOOR.minZ - T, -1, [], looks, [false, false]);
        const windows = wingWindows(level);
        wallRun(shell, mine, 'z', FLOOR.maxX + T / 2, back, FLOOR.minZ, 1, windows, looks, [false, false]);
        wallRun(shell, mine, 'x', back - T / 2, WING.minX - T, FLOOR.maxX + T, -1, [], looks, [true, true]);
        for (const o of windows) {
          shell.add(windowIn(o));
          shell.add(wetPane(o, night.wetGlass));
        }
        take(shell);

        // The floor: the room's planks carried on through (the same texture, lined up with it), on a
        // slab like the room's; and the ceiling's tiles over it.
        const w = WING.maxX - WING.minX;
        const d = FLOOR.minZ - back;
        const floorGeo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(midX, 0, (back + FLOOR.minZ) / 2);
        const uv = floorGeo.getAttribute('uv');
        const pos = floorGeo.getAttribute('position');
        for (let k = 0; k < pos.count; k++) uv.setXY(k, (pos.getX(k) - FLOOR.minX) / (FLOOR.maxX - FLOOR.minX), (FLOOR.maxZ - pos.getZ(k)) / (FLOOR.maxZ - FLOOR.minZ));
        const floor = take(new THREE.Mesh(floorGeo, planks)) as THREE.Mesh;
        floor.receiveShadow = true;
        // Its edges are the band between the floors outside, its underside concrete.
        const band = toon('#e8a87c');
        const concrete = toon('#d3d6dd');
        const slab = new THREE.Mesh(box(w + 2 * T, SLAB - 0.01, d), [band, band, concrete, concrete, band, band]);
        slab.position.set(midX, -SLAB / 2 - 0.005, (back - T + FLOOR.minZ - T) / 2);
        slab.receiveShadow = true;
        take(slab);
        const ceilGeo = new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2).translate(midX, WALL_HEIGHT, (back + FLOOR.minZ) / 2);
        const cuv = ceilGeo.getAttribute('uv');
        const cpos = ceilGeo.getAttribute('position');
        for (let k = 0; k < cpos.count; k++) cuv.setXY(k, cpos.getX(k), cpos.getZ(k));
        take(new THREE.Mesh(ceilGeo, ceiling)).receiveShadow = false;
        // Its roof, flush with the tops of its walls, for when there's no floor over it.
        take(mesh(box(w + 2 * T, 0.02, d + T), toon('#fffaf3'), midX, WALL_HEIGHT + 0.03, (back - T + FLOOR.minZ) / 2, false));
        mine.push({ minX: WING.minX - T, maxX: FLOOR.maxX + T, minZ: back - T, maxZ: FLOOR.minZ - T, bottom: -SLAB, top: 0 });
        mine.push({ minX: WING.minX, maxX: FLOOR.maxX, minZ: back, maxZ: FLOOR.minZ, bottom: WALL_HEIGHT, top: WALL_HEIGHT + SLAB });
      }
      colliders.push(...mine);

      // The sign on whichever wall is at the back: low on the old wall, up over the desks and their
      // lamps once they're there, where it reads from across the room.
      sign.position.set(midX, level ? 5.3 : 2.4, back + 0.05);
      it.z = back + 0.3;
      paintGrowSign(canvas, level);
      tex.needsUpdate = true;
    },
  };
  void document.fonts?.ready.then(() => {
    paintGrowSign(canvas, Math.max(0, view.level));
    tex.needsUpdate = true;
  });
  view.set(0);
  return view;
}

declare module '../types' {
  interface OfficeHandles {
    /** The back office through the north wall, as far as this floor's built out (see WING). */
    wing: WingView;
    /** Builds the back office out `level` rows, or walls it up: the plants in the way go too. */
    setWing(level: number): void;
  }
}

/** The back office through the north wall past the gong, walled up until the floor's built out. */
export const wing: Fixture<'wing' | 'setWing'> = (site) => {
  const built = buildWing(site.group, site.colliders, site.interactables, site.desks, site.looks, site.looks.trim, site.planks, site.get('stack').ceiling, site.get('night'));
  site.wall('north', (WING.minX + FLOOR.maxX) / 2, WALL_HEIGHT / 2, FLOOR.maxX - WING.minX, WALL_HEIGHT);
  const setWing = (level: number) => {
    built.set(level);
    for (const p of site.inTheWay) {
      const out = built.level === 0;
      if (p.group.visible === out) continue;
      p.group.visible = out;
      const i = site.colliders.indexOf(p.collider);
      if (out && i < 0) site.colliders.push(p.collider);
      else if (!out && i >= 0) site.colliders.splice(i, 1);
    }
  };
  return { handle: { wing: built, setWing } };
};
