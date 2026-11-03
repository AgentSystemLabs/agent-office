import * as THREE from 'three';
import { stepTo, type Body } from '../player/collide';
import type { Collider } from '../world/types';
import type { CampusBuildingSpec } from './campus-layout';
import { architectureFor } from './building-definition';

const wall = (minX:number,maxX:number,minZ:number,maxZ:number):Collider => ({ minX, maxX, minZ, maxZ, top: 4, fence: true });

export interface PlaceholderInterior { scene: THREE.Scene; colliders: Collider[]; doorCollider: Collider; spawn: { x:number; z:number }; exit: { x:number; z:number } }

export function createPlaceholderInterior(spec: CampusBuildingSpec): PlaceholderInterior {
  const architecture=architectureFor(spec), width=architecture.interiorWidth, depth=architecture.interiorDepth, halfW=width/2, halfD=depth/2, doorHalf=architecture.doorway.width/2;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#142330');
  const material = (color: THREE.ColorRepresentation) => new THREE.MeshStandardMaterial({ color, roughness: .78 });
  const glass = (color: THREE.ColorRepresentation) => new THREE.MeshPhysicalMaterial({ color, roughness: .16, metalness: .08, transmission: .35, transparent: true, opacity: .42 });
  const accent = new THREE.Color(spec.color);
  const box = (x:number,y:number,z:number,w:number,h:number,d:number,color:THREE.ColorRepresentation) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material(color));
    mesh.position.set(x,y,z); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh;
  };
  scene.add(new THREE.HemisphereLight('#fff0d5','#344b54',1.5));
  const key = new THREE.DirectionalLight('#ffdfad',2); key.position.set(-4,8,5); scene.add(key);
  box(0,-.15,0,width,.3,depth,'#8f876f'); box(0,3.5,0,width,.2,depth,'#223542');
  box(-halfW,1.75,0,.2,3.5,depth,'#1e374b'); box(halfW,1.75,0,.2,3.5,depth,'#1e374b');
  box(0,1.75,-halfD,width,3.5,.2,'#1e374b');
  const frameColor = '#6f8790';
  const frontPanelWidth = Math.max(0, (width - architecture.doorway.width) / 2);
  box(-(architecture.doorway.width / 2 + frontPanelWidth / 2),1.75,halfD,frontPanelWidth,3.5,.2,frameColor);
  box(architecture.doorway.width / 2 + frontPanelWidth / 2,1.75,halfD,frontPanelWidth,3.5,.2,frameColor);
  box(0,2.95,halfD,architecture.doorway.width,1.1,.2,frameColor);
  const door = new THREE.Mesh(new THREE.BoxGeometry(architecture.doorway.width, architecture.doorway.height, .08), glass(accent));
  door.name = 'placeholder-interior-door'; door.position.set(0, architecture.doorway.height / 2, halfD - .04); door.castShadow = true; scene.add(door);
  box(-(architecture.doorway.width / 2 + .1), architecture.doorway.height / 2, halfD - .08, .12, architecture.doorway.height + .18, .16, frameColor);
  box(architecture.doorway.width / 2 + .1, architecture.doorway.height / 2, halfD - .08, .12, architecture.doorway.height + .18, .16, frameColor);
  box(-1.25,.72,-.75,1.6,1.44,.75,'#6c533f'); box(-1.25,1.48,-.75,1.7,.1,.85,'#c4a678');
  box(1.25,.72,-.75,1.6,1.44,.75,'#6c533f'); box(1.25,1.48,-.75,1.7,.1,.85,'#c4a678');
  box(0,1.7,-halfD+.16,width-1.2,1.25,.08,'#182b37'); box(0,1.72,-halfD+.1,width-1.7,1.05,.04,accent);
  box(Math.max(1,halfW-1),.86,Math.max(1,halfD-1),.75,.15,.75,accent); box(Math.max(1,halfW-1),1.45,Math.max(1,halfD-1),.08,1.05,.75,'#36525d');
  const doorCollider=wall(-doorHalf,doorHalf,halfD-.2,halfD+.1);
  const colliders = [wall(-halfW-.1,-halfW+.1,-halfD,halfD), wall(halfW-.1,halfW+.1,-halfD,halfD), wall(-halfW,halfW,-halfD-.1,-halfD+.1), wall(-halfW,-doorHalf,halfD-.1,halfD+.1), wall(doorHalf,halfW,halfD-.1,halfD+.1), doorCollider, wall(-2,-.5,-1.2,-.4), wall(.5,2,-1.2,-.4)];
  const label = new THREE.Mesh(new THREE.PlaneGeometry(2.8,.45), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: .9 }));
  label.position.set(0,2.35,-halfD+.1); scene.add(label);
  return { scene, colliders, doorCollider, spawn: { x: architecture.interiorThreshold.x, z: architecture.interiorThreshold.z-.8 }, exit: architecture.interiorThreshold };
}

export function movePlaceholder(body: Body, dx:number, dz:number) {
  const n = Math.max(1, Math.ceil(Math.hypot(dx,dz) / .08));
  for (let i=0;i<n;i++) { stepTo(body, body.pos.x + dx/n, body.pos.z); stepTo(body, body.pos.x, body.pos.z + dz/n); }
}
