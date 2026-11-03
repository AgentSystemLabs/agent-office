import type { BuildingSpec } from './building-kit';

export interface CampusPoint { x: number; z: number }
export interface CampusRoute { id: string; points: CampusPoint[]; width: number }
export type CampusDistrictId = 'administration' | 'finance' | 'personal-planning' | 'build-design' | 'venture-lab' | 'security-audit';

export interface DistrictPlot {
  id: CampusDistrictId;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  accent: string;
  managerPoint: CampusPoint;
  connectionPoints: CampusPoint[];
  activeRoomIds: string[];
}

export const campusBounds = { width: 96, depth: 78 } as const;

export const civicCore = {
  townHall: { x: 0, z: -28 },
  plaza: { x: 0, z: -21, width: 18, depth: 10 },
  brain: { x: 0, z: -14.5 },
  boulevardGate: { x: 0, z: 37 },
} as const;

export const districtPlots: DistrictPlot[] = [
  { id: 'administration', name: 'Administration', x: -25, z: -19, width: 18, depth: 14, accent: '#c78a56', managerPoint: { x: -18.5, z: -16 }, connectionPoints: [{ x: -16, z: -19 }, { x: -25, z: -12 }], activeRoomIds: ['intake-routing'] },
  { id: 'security-audit', name: 'Security & Audit', x: 25, z: -19, width: 18, depth: 14, accent: '#df7182', managerPoint: { x: 18.5, z: -16 }, connectionPoints: [{ x: 16, z: -19 }, { x: 25, z: -12 }], activeRoomIds: [] },
  { id: 'finance', name: 'Finance', x: -30, z: 2, width: 18, depth: 14, accent: '#67a8dc', managerPoint: { x: -23.5, z: 5 }, connectionPoints: [{ x: -21, z: 2 }, { x: -30, z: 9 }], activeRoomIds: ['financial-markets'] },
  { id: 'personal-planning', name: 'Personal Planning', x: 30, z: 2, width: 18, depth: 14, accent: '#64d2c3', managerPoint: { x: 23.5, z: 5 }, connectionPoints: [{ x: 21, z: 2 }, { x: 30, z: 9 }], activeRoomIds: [] },
  { id: 'build-design', name: 'Build & Design', x: -24, z: 25, width: 24, depth: 18, accent: '#9c83d7', managerPoint: { x: -15, z: 29 }, connectionPoints: [{ x: -12, z: 25 }, { x: -24, z: 16 }], activeRoomIds: ['research', 'build-workshop', 'design-studio'] },
  { id: 'venture-lab', name: 'Venture Lab', x: 24, z: 25, width: 24, depth: 18, accent: '#d86dc7', managerPoint: { x: 15, z: 29 }, connectionPoints: [{ x: 12, z: 25 }, { x: 24, z: 16 }], activeRoomIds: [] },
];

export interface CampusBuildingSpec extends BuildingSpec { districtId: CampusDistrictId }

export const campusBuildings: CampusBuildingSpec[] = [
  { id: 'intake-routing', name: 'Intake & Routing', x: -25, z: -19, color: '#a66f48', kind: 'standard', districtId: 'administration' },
  { id: 'financial-markets', name: 'Financial Markets', x: -30, z: 2, color: '#496f96', kind: 'finance', districtId: 'finance' },
  { id: 'research', name: 'Research', x: -30, z: 23, color: '#5486ab', kind: 'standard', districtId: 'build-design' },
  { id: 'build-workshop', name: 'Build Workshop', x: -23, z: 29, color: '#527e64', kind: 'workshop', districtId: 'build-design' },
  { id: 'design-studio', name: 'Design Studio', x: -16, z: 23, color: '#806e9e', kind: 'standard', districtId: 'build-design' },
];

/** Structural placeholders for reserved districts; interiors are intentionally unfinished. */
export const plannedBuildings: CampusBuildingSpec[] = [
  { id: 'planning', name: 'Planning', x: 25, z: -1.5, color: '#4b9e98', kind: 'standard', districtId: 'personal-planning' },
  { id: 'schedule', name: 'Schedule', x: 31, z: 2, color: '#4b9e98', kind: 'standard', districtId: 'personal-planning' },
  { id: 'personal-review', name: 'Personal Review', x: 25, z: 6, color: '#4b9e98', kind: 'standard', districtId: 'personal-planning' },
  { id: 'security-privacy', name: 'Security & Privacy', x: 19, z: -19, color: '#a6586d', kind: 'standard', districtId: 'security-audit' },
  { id: 'quality-inspection', name: 'Quality Inspection', x: 25, z: -24, color: '#a6586d', kind: 'standard', districtId: 'security-audit' },
  { id: 'workflow-reliability', name: 'Workflow & Reliability', x: 31, z: -19, color: '#a6586d', kind: 'standard', districtId: 'security-audit' },
  { id: 'opportunity-research', name: 'Opportunity Research', x: 19, z: 23, color: '#a85c9e', kind: 'standard', districtId: 'venture-lab' },
  { id: 'business-validation', name: 'Business Validation', x: 25, z: 29, color: '#a85c9e', kind: 'standard', districtId: 'venture-lab' },
  { id: 'launch-growth', name: 'Launch & Growth', x: 31, z: 23, color: '#a85c9e', kind: 'standard', districtId: 'venture-lab' },
];

export const primaryRoads: CampusRoute[] = [
  { id: 'town-hall-boulevard', width: 4.2, points: [civicCore.boulevardGate, { x: 0, z: -10.5 }] },
];

export const secondaryRoads: CampusRoute[] = [
  { id: 'north-west-road', width: 2.8, points: [{ x: -36, z: -12 }, { x: -10, z: -12 }] },
  { id: 'north-east-road', width: 2.8, points: [{ x: 10, z: -12 }, { x: 36, z: -12 }] },
  { id: 'middle-road', width: 2.8, points: [{ x: -40, z: 11 }, { x: 40, z: 11 }] },
  { id: 'south-road', width: 2.8, points: [{ x: -38, z: 34 }, { x: 38, z: 34 }] },
];

export const pedestrianPaths: CampusRoute[] = districtPlots.flatMap(plot => plot.connectionPoints.map((point, index) => ({
  id: `${plot.id}-path-${index + 1}`,
  width: 1.15,
  points: [{ x: plot.x, z: plot.z }, point],
})));

export const transitRoute: CampusRoute = {
  id: 'rapid-transit',
  width: .22,
  points: [{ x: -44, z: 37 }, { x: 0, z: 37 }, { x: 40, z: 37 }, { x: 45, z: 9 }],
};

export const expansionZones = [
  { id: 'active-vertical', name: 'Active Vertical Expansion', x: -41, z: 25, status: 'active' as const },
  { id: 'future-vertical', name: 'Future Vertical Expansion', x: 41, z: 25, status: 'future' as const },
  { id: 'satellite-connection', name: 'Satellite Campus Link', x: 45, z: 9, status: 'connection' as const },
  { id: 'transit-station', name: 'Rapid Transit Station', x: 0, z: 37, status: 'transit' as const },
] as const;

export function buildingById(id: string): CampusBuildingSpec | undefined {
  return campusBuildings.find(building => building.id === id);
}

export function districtById(id: CampusDistrictId): DistrictPlot {
  return districtPlots.find(district => district.id === id)!;
}
