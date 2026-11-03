import { CASTLE } from './castle.js';
import type { MapConfig } from './types.js';

/**
 * Executive World is registered through the normal Agent Office map lifecycle.
 */
export const EXECUTIVE: MapConfig = {
  ...CASTLE,
  id: 'executive',
  name: 'Executive World',
  icon: '🏛️',
  description: 'Executive World master-campus overview. Building-to-floor links are explicitly labeled until connected.',
  style: 'executive',
  hall: { width: 96, length: 78, height: 14 },
  // Start the integrated browser review in the open civic campus, not at the Town Hall door.
  // The Executive World feature applies its wide overview camera to this safe ground position.
  spawn: { x: 0, z: 0, rotY: Math.PI },
  door: { x: 0, z: -22, rotY: Math.PI },
  throne: undefined,
  herald: undefined,
  lineup: undefined,
};
