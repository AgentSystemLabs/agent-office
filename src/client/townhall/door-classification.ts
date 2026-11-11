export type DoorType = 'hinged' | 'sliding';

function normalizeDoorName(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

export function isWalkabilityDoorName(name: string) {
  const normalized = normalizeDoorName(name);
  return /(^|_)DOOR(_|$)/.test(normalized) || /(^|_)(SLID|HINGE)(_|$)/.test(normalized);
}

export function isDoorFrameOrMarker(name: string) {
  const normalized = normalizeDoorName(name);
  return ['FRAME', 'MARKER', 'ANCHOR', 'SPAWN', 'SIGN', 'DECOR', 'EMPTY', 'HANDLE', 'KNOB'].some((part) =>
    normalized.includes(part),
  );
}

export function getWalkabilityDoorType(name: string, customData: Record<string, unknown> = {}): DoorType | null {
  const values = [
    customData.door_type,
    customData.doorType,
    customData.type,
    customData.mesh_type,
    customData.animationType,
    customData.anim_type,
    customData.door_kind,
  ];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.toLowerCase();
    if (normalized.includes('slid')) return 'sliding';
    if (normalized.includes('hinge')) return 'hinged';
  }

  const normalized = normalizeDoorName(name);
  if (normalized.includes('SLID') || normalized.includes('ELEVATOR_DOOR')) return 'sliding';
  if (normalized.includes('HINGE') || (normalized.includes('DOOR') && normalized.includes('LEAF'))) return 'hinged';
  if (normalized.includes('DOOR') && /(^|_)(LEFT|RIGHT)(_|$)/.test(normalized)) return 'hinged';
  return null;
}
