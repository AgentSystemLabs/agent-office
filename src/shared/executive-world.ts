/** Executive World vertical slice. All records in this module are demonstrations. */
export type ExecutiveRole = 'director' | 'operations-manager' | 'district-manager' | 'room-manager' | 'worker';
export type ReviewStatus = 'awaiting-director-review' | 'approved' | 'rejected';
export type PlacementStatus = 'interface-only' | 'placed' | 'unplaced';

export interface ExecutivePerson {
  id: string;
  role: ExecutiveRole;
  name: string;
  reportsTo?: string;
  districtId?: string;
  roomId?: string;
  accent: string;
  placementStatus: PlacementStatus;
  visible: boolean;
  simulation: true;
}

export interface ExecutiveRoom {
  id: string;
  name: string;
  districtId: string;
}

export interface ExecutiveDistrict {
  id: string;
  name: string;
  rooms: ExecutiveRoom[];
}

export interface DemonstrationReview {
  id: string;
  description: string;
  status: ReviewStatus;
  simulation: true;
  decisionBy?: 'director';
}

export const executiveDistricts: ExecutiveDistrict[] = [
  { id: 'administration', name: 'Administration', rooms: [
    { id: 'intake-routing', name: 'Intake & Routing', districtId: 'administration' },
  ] },
  { id: 'finance', name: 'Finance', rooms: [
    { id: 'financial-markets', name: 'Financial Markets', districtId: 'finance' },
  ] },
  { id: 'build-design', name: 'Build & Design', rooms: [
    { id: 'research', name: 'Research', districtId: 'build-design' },
    { id: 'build-workshop', name: 'Build Workshop', districtId: 'build-design' },
    { id: 'design-studio', name: 'Design Studio', districtId: 'build-design' },
  ] },
];

export const executivePeople: ExecutivePerson[] = [
  { id: 'director', role: 'director', name: 'Director', accent: '#d8bd82', placementStatus: 'interface-only', visible: false, simulation: true },
  { id: 'operations-manager', role: 'operations-manager', name: 'Operations Manager', reportsTo: 'director', districtId: 'administration', accent: '#d8bd82', placementStatus: 'placed', visible: true, simulation: true },
  { id: 'administration-district-manager', role: 'district-manager', name: 'Administration District Manager', reportsTo: 'operations-manager', districtId: 'administration', accent: '#c78a56', placementStatus: 'placed', visible: true, simulation: true },
  { id: 'intake-routing-manager', role: 'room-manager', name: 'Intake & Routing Room Manager', reportsTo: 'administration-district-manager', districtId: 'administration', roomId: 'intake-routing', accent: '#c78a56', placementStatus: 'placed', visible: true, simulation: true },
  { id: 'finance-district-manager', role: 'district-manager', name: 'Finance District Manager', reportsTo: 'operations-manager', districtId: 'finance', accent: '#67a8dc', placementStatus: 'placed', visible: true, simulation: true },
  { id: 'financial-markets-manager', role: 'room-manager', name: 'Financial Markets Room Manager', reportsTo: 'finance-district-manager', districtId: 'finance', roomId: 'financial-markets', accent: '#67a8dc', placementStatus: 'placed', visible: true, simulation: true },
  { id: 'build-design-district-manager', role: 'district-manager', name: 'Build & Design District Manager', reportsTo: 'operations-manager', districtId: 'build-design', accent: '#9c83d7', placementStatus: 'placed', visible: true, simulation: true },
  { id: 'research-manager', role: 'room-manager', name: 'Research Room Manager', reportsTo: 'build-design-district-manager', districtId: 'build-design', roomId: 'research', accent: '#72a8d6', placementStatus: 'placed', visible: true, simulation: true },
  { id: 'build-workshop-manager', role: 'room-manager', name: 'Build Workshop Room Manager', reportsTo: 'build-design-district-manager', districtId: 'build-design', roomId: 'build-workshop', accent: '#69aa7d', placementStatus: 'placed', visible: true, simulation: true },
  { id: 'design-studio-manager', role: 'room-manager', name: 'Design Studio Room Manager', reportsTo: 'build-design-district-manager', districtId: 'build-design', roomId: 'design-studio', accent: '#9c83d7', placementStatus: 'placed', visible: true, simulation: true },
];

export function validateExecutivePopulation(people: readonly ExecutivePerson[] = executivePeople): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const districts = new Map(executiveDistricts.map(district => [district.id, district]));
  for (const person of people) {
    if (ids.has(person.id)) errors.push(`Duplicate person id: ${person.id}`);
    ids.add(person.id);
  }
  const byId = new Map(people.map(person => [person.id, person]));
  for (const person of people) {
    if (person.reportsTo && !byId.has(person.reportsTo)) errors.push(`${person.id} reports to unknown person: ${person.reportsTo}`);
    if (person.districtId && !districts.has(person.districtId)) errors.push(`${person.id} has unknown district: ${person.districtId}`);
    if (person.roomId) {
      const room = person.districtId ? districts.get(person.districtId)?.rooms.find(item => item.id === person.roomId) : undefined;
      if (!room) errors.push(`${person.id} has invalid room assignment: ${person.roomId}`);
    }
    if (person.role === 'room-manager' && !person.roomId) errors.push(`${person.id} is a room manager without a room`);
    if (person.role === 'district-manager' && !person.districtId) errors.push(`${person.id} is a district manager without a district`);
  }
  return errors;
}

/** Only simulated records can be changed here; this cannot authorize a real action. */
export function decideDemonstrationReview(review: DemonstrationReview, decision: 'approved' | 'rejected'): DemonstrationReview {
  if (!review.simulation || review.status !== 'awaiting-director-review') throw new Error('Review is not awaiting a simulated director decision');
  return { ...review, status: decision, decisionBy: 'director' };
}
