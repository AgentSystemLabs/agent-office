export type OfficeZoneType = 'training' | 'main';

export interface OfficeZone {
  id: string;
  type: OfficeZoneType;
  name: string;
  description?: string;
  order: number;
  departmentIds: string[];
}

export interface OfficeStructure {
  zones: OfficeZone[];
  departments: import('./departments.js').Department[];
  /** Floor IDs map to a department. Missing IDs belong to Main Office / Software Engineering. */
  floorDepartments: Record<string, string>;
}
