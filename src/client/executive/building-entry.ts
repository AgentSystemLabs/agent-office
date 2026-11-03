import type { CampusBuildingSpec, CampusPoint, CampusDistrictId } from './campus-layout';
import { architectureFor } from './building-definition';

export type InteriorType = 'town-hall' | 'placeholder';
export type DoorState = 'closed' | 'opening' | 'open' | 'closing';
export interface DoorController { state: DoorState; progress: number; group: { position: { x: number } }; doorwayWidth: number; slideDistance: number }

export function createDoorController(group: DoorController['group'], doorwayWidth=1.25): DoorController { return { state: 'closed', progress: 0, group, doorwayWidth, slideDistance: doorwayWidth * 2.1 }; }
export function openDoor(door: DoorController): void { if (door.state === 'closed' || door.state === 'closing') door.state = 'opening'; }
export function closeDoor(door: DoorController): void { if (door.state === 'open' || door.state === 'opening') door.state = 'closing'; }
export function doorIsPassable(door: Pick<DoorController,'state'>): boolean { return door.state === 'opening' || door.state === 'open'; }
export function stepDoor(door: DoorController, dt: number): DoorState {
  const speed = 1 / .24;
  if (door.state === 'opening') { door.progress = Math.min(1, door.progress + dt * speed); if (door.progress >= 1) door.state = 'open'; }
  else if (door.state === 'closing') { door.progress = Math.max(0, door.progress - dt * speed); if (door.progress <= 0) door.state = 'closed'; }
  const eased = door.progress * door.progress * (3 - 2 * door.progress);
  door.group.position.x = eased * door.slideDistance;
  return door.state;
}

export interface BuildingEntryDefinition {
  id: string;
  name: string;
  districtId: CampusDistrictId | 'administration';
  exterior: CampusPoint;
  door: CampusPoint;
  doorwayWidth: number;
  exteriorThreshold: CampusPoint;
  interiorThreshold: CampusPoint;
  entryDirection: CampusPoint;
  clearanceRadius: number;
  interiorType: InteriorType;
  interiorBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  interiorSpawn: CampusPoint;
  interiorExit: CampusPoint;
  roomName: string;
  managerStatus: string;
}

const placeholder = (spec: CampusBuildingSpec): BuildingEntryDefinition => ({
  ...(() => { const a=architectureFor(spec); return { doorwayWidth:a.doorway.width, exteriorThreshold:{x:spec.x+a.exteriorThreshold.x,z:spec.z+a.exteriorThreshold.z}, interiorThreshold:a.interiorThreshold, entryDirection:{x:0,z:-1}, clearanceRadius:a.doorway.width/2+.45, interiorBounds:{minX:-a.interiorWidth/2,maxX:a.interiorWidth/2,minZ:-a.interiorDepth/2,maxZ:a.interiorDepth/2}, interiorSpawn:{x:0,z:a.interiorThreshold.z-.8}, interiorExit:a.interiorThreshold}; })(),
  id: spec.id,
  name: spec.name,
  districtId: spec.districtId,
  exterior: { x: spec.x, z: spec.z },
  door: { x: spec.x, z: spec.z + architectureFor(spec).doorway.z },
  interiorType: 'placeholder',
  roomName: spec.name,
  managerStatus: 'Manager assignment simulated',
});

export const townHallEntry: BuildingEntryDefinition = {
  id: 'town-hall', name: 'Town Hall', districtId: 'administration',
  ...(() => { const a=architectureFor({kind:'town'}); return { doorwayWidth:a.doorway.width, exteriorThreshold:{x:0,z:-28+a.exteriorThreshold.z}, interiorThreshold:a.interiorThreshold, entryDirection:{x:0,z:-1}, clearanceRadius:a.doorway.width/2+.45, interiorBounds:{minX:-a.interiorWidth/2,maxX:a.interiorWidth/2,minZ:-a.interiorDepth/2,maxZ:a.interiorDepth/2}, interiorSpawn:{x:0,z:a.interiorThreshold.z-.8}, interiorExit:a.interiorThreshold }; })(),
  exterior: { x: 0, z: -28 }, door: { x: 0, z: -28 + architectureFor({kind:'town'}).doorway.z }, interiorType: 'town-hall',
  roomName: 'Headquarters', managerStatus: 'Operations Manager present upstairs',
};

export function entryForBuilding(spec: CampusBuildingSpec): BuildingEntryDefinition { return placeholder(spec); }
