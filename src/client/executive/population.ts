import * as THREE from 'three';
import { executivePeople, type ExecutivePerson } from '../../shared/executive-world';
import { lookFromSeed } from '../../shared/avatar';
import { Person } from '../world/character/person';
import { buildingById, civicCore, districtById } from './campus-layout';

export interface ManagerPlacement {
  x: number;
  y: number;
  z: number;
  heading: number;
}

const atBuilding = (id: string, dx: number, dz: number, heading = -2.7): ManagerPlacement => {
  const building = buildingById(id)!;
  return { x: building.x + dx, y: .6, z: building.z + dz, heading };
};
const atDistrict = (id: Parameters<typeof districtById>[0], heading: number): ManagerPlacement => {
  const point = districtById(id).managerPoint;
  return { ...point, y: .38, heading };
};

export const managementPlacements: Readonly<Record<string, ManagerPlacement>> = {
  'operations-manager': { x: civicCore.townHall.x - 2.2, y: 3.55, z: civicCore.townHall.z - .05, heading: .25 },
  'administration-district-manager': atDistrict('administration', -1.4),
  'intake-routing-manager': atBuilding('intake-routing', 1.65, 1.15),
  'finance-district-manager': atDistrict('finance', -1.5),
  'financial-markets-manager': atBuilding('financial-markets', 0, 1.35, Math.PI),
  'build-design-district-manager': atDistrict('build-design', -1.6),
  'research-manager': atBuilding('research', 1.65, 1.15),
  'build-workshop-manager': atBuilding('build-workshop', 1.65, 1.15),
  'design-studio-manager': atBuilding('design-studio', 1.65, 1.15),
};

export interface ManagementAgent {
  record: ExecutivePerson;
  person: Person;
  root: THREE.Group;
  marker: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  heading: number;
  phase: number;
}

function managerRecordFromObject(object: THREE.Object3D): ExecutivePerson | undefined {
  const id = object.userData.executivePersonId as string | undefined;
  return id ? executivePeople.find(person => person.id === id) : undefined;
}

export function executivePersonFromObject(object: THREE.Object3D): ExecutivePerson | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    const record = managerRecordFromObject(current);
    if (record) return record;
    current = current.parent;
  }
  return undefined;
}

export function createManagementPopulation(scene: THREE.Scene): ManagementAgent[] {
  return executivePeople.flatMap((record, index) => {
    if (!record.visible || record.placementStatus !== 'placed') return [];
    const placement = managementPlacements[record.id];
    if (!placement) return [];
    const person = new Person(record.name, record.accent, lookFromSeed(`executive-${record.id}`));
    const root = person.root;
    root.position.set(placement.x, placement.y, placement.z);
    root.rotation.y = placement.heading;
    root.scale.setScalar(record.role === 'operations-manager' ? .88 : .82);
    root.traverse(child => {
      child.userData.executivePersonId = record.id;
      if (child instanceof THREE.Sprite) child.visible = false;
    });
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(record.role === 'room-manager' ? .3 : .36, record.role === 'room-manager' ? .37 : .45, 28),
      new THREE.MeshBasicMaterial({ color: record.accent, transparent: true, opacity: .72, side: THREE.DoubleSide, depthWrite: false }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = .035;
    marker.userData.executivePersonId = record.id;
    root.add(marker);
    scene.add(root);
    return [{ record, person, root, marker, heading: placement.heading, phase: index * 1.73 }];
  });
}

export function updateManagementPopulation(agents: readonly ManagementAgent[], dt: number, elapsedSeconds: number): void {
  for (const agent of agents) {
    agent.person.update(dt, elapsedSeconds, false, false);
    agent.root.rotation.y = agent.heading + Math.sin(elapsedSeconds * .45 + agent.phase) * .045;
  }
}

export function setSelectedManager(agents: readonly ManagementAgent[], selectedId?: string): void {
  for (const agent of agents) {
    const selected = agent.record.id === selectedId;
    agent.marker.material.opacity = selected ? 1 : .72;
    agent.marker.scale.setScalar(selected ? 1.25 : 1);
  }
}
