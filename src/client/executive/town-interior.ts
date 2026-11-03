import * as THREE from 'three';
import { stepTo, type Body } from '../player/collide';
import type { Collider } from '../world/types';
import { architectureFor } from './building-definition';

const wall=(minX:number,maxX:number,minZ:number,maxZ:number):Collider=>({minX,maxX,minZ,maxZ,top:4,fence:true});
const townArchitecture=architectureFor({kind:'town'}), townHalfW=townArchitecture.interiorWidth/2, townHalfD=townArchitecture.interiorDepth/2, townDoorHalf=townArchitecture.doorway.width/2;
const SPAWN_CLEARANCE = .7;
export const interiorColliders:Collider[]=[
  wall(-townHalfW-.1,-townHalfW+.1,-townHalfD,townHalfD),wall(townHalfW-.1,townHalfW+.1,-townHalfD,townHalfD),wall(-townHalfW,townHalfW,-townHalfD-.1,-townHalfD+.1),wall(-townHalfW,-townDoorHalf,townHalfD-.1,townHalfD+.1),wall(townDoorHalf,townHalfW,townHalfD-.1,townHalfD+.1),
];
export const interiorDoorCollider:Collider=wall(-townDoorHalf,townDoorHalf,townHalfD-.1,townHalfD+.1);
export function createInteriorBody():Body{return {pos:new THREE.Vector3(0,0,townArchitecture.interiorThreshold.z-.8),colliders:[...interiorColliders,interiorDoorCollider],grounded:false,stepOffset:0};}
export type InteriorSpawn = {x:number;z:number};

/** Conservative standing clearance used to keep future entry points out of furniture and walls. */
export function isClearInteriorSpawn(point:InteriorSpawn, clearance=SPAWN_CLEARANCE):boolean{
  return !interiorColliders.some((c)=>point.x > c.minX-clearance && point.x < c.maxX+clearance && point.z > c.minZ-clearance && point.z < c.maxZ+clearance);
}

/** Resolve a preferred entry point against the same visible furniture footprints used for movement. */
export function resolveInteriorSpawn(preferred:InteriorSpawn={x:0,z:townArchitecture.interiorThreshold.z-.8}):InteriorSpawn{
  const candidates=[preferred,{x:0,z:townArchitecture.interiorThreshold.z-.8},{x:-3,z:townArchitecture.interiorThreshold.z-.8},{x:3,z:townArchitecture.interiorThreshold.z-.8},{x:0,z:1.5},{x:-3,z:1.5},{x:3,z:1.5}];
  const resolved=candidates.find((candidate)=>isClearInteriorSpawn(candidate));
  if(!resolved)throw new Error('No clear Town Hall interior spawn point is available');
  return resolved;
}

export function moveInterior(body:Body,dx:number,dz:number){const n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.08));for(let i=0;i<n;i++){stepTo(body,body.pos.x+dx/n,body.pos.z);stepTo(body,body.pos.x,body.pos.z+dz/n);}}

/**
 * Legacy compatibility factory. Town Hall no longer renders a second interior
 * scene; first-person mode uses the canonical exterior building group instead.
 * The empty scene remains exportable for older focused tests and callers.
 */
export function createTownInterior(){ return new THREE.Scene(); }
