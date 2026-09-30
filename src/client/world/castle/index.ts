import * as THREE from 'three';
import type { FloorPalette } from '../../../shared/floors';
import type { MapPlan } from '../../../shared/maps';
import type { PropKind } from '../../../shared/maps/props';
import { NavGrid, type Pt } from '../../../shared/nav';
// The people first: Person (and what it loads) ran before the dungeon's module when the castle was one
// file, so the materials the modules make as they load keep their order (three sorts by it).
import { buildEscort, buildHerald } from './people';
import { buildDungeon, type DungeonView } from '../dungeon';
import type { Interactable } from '../types';
import { canvasTexture } from '../texture';
import { mergeByMaterial } from '../toon';
import type { World } from '../world';
import { buildBoards } from './boards';
import { WALL, materials, type Kit } from './kit';
import { PROPS, arcade, torch } from './props';
import { buildCouncil, buildTables, lectern, placeSetting } from './seats';
import { buildShell } from './shell';
import { ashlar, flagstones, heraldry, paintBanner, shade, toonMap } from './textures';
import { buildDais } from './throne';

/*
 * The castle's style of map (see shared/maps/castle.ts for the castle itself): a long stone hall
 * under a timber roof, pillars and pointed arches down both sides, stained glass high in the walls,
 * a dais at one end with a throne of iron blades on it, long tables with benches for the workers,
 * lecterns for the board agents, a round table for meetings, and fire everywhere. Everything is
 * placed from the map's plan, so another map in this style is just other numbers.
 *
 * It goes up a part at a time, each in a file of its own beside this one: the shell (the floor, the
 * walls, the great doors and the roof), the throne on its dais, the props (one builder for each kind),
 * the seats (the tables, the lecterns and the council's round table), the boards, and the herald and
 * the Kingsguard (people.ts). What they all build with (the Kit, the materials) is in kit.ts.
 */

/** Puts up the hall in `plan` (a castle-style map). */
export function buildCastle(plan: MapPlan): World {
  const c = plan.config!;
  const b = plan.bounds;
  const H = plan.height;
  const pal = { stone: '#9a9186', floor: '#7b746a', carpet: '#8e1b1b', wood: '#6b4526', trim: '#d9ab2e', ...(c.palette ?? {}) };
  const group = new THREE.Group();
  const kit: Kit = {
    group,
    still: new THREE.Group(),
    colliders: [],
    interactables: [],
    flames: [],
    lights: [],
    mats: materials(pal),
    height: H,
    desks: new Map(),
    glass: [],
    banners: [],
    shields: [],
    windows: 1,
    floorAt(x, z) {
      let top = 0;
      for (const cc of kit.colliders) if (cc.top < 50 && !cc.fence && cc.top > top && x > cc.minX && x < cc.maxX && z > cc.minZ && z < cc.maxZ) top = cc.top;
      return top;
    },
  };

  const shell = buildShell(kit, plan, { ...kit.mats, floorColor: pal.floor, stoneColor: pal.stone });
  // The dais before the props, so what stands on it stands on its top (see Kit.floorAt).
  buildDais(kit, plan);
  const props = c.props ?? [];
  for (const p of props) PROPS[p.kind as PropKind](kit, p);
  arcade(
    kit,
    props.filter((p) => p.kind === 'pillar'),
  );
  buildTables(kit, plan);
  const overflow = new Map<string, Interactable>();
  for (const def of plan.desks) kit.desks.set(def.id, placeSetting(kit, def, false).view);
  for (const def of plan.overflow) {
    const { view, it } = placeSetting(kit, def, true);
    kit.desks.set(def.id, view);
    overflow.set(def.id, it);
  }
  for (const def of plan.stations) kit.desks.set(def.id, lectern(kit, def));
  const council = buildCouncil(kit, plan);
  const boardMeshes = buildBoards(kit, plan);
  const herald = buildHerald(kit, plan);
  // The dungeon under the floor, the torches down there, and whoever keeps watch over it.
  const walls = new Map<string, THREE.Material>();
  const cellar = canvasTexture(512, 256, ashlar(shade(pal.stone, -0.16), 11));
  const flags = toonMap(canvasTexture(512, 512, flagstones(shade(pal.floor, -0.2)), [0.25, 0.25]));
  const dungeon: DungeonView | undefined = plan.dungeon
    ? buildDungeon(
        {
          group,
          still: kit.still,
          colliders: kit.colliders,
          mats: kit.mats,
          wall(along, high) {
            const k = `${along.toFixed(1)}x${high.toFixed(1)}`;
            let m = walls.get(k);
            if (!m) {
              const t = cellar.clone();
              t.repeat.set(Math.max(0.25, along / 4), high / 2);
              t.needsUpdate = true;
              walls.set(k, (m = toonMap(t)));
            }
            return m;
          },
          flags: () => flags,
        },
        plan.dungeon,
      )
    : undefined;
  for (const t of plan.dungeon?.torches ?? []) torch(kit, { kind: 'torch', x: t.x, z: t.z, y: plan.dungeon!.floor + 2.3, rotY: t.rotY });
  const escort = buildEscort(kit, plan);
  group.add(mergeByMaterial(kit.still));
  // The hall's fires, which light the dungeon's torches instead while you're down there (see mood).
  const hearths = kit.lights.map((l) => l.light.position.clone());
  let lampsDown = false;

  // Walking about: in through the doors and out again, round what's in the way.
  const nav = new NavGrid(b, plan.obstacles!);
  const { doorAt, out } = shell;
  const inside: Pt = [plan.door.x, plan.door.z];
  const threshold: Pt = [doorAt.x + out[0] * 0.2, doorAt.z + out[1] * 0.2];
  const beyond: Pt = [doorAt.x + out[0] * 3, doorAt.z + out[1] * 3];
  let doorOpen = 0;

  // How the day's light and the fires light the room: see mood.
  const warmSky = new THREE.Color('#ffe2bc');
  const warmGround = new THREE.Color('#4a3322');
  const haze = new THREE.Color('#2a1e16');
  const dank = new THREE.Color('#0c0907');
  const glassDay = new THREE.Color('#ffffff');
  const glassNight = new THREE.Color('#5a4a6a');

  // What setLook and setProjectName were last told, which the great banner shows.
  let name = '';
  let look: FloorPalette = { name: '', wall: pal.stone, trim: '#9b1c1c', floor: pal.floor, floorAlt: pal.floor, seam: pal.floor };
  const repaint = () => {
    for (const bn of kit.banners) {
      paintBanner(bn.tex.image.getContext('2d') as CanvasRenderingContext2D, bn.w, bn.h, heraldry(look), bn.great ? name : undefined);
      bn.tex.needsUpdate = true;
    }
    for (const s of kit.shields) s.color.set(heraldry(look));
  };
  const gongAt = kit.gong?.top;

  return {
    plan,
    group,
    colliders: kit.colliders,
    interactables: kit.interactables,
    pickables: [group],
    desks: kit.desks,
    boardMeshes,
    meetingBoard: council.board,
    meetingSign: council.sign,
    gong: kit.gong,
    nav,
    ways: {
      home: (seat, from) => ({ way: [...(from ? nav.route(from, inside) : nav.wayFrom(seat, inside)), threshold, beyond], chute: false }),
      in: (seat) => [beyond, threshold, ...nav.wayTo(inside, seat)],
    },
    rain: [{ area: b, top: () => Math.min(H - 1, 9) }],
    device: 'tome',
    room: { wall: WALL, enclosed: true, ...(plan.dungeon ? { vault: { ...plan.dungeon.bounds, top: plan.dungeon.ceiling } } : {}) },
    dungeon,
    escort,
    acoustics: {
      gong: gongAt ? { x: gongAt.x, y: gongAt.y - 1.8, z: gongAt.z } : null,
      windows: props.filter((p) => p.kind === 'window').map((p) => ({ x: p.x, y: (p.y ?? 6) + (p.height ?? 5) / 2, z: p.z })),
    },
    herald,
    setBeanbags(outNow) {
      for (const [id, it] of overflow) {
        const show = outNow.has(id);
        kit.desks.get(id)!.group.visible = show;
        it.off = !show;
      }
      return [];
    },
    setLook(p) {
      // The banners and shields take the floor's own color, so each project's hall is its own.
      look = p;
      repaint();
    },
    setProjectName(n) {
      if (n === name) return;
      name = n;
      repaint();
    },
    update(t, dt, people) {
      for (const f of kit.flames) {
        const k = 0.85 + 0.12 * Math.sin(t * 13 + f.phase) + 0.08 * Math.sin(t * 29 + f.phase * 2);
        f.mesh.scale.set(f.size * (0.95 + 0.08 * Math.sin(t * 17 + f.phase)), f.size * k, f.size * (0.95 + 0.08 * Math.cos(t * 19 + f.phase)));
        f.mesh.rotation.y = t * 2 + f.phase;
        f.glow.material.opacity = 0.55 + 0.25 * k;
      }
      for (const l of kit.lights) l.light.intensity = l.base * (0.82 + 0.1 * Math.sin(t * 11 + l.phase) + 0.08 * Math.sin(t * 23 + l.phase * 3));
      // The doors swing in for anyone coming up to them, from either side.
      let near = false;
      for (const q of people) if (Math.hypot(q.x - doorAt.x, q.z - doorAt.z) < 4) near = true;
      const want = near ? 1 : 0;
      if (doorOpen !== want) {
        doorOpen = want > doorOpen ? Math.min(1, doorOpen + dt * 1.2) : Math.max(0, doorOpen - dt * 0.8);
        shell.swing(doorOpen);
      }
      for (const d of kit.desks.values()) {
        if (!d.vacancy.visible || !d.group.visible || d.def.station) continue;
        d.vacancy.position.y = d.vacancyY + Math.sin(t * 2 + d.def.x) * 0.06;
        d.vacancy.rotation.y = t * 1.2;
      }
      kit.gong?.update(dt);
      herald?.person.update(dt, t, false, false);
    },
    mood(lights, daylight, _t, eye) {
      // Down in the dungeon: dark, but for the torches, which the hall's fires are lent to.
      const d = plan.dungeon;
      const below = !!d && !!eye && eye.y < d.ceiling - 0.1;
      if (dungeon && d && eye) {
        const [o0, o1, p0, p1] = d.opening;
        const near = eye.x > o0 - 7 && eye.x < o1 + 7 && eye.z > p0 - 7 && eye.z < p1 + 7;
        dungeon.inside.visible = below || near;
      }
      if (below || lampsDown) {
        const lamps = below ? [...dungeon!.lamps].sort((p, q) => p.distanceToSquared(eye!) - q.distanceToSquared(eye!)) : [];
        kit.lights.forEach((l, i) => {
          const lamp = lamps[i];
          l.light.position.copy(lamp ? l.light.parent!.worldToLocal(lamp.clone()) : hearths[i]);
        });
        lampsDown = below;
      }
      if (below) {
        lights.hemi.color.copy(warmSky);
        lights.hemi.groundColor.copy(warmGround);
        lights.hemi.intensity = 0.5;
        lights.ambient.color.copy(warmSky);
        lights.ambient.intensity = 0.34;
        lights.sun.intensity = 0;
        const fog = lights.scene.fog as THREE.Fog | null;
        if (fog) {
          fog.color.copy(dank);
          fog.near = 6;
          fog.far = 34;
        }
        return;
      }
      // Torchlit: a warm, dim hall whatever the weather, a little brighter by day through the glass.
      lights.hemi.color.copy(warmSky);
      lights.hemi.groundColor.copy(warmGround);
      lights.hemi.intensity = 0.45 + 0.4 * daylight;
      lights.ambient.color.copy(warmSky);
      lights.ambient.intensity = 0.24 + 0.12 * daylight;
      lights.sun.intensity *= 0.4;
      const fog = lights.scene.fog as THREE.Fog | null;
      if (fog) {
        fog.color.copy(haze);
        fog.near = 45;
        fog.far = 140;
      }
      for (const g of kit.glass) g.color.copy(glassNight).lerp(glassDay, 0.25 + 0.75 * daylight);
    },
    dispose() {
      // Its geometry, and every material with a picture of its own (walls, banners, glass, signs); the
      // cached toon materials are everyone's, and stay.
      const freed = new Set<THREE.Material>();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
          const map = (mat as THREE.MeshBasicMaterial).map;
          if (!map || freed.has(mat)) continue;
          map.dispose();
          mat.dispose();
          freed.add(mat);
        }
      });
    },
  };
}
