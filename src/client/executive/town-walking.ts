import * as THREE from 'three';
import { stepTo, type Body } from '../player/collide';
import type { Collider } from '../world/types';

// Ground-floor demonstration footprints, in campus world coordinates.
const solid = (minX:number,maxX:number,minZ:number,maxZ:number):Collider => ({minX,maxX,minZ,maxZ,top:3.3,fence:true});
export const townColliders: Collider[] = [
  solid(-5.2,5.2,-13.7,-13.3), solid(-5.2,-4.8,-13.5,-6.5),
  solid(4.8,5.2,-13.5,-6.5), solid(-5,-1.65,-6.7,-6.3), solid(1.65,5,-6.7,-6.3),
  solid(-3.8,-2,-11.83,-10.97), // intake desk
  solid(-4.88,-3.82,-8.43,-7.37), // elevator
  solid(-.18,2.88,-10.44,-9.26), // briefing table
  ...[.3,1.35,2.4].flatMap(x=>[-10.9,-8.8].map(z=>solid(x-.3,x+.3,z-.3,z+.3))),
];
export function createTownBody():Body { return {pos:new THREE.Vector3(0,.6,-5.15),colliders:townColliders,grounded:false,stepOffset:0}; }
export function moveTownBody(body:Body,dx:number,dz:number):void {
  // Axis-separated small increments avoid tunneling and let the avatar slide along obstacles.
  const count=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.12));
  for(let i=0;i<count;i++){stepTo(body,body.pos.x+dx/count,body.pos.z);stepTo(body,body.pos.x,body.pos.z+dz/count);}
  body.pos.x=THREE.MathUtils.clamp(body.pos.x,-5.3,5.3);body.pos.z=THREE.MathUtils.clamp(body.pos.z,-13.8,-4.7);
}
