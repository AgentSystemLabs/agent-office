export type VehicleKind = 'lambo' | 'ferrari';

export interface VehicleDef { id: string; kind: VehicleKind; color: string; x: number; z: number; rotY: number }

/** Stable spawn points for the garage's supercars. */
export const VEHICLES: readonly VehicleDef[] = [
  { id: 'lambo-lime', kind: 'lambo', color: '#8ac926', x: -14.4, z: -7.1, rotY: Math.PI },
  { id: 'lambo-orange', kind: 'lambo', color: '#ff7b00', x: -8, z: -7.1, rotY: Math.PI },
  { id: 'lambo-yellow', kind: 'lambo', color: '#ffd000', x: 1.6, z: -7.1, rotY: Math.PI },
  { id: 'lambo-purple', kind: 'lambo', color: '#7b2cbf', x: 11.2, z: -7.1, rotY: Math.PI },
  { id: 'ferrari-red-1', kind: 'ferrari', color: '#d90429', x: -14.4, z: 7.05, rotY: 0 },
  { id: 'ferrari-red-2', kind: 'ferrari', color: '#d90429', x: -4.8, z: 7.05, rotY: 0 },
  { id: 'ferrari-yellow', kind: 'ferrari', color: '#ffc300', x: 4.8, z: 7.05, rotY: 0 },
  { id: 'ferrari-coral', kind: 'ferrari', color: '#e5383b', x: 14.4, z: 7.05, rotY: 0 },
  { id: 'lambo-blue', kind: 'lambo', color: '#00b4d8', x: 9, z: 18.2, rotY: Math.PI / 2 },
] as const;

export const VEHICLE_IDS = new Set(VEHICLES.map((v) => v.id));
