import type { ExecutiveRoom } from '../../shared/executive-world';

export type CapacityState = 'comfortable' | 'crowded' | 'insufficient';

export interface RoomCapacityEstimate {
  roomId: string;
  width: number;
  depth: number;
  usableFloorArea: number;
  workstationCount: number;
  comfortableWorkerCapacity: number;
  maximumPracticalOccupancy: number;
  managerCapacity: number;
  currentManagerCount: number;
  currentWorkerCount: number;
  estimated: true;
}

const estimate = (
  roomId: string,
  usableFloorArea: number,
  workstationCount: number,
  comfortableWorkerCapacity: number,
  maximumPracticalOccupancy: number,
): RoomCapacityEstimate => ({
  roomId,
  width: 5.6,
  depth: 4.4,
  usableFloorArea,
  workstationCount,
  comfortableWorkerCapacity,
  maximumPracticalOccupancy,
  managerCapacity: 1,
  currentManagerCount: 1,
  currentWorkerCount: 0,
  estimated: true,
});

export const representedRoomCapacities: RoomCapacityEstimate[] = [
  estimate('intake-routing', 14, 1, 1, 3),
  estimate('financial-markets', 13, 2, 2, 4),
  estimate('research', 14, 1, 1, 3),
  estimate('build-workshop', 11.5, 1, 1, 2),
  estimate('design-studio', 14, 1, 1, 3),
];

export function capacityState(capacity: RoomCapacityEstimate): CapacityState {
  if (capacity.currentManagerCount > capacity.managerCapacity) return 'insufficient';
  const occupancy = capacity.currentManagerCount + capacity.currentWorkerCount;
  if (occupancy > capacity.maximumPracticalOccupancy) return 'insufficient';
  if (capacity.currentWorkerCount > capacity.comfortableWorkerCapacity) return 'crowded';
  return 'comfortable';
}

export function capacityForRoom(roomId: string): RoomCapacityEstimate | undefined {
  return representedRoomCapacities.find(capacity => capacity.roomId === roomId);
}

export function capacityPanel(room: ExecutiveRoom): string {
  const capacity = capacityForRoom(room.id);
  if (!capacity) return '';
  const state = capacityState(capacity);
  return `<section class="capacity-card" data-capacity-state="${state}"><h3>Prototype capacity estimate</h3><dl><div><dt>Room</dt><dd>${capacity.width} × ${capacity.depth}</dd></div><div><dt>Estimated usable area</dt><dd>${capacity.usableFloorArea} units²</dd></div><div><dt>Workstations</dt><dd>${capacity.workstationCount}</dd></div><div><dt>Comfortable workers</dt><dd>${capacity.comfortableWorkerCapacity}</dd></div><div><dt>Current managers</dt><dd>${capacity.currentManagerCount}</dd></div><div><dt>Current logical workers</dt><dd>${capacity.currentWorkerCount}</dd></div><div><dt>State</dt><dd>${state}</dd></div></dl><p>Estimate based on prototype geometry; not a measured occupancy rating.</p></section>`;
}
