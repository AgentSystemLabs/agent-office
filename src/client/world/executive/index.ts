import * as THREE from 'three';
import type { FloorPalette } from '../../../shared/floors.js';
import type { MapPlan } from '../../../shared/maps/types.js';
import { NavGrid, type Bounds, type Obstacles } from '../../../shared/nav.js';
import { campusBounds, campusBuildings, civicCore, districtPlots } from '../../../client/executive/campus-layout.js';
import { buildCampusRoutes } from '../../../client/executive/campus-routes.js';
import { buildCivicCore } from '../../../client/executive/civic-core.js';
import { buildDistrictZones } from '../../../client/executive/district-zones.js';
import { buildExpansionZones } from '../../../client/executive/expansion-zones.js';
import { buildExecutiveBuilding } from '../../../client/executive/building-kit.js';
import { buildCastle } from '../castle/index.js';
import type { World } from '../world.js';
import type { Collider } from '../types.js';
import { executiveFloorFor } from '../../../shared/executive-floor-map.js';

const bounds: Bounds = { minX: -campusBounds.width / 2, maxX: campusBounds.width / 2, minZ: -campusBounds.depth / 2, maxZ: campusBounds.depth / 2 };
const buildingCollider = (x: number, z: number, width: number, depth: number, top = 4): Collider => ({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, top, fence: true });

function campusColliders(): Collider[] {
  const edge = 1;
  const colliders: Collider[] = [{ minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ, top: 0 },
    { minX: bounds.minX - edge, maxX: bounds.minX, minZ: bounds.minZ - edge, maxZ: bounds.maxZ + edge, top: .3, fence: true },
    { minX: bounds.maxX, maxX: bounds.maxX + edge, minZ: bounds.minZ - edge, maxZ: bounds.maxZ + edge, top: .3, fence: true },
    { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ - edge, maxZ: bounds.minZ, top: .3, fence: true },
    { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.maxZ, maxZ: bounds.maxZ + edge, top: .3, fence: true },
    buildingCollider(civicCore.townHall.x, civicCore.townHall.z, 10.5, 7.5, 6),
  ];
  for (const building of campusBuildings) colliders.push(buildingCollider(building.x, building.z, 5.9, 4.7));
  for (const plot of districtPlots) if (!plot.activeRoomIds.length) colliders.push(buildingCollider(plot.x, plot.z, 7.2, 5.6));
  return colliders;
}

function obstaclesFrom(colliders: readonly Collider[]): Obstacles {
  return { rects: colliders.filter(c => c.fence).map(c => [c.minX, c.maxX, c.minZ, c.maxZ]), circles: [] };
}

/**
 * Stage 2 adapter boundary. It deliberately reuses the proven map-world contract while the
 * Executive World campus geometry is moved into that lifecycle in a later integration stage.
 */
export function buildExecutive(plan: MapPlan): World {
  const base = buildCastle(plan);
  base.group.visible = false;
  const staging = new THREE.Scene();
  buildCampusRoutes(staging);
  buildDistrictZones(staging);
  buildExpansionZones(staging);
  const civic = buildCivicCore(staging);
  civic.townHit.userData.executive = executiveFloorFor('town-hall');
  civic.townHit.userData.interact = { kind: 'executivebuilding', x: civicCore.townHall.x, z: civicCore.townHall.z, radius: 4, decorId: 'town-hall', label: 'Town Hall' };
  const pickables: THREE.Object3D[] = [civic.townHit];
  for (const plot of districtPlots) {
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(plot.width, plot.depth), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.rotation.x = -Math.PI / 2;
    hit.position.set(plot.x, .52, plot.z);
    hit.name = `executive-district-hit-${plot.id}`;
    hit.userData.interact = { kind: 'executivebuilding', x: plot.x, z: plot.z, radius: 12, decorId: `district:${plot.id}`, label: plot.name };
    staging.add(hit);
    pickables.push(hit);
  }
  for (const spec of campusBuildings) {
    const building = buildExecutiveBuilding(spec);
    building.hit.userData.executive = executiveFloorFor(spec.id);
    building.hit.userData.interact = { kind: 'executivebuilding', x: spec.x, z: spec.z, radius: 6, decorId: spec.id, label: spec.name };
    staging.add(building.group);
    pickables.push(building.hit);
  }
  const group = new THREE.Group();
  group.name = 'executive-world-campus';
  const ground = new THREE.Mesh(new THREE.BoxGeometry(campusBounds.width + 8, .65, campusBounds.depth + 8), new THREE.MeshStandardMaterial({ color: '#172b2d', roughness: .92 }));
  ground.position.y = -.4; ground.receiveShadow = true; group.add(ground);
  group.add(new THREE.HemisphereLight('#e9f4ff', '#34483e', 1.8));
  const sun = new THREE.DirectionalLight('#fff0d5', 1.8); sun.position.set(-24, 38, 18); sun.castShadow = true; group.add(sun);
  group.add(...staging.children);
  const colliders = campusColliders();
  const nav = new NavGrid(bounds, obstaclesFrom(colliders));
  const door = [plan.door.x, plan.door.z] as [number, number];
  const route = (x: number, z: number) => nav.route(door, [x, z]);
  let projectName = '';
  return {
    ...base,
    plan,
    group,
    colliders,
    interactables: [],
    pickables,
    nav,
    ways: {
      home: (seat, from) => ({ way: route(from?.[0] ?? seat.x, from?.[1] ?? seat.z), chute: false }),
      in: (seat) => route(seat.x, seat.z),
    },
    rain: [{ area: bounds, top: () => 4 }],
    room: { wall: .5, enclosed: false },
    setBeanbags: () => [],
    setLook: (_palette: FloorPalette) => undefined,
    setProjectName: (name: string) => { projectName = name; void projectName; },
    update: (t: number, _dt: number) => { civic.orb.rotation.y = t * .00025; },
    dispose: () => { base.dispose?.(); group.clear(); },
  };
}
