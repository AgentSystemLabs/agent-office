import * as THREE from 'three';
import { buildExecutiveBuilding } from './building-kit';
import { civicCore } from './campus-layout';

const material = (color: THREE.ColorRepresentation, options: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: .7, ...options });
function box(parent: THREE.Object3D, x:number,y:number,z:number,w:number,h:number,d:number,color:THREE.ColorRepresentation) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material(color)); mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh); return mesh;
}

export function buildCivicCore(scene: THREE.Scene): { townGroup: THREE.Group; townHit: THREE.Object3D; townUpper?: THREE.Object3D; townDoor: THREE.Group; orb: THREE.Mesh } {
  const core = new THREE.Group(); core.name = 'civic-core'; scene.add(core);
  box(core, civicCore.plaza.x, .06, civicCore.plaza.z, civicCore.plaza.width + .5, .12, civicCore.plaza.depth + .5, '#26333b');
  box(core, civicCore.plaza.x, .14, civicCore.plaza.z, civicCore.plaza.width, .08, civicCore.plaza.depth, '#a49e8d');
  for (const x of [-7.5, 7.5]) for (const z of [-24, -18]) {
    const planter = box(core, x, .34, z, 2.2, .45, 1.15, '#53614d');
    planter.material = material('#51634d');
    const shrub = new THREE.Mesh(new THREE.SphereGeometry(.55, 14, 10), material('#4f8f69'));
    shrub.position.set(x, .86, z); shrub.castShadow = true; core.add(shrub);
  }
  const town = buildExecutiveBuilding({ id:'town-hall', name:'Town Hall', x:civicCore.townHall.x, z:civicCore.townHall.z, color:'#203c53', kind:'town' });
  scene.add(town.group);

  const brain = new THREE.Group(); brain.name = 'the-brain'; brain.position.set(civicCore.brain.x, 0, civicCore.brain.z); scene.add(brain);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.35, .55, 48), material('#172b3b')); base.position.y=.28; base.receiveShadow=true; brain.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2,.13,14,64), material('#67d5e5',{emissive:'#1e7f93',emissiveIntensity:.75}));ring.rotation.x=Math.PI/2;ring.position.y=.7;brain.add(ring);
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 2), material('#75e5ed',{emissive:'#247e95',emissiveIntensity:.85,wireframe:true}));orb.position.y=2.25;brain.add(orb);
  const linkCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(civicCore.townHall.x,4,civicCore.townHall.z+3.4),new THREE.Vector3(0,5,-21),new THREE.Vector3(civicCore.brain.x,2.2,civicCore.brain.z));
  const link = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linkCurve.getPoints(36)),new THREE.LineBasicMaterial({color:'#7fdce6',transparent:true,opacity:.42}));scene.add(link);
  return { townGroup: town.group, townHit: town.hit, townUpper: town.group.getObjectByName('town-upper'), townDoor: town.door, orb };
}
