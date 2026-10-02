import * as THREE from 'three';
import type { FloorPalette } from '../../../shared/floors';
import type { MapPlan } from '../../../shared/maps';
import type { StationPropKind } from '../../../shared/maps/station-props';
import { NavGrid, type Pt } from '../../../shared/nav';
// The people first, as the castle's are: Person (and what it loads) before the rest, so the materials
// the modules make as they load keep their order.
import { buildEscort, buildHerald } from './people';
import type { Interactable } from '../types';
import { mergeByMaterial, textPlane } from '../toon';
import type { World } from '../world';
import { buildAirlock } from './airlock';
import { buildBoards } from './boards';
import { materials, type Kit } from './kit';
import { PROPS } from './props';
import { agentConsole, buildBenches, buildBridge, buildBriefing, placeSetting } from './seats';
import { buildShell } from './shell';
import { SUNWARD, buildSpace } from './space';

/*
 * The station's style of map (see shared/maps/station.ts for the station itself): a pressurised
 * deck in orbit, windows cut through its hull onto the stars and the Earth, a bridge at one end with
 * the captain's chair on it, long benches for the workers, consoles for the board agents, a briefing
 * table for meetings, and an airlock to see workers off through. Everything is placed from the map's
 * plan, so another map in this style is just other numbers.
 *
 * It goes up a part at a time, each in a file of its own beside this one: the shell (the deck, the
 * hull and what's cut through it, the hatch and the solar wings), the airlock, the props (one builder
 * for each kind), the seats (the benches, the consoles, the briefing table and the bridge), the
 * boards, the people, and space itself, outside (space.ts). What they build with is in kit.ts.
 */

/** Puts up the station in `plan` (a station-style map). */
export function buildStation(plan: MapPlan): World {
  const c = plan.config!;
  const b = plan.bounds;
  const H = plan.height;
  const pal = { hull: '#dfe5ee', deck: '#3d4858', panel: '#aeb8c8', metal: '#56627a', glow: '#35d6ff', ...(c.palette ?? {}) };
  const group = new THREE.Group();
  const kit: Kit = {
    plan,
    group,
    still: new THREE.Group(),
    colliders: [],
    interactables: [],
    mats: materials(pal),
    height: H,
    desks: new Map(),
    lights: [],
    spinners: [],
    pulses: [],
    floorAt(x, z) {
      let top = 0;
      for (const cc of kit.colliders) if (cc.top < 50 && !cc.fence && cc.top > top && x > cc.minX && x < cc.maxX && z > cc.minZ && z < cc.maxZ) top = cc.top;
      return top;
    },
  };

  const shell = buildShell(kit, pal);
  // The bridge before the props, so what stands on it stands on its top (see Kit.floorAt).
  buildBridge(kit);
  for (const p of c.props ?? []) PROPS[p.kind as StationPropKind](kit, p);
  buildBenches(kit);
  const overflow = new Map<string, Interactable>();
  for (const def of plan.desks) kit.desks.set(def.id, placeSetting(kit, def, false).view);
  for (const def of plan.overflow) {
    const { view, it } = placeSetting(kit, def, true);
    kit.desks.set(def.id, view);
    overflow.set(def.id, it);
  }
  for (const def of plan.stations) kit.desks.set(def.id, agentConsole(kit, def));
  const briefing = buildBriefing(kit);
  const boardMeshes = buildBoards(kit);
  const herald = buildHerald(kit);
  const airlock = buildAirlock(kit);
  const escort = buildEscort(kit);
  group.add(mergeByMaterial(kit.still));
  const space = buildSpace();
  group.add(space.group);

  // The ship's name, over the bridge's windows.
  const nameAt = plan.throne ?? { x: (b.minX + b.maxX) / 2, z: b.minZ + 0.3, rotY: 0 };
  let nameplate: THREE.Mesh | null = null;
  let name = '';
  const christen = () => {
    if (nameplate) {
      nameplate.removeFromParent();
      nameplate.geometry.dispose();
      (nameplate.material as THREE.MeshBasicMaterial).map?.dispose();
      (nameplate.material as THREE.Material).dispose();
      nameplate = null;
    }
    if (!name) return;
    nameplate = textPlane(`🛰️ ${name.toUpperCase()} STATION`, { bg: '#0f1a26', color: '#e6f6ff', border: `#${kit.mats.accent.color.getHexString()}`, size: 64 });
    nameplate.scale.multiplyScalar(1.5);
    // On the wall behind the chair, facing down the deck.
    const [bx, bz] = [-Math.sin(nameAt.rotY), -Math.cos(nameAt.rotY)];
    const reach = (at: number, d: number, lo: number, hi: number) => (Math.abs(d) < 1e-6 ? Infinity : ((d > 0 ? hi : lo) - at) / d);
    const back = Math.min(reach(nameAt.x, bx, b.minX, b.maxX), reach(nameAt.z, bz, b.minZ, b.maxZ)) - 0.07;
    nameplate.position.set(nameAt.x + bx * back, H - 0.75, nameAt.z + bz * back);
    nameplate.rotation.y = nameAt.rotY;
    group.add(nameplate);
  };

  // Walking about: in through the hatch and out again, round what's in the way.
  const nav = new NavGrid(b, plan.obstacles!);
  const { doorAt, out } = shell;
  const inside: Pt = [plan.door.x, plan.door.z];
  const threshold: Pt = [doorAt.x + out[0] * 0.25, doorAt.z + out[1] * 0.25];
  const beyond: Pt = [doorAt.x + out[0] * 4.6, doorAt.z + out[1] * 4.6];
  let doorOpen = 0;

  // How it's lit: the same cool light whatever the hour, and the Sun through the windows.
  const coolSky = new THREE.Color('#e3edff');
  const coolGround = new THREE.Color('#4b566a');
  const sunlight = new THREE.Color('#fff4e0');
  const black = new THREE.Color('#000000');
  const accent = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  const gongAt = kit.gong?.top;

  return {
    plan,
    group,
    colliders: kit.colliders,
    interactables: kit.interactables,
    pickables: [group],
    desks: kit.desks,
    boardMeshes,
    meetingBoard: briefing.board,
    meetingSign: briefing.sign,
    gong: kit.gong,
    nav,
    ways: {
      home: (seat, from) => ({ way: [...(from ? nav.route(from, inside) : nav.wayFrom(seat, inside)), threshold, beyond], chute: false }),
      in: (seat) => [beyond, threshold, ...nav.wayTo(inside, seat)],
    },
    rain: [{ area: b, top: () => H - 0.5 }],
    device: 'laptop',
    room: { wall: 0.5, enclosed: true },
    airlock,
    escort,
    // Nothing outside to hear: no rain on the glass, no birds.
    acoustics: { gong: gongAt ? { x: gongAt.x, y: gongAt.y - 1.8, z: gongAt.z } : null, windows: [], vacuum: true },
    herald,
    setBeanbags(outNow) {
      for (const [id, it] of overflow) {
        const show = outNow.has(id);
        kit.desks.get(id)!.group.visible = show;
        it.off = !show;
      }
      return [];
    },
    setLook(p: FloorPalette) {
      // The lines of light take the floor's own color, bright, so each project's deck is its own.
      new THREE.Color(p.trim).getHSL(hsl);
      kit.mats.accent.color.copy(accent.setHSL(hsl.h, 0.9, 0.6));
      christen();
    },
    setProjectName(n) {
      if (n === name) return;
      name = n;
      christen();
    },
    update(t, dt, people) {
      for (const s of kit.spinners) s.obj.rotation.y += s.speed * dt;
      for (const p of kit.pulses) p.set(0.5 + 0.5 * Math.sin((t * p.rate + p.phase) * Math.PI * 2));
      // The hatch slides open for anyone coming up to it, from either side.
      let near = false;
      for (const q of people) if (Math.hypot(q.x - doorAt.x, q.z - doorAt.z) < 4) near = true;
      const want = near ? 1 : 0;
      if (doorOpen !== want) {
        doorOpen = want > doorOpen ? Math.min(1, doorOpen + dt * 1.6) : Math.max(0, doorOpen - dt * 1.1);
        shell.slide(doorOpen);
      }
      for (const d of kit.desks.values()) {
        if (!d.vacancy.visible || !d.group.visible || d.def.station) continue;
        d.vacancy.position.y = d.vacancyY + Math.sin(t * 2 + d.def.x) * 0.06;
        d.vacancy.rotation.y = t * 1.2;
      }
      kit.gong?.update(dt);
      herald?.person.update(dt, t, false, false);
    },
    mood(lights, _daylight, t, eye) {
      if (eye) space.update(t, eye);
      // There's no day or night up here, and no weather: the deck's own light, and the Sun where it gets in.
      lights.hemi.color.copy(coolSky);
      lights.hemi.groundColor.copy(coolGround);
      lights.hemi.intensity = 1.05;
      lights.ambient.color.copy(coolSky);
      lights.ambient.intensity = 0.42;
      lights.sun.color.copy(sunlight);
      lights.sun.intensity = 1.5;
      lights.sun.position.copy(lights.sun.target.position).addScaledVector(SUNWARD, 45);
      (lights.scene.background as THREE.Color).copy(black);
      const fog = lights.scene.fog as THREE.Fog | null;
      if (fog) {
        fog.color.copy(black);
        fog.near = 120;
        fog.far = 300;
      }
    },
    dispose() {
      space.group.removeFromParent();
      space.dispose();
      // Its geometry, and every material with a picture of its own (walls, signs, displays); the
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
