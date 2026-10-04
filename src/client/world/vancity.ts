import * as THREE from 'three';
import { Vox } from './vox';
import { Build } from './vanvox';
import { bcPlace, canadaPlace, downtown, scienceWorld } from './vanmarks';
import { lionsGate, mountains, stanleyForest, stanleyGround, waterPlane } from './vanpark';
import { buildPeople } from './vanpeople';
import { buildTraffic, type Grid } from './vantraffic';
import { treeMaterial } from './voxtrees';
import { BCPLACE, CREEK, DOWNTOWN, HARBOUR, INLET, SCIENCE, STANLEY, type Zone } from './vanzones';

// Downtown Vancouver around the office: the Harbour Centre, Marine Building, Shangri-La and condo towers,
// Canada Place with a cruise ship, Science World, BC Place, Stanley Park with its seawall, totem poles and
// lighthouse, the Lions Gate Bridge over the inlet and the North Shore mountains behind. All of it blocks,
// with the traffic and the people of the city running through it.

export interface Vancouver {
  group: THREE.Group;
  /** The lit windows, the cars and the people: dark is how dark it is (0–1). */
  update(t: number, dt: number, dark: number): void;
}

const DAY_GLASS = new THREE.Color('#86b0cf');
const NIGHT_GLASS = new THREE.Color('#ffd27a');

/** A tall thin street lamp in blocks, its arm reaching toward +x. */
function lampPost(): THREE.BufferGeometry {
  const v = new Vox(0.1, 0.04);
  for (let j = 0; j < 46; j++) for (let i = -1; i < 1; i++) for (let k = -1; k < 1; k++) v.put(i, j, k, '#3a3f47');
  for (let i = 1; i < 7; i++) v.put(i, 46, 0, '#3a3f47');
  for (let i = 5; i < 9; i++) for (let k = -1; k < 1; k++) v.put(i, 45, k, '#fff0c0', 0.02);
  return v.build();
}

export function buildVancouver(rnd: () => number, grid: Grid, lampPos: number[]): Vancouver {
  const group = new THREE.Group();
  const glass = new THREE.MeshBasicMaterial({ vertexColors: true, color: DAY_GLASS });
  const put = (b: Build, at: Zone | { x: number; z: number }, dx = 0, dz = 0, yaw = 0) => {
    const day = new THREE.Mesh(b.v.build(), treeMaterial);
    const lit = new THREE.Mesh(b.lit.build(), glass);
    for (const m of [day, lit]) {
      m.position.set(at.x + dx, 0, at.z + dz);
      m.rotation.y = yaw;
      m.frustumCulled = false;
      group.add(m);
    }
    day.castShadow = true;
  };
  const water = (z: Zone, dx = 0, dz = 0) => {
    const side = z.r * 1.41;
    const w = waterPlane(side, side);
    w.position.set(z.x + dx, w.position.y, z.z + dz);
    group.add(w);
  };

  water(HARBOUR);
  water(INLET);
  water(CREEK);
  put(downtown(rnd), DOWNTOWN);
  put(canadaPlace(rnd), HARBOUR, 0, -12);
  put(scienceWorld(rnd), SCIENCE, 0, -5);
  put(bcPlace(rnd), BCPLACE);
  put(stanleyGround(rnd), STANLEY);
  put(lionsGate(rnd), { x: STANLEY.x - STANLEY.r + 3, z: STANLEY.z }, 0, 0, Math.PI);
  const forest = stanleyForest(rnd);
  forest.position.set(STANLEY.x, 0.8, STANLEY.z);
  group.add(forest);

  // The North Shore mountains, two ranges, away over the water.
  for (const [seed, z, scale] of [[3, -470, 1.3], [8, -540, 1.7]] as const) {
    const m = new THREE.Mesh(mountains(seed, 1200), treeMaterial);
    m.scale.setScalar(scale);
    m.position.set(-420, 0, z);
    group.add(m);
  }

  // Street lamps as posts, their arms reaching over the road.
  const posts: THREE.Matrix4[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < lampPos.length; i += 3) {
    const x = lampPos[i], z = lampPos[i + 2];
    const dx = x - (grid.streetX + Math.round((x - grid.streetX) / grid.period) * grid.period);
    const dz = z - (grid.streetZ + Math.round((z - grid.streetZ) / grid.period) * grid.period);
    const yaw = Math.abs(dx) < Math.abs(dz) ? (dx > 0 ? Math.PI : 0) : dz > 0 ? Math.PI / 2 : -Math.PI / 2;
    q.setFromAxisAngle(up, yaw);
    posts.push(m4.clone().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, 1)));
  }
  if (posts.length) {
    const lamps = new THREE.InstancedMesh(lampPost(), treeMaterial, posts.length);
    posts.forEach((p, i) => lamps.setMatrixAt(i, p));
    lamps.frustumCulled = false;
    group.add(lamps);
  }

  const traffic = buildTraffic(rnd, grid);
  const people = buildPeople(rnd, grid);
  group.add(traffic.group, people.group);

  return {
    group,
    update(t, dt, dark) {
      traffic.update(dt, dark);
      people.update(t, dt, dark);
      const k = THREE.MathUtils.smoothstep(dark, 0.05, 0.5);
      glass.color.copy(DAY_GLASS).lerp(NIGHT_GLASS, k);
    },
  };
}

