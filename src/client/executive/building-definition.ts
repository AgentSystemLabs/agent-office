import type { BuildingSpec } from './building-kit';

export interface BuildingArchitecture {
  exteriorWidth: number;
  exteriorDepth: number;
  interiorWidth: number;
  interiorDepth: number;
  wallThickness: number;
  floorHeight: number;
  doorway: { x: number; z: number; width: number; height: number; frameDepth: number; transomHeight: number };
  exteriorThreshold: { x: number; z: number };
  interiorThreshold: { x: number; z: number };
  roomOrientation: 'front-facing';
  doorSlideDirection: 'right';
  doorSlideDistance: number;
}

export function architectureFor(spec: Pick<BuildingSpec, 'kind'>): BuildingArchitecture {
  const town = spec.kind === 'town';
  const exteriorWidth = town ? 10 : 5.6;
  const exteriorDepth = town ? 7 : 4.4;
  const wallThickness = town ? .2 : .2;
  const doorwayWidth = town ? 1.55 : 1.25;
  const doorwayHeight = town ? 2.18 : 2.18;
  const doorwayZ = exteriorDepth / 2 + .08;
  return {
    exteriorWidth,
    exteriorDepth,
    interiorWidth: exteriorWidth - wallThickness * 2,
    interiorDepth: exteriorDepth - wallThickness * 2,
    wallThickness,
    floorHeight: .3,
    doorway: { x: 0, z: doorwayZ, width: doorwayWidth, height: doorwayHeight, frameDepth: .2, transomHeight: .48 },
    exteriorThreshold: { x: 0, z: doorwayZ + .5 },
    interiorThreshold: { x: 0, z: exteriorDepth / 2 - wallThickness - .15 },
    roomOrientation: 'front-facing',
    doorSlideDirection: 'right',
    doorSlideDistance: doorwayWidth * 2.1,
  };
}
