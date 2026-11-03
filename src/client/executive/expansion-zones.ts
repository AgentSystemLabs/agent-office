import * as THREE from 'three';
import { campusBounds, expansionZones } from './campus-layout';

const material = (color: THREE.ColorRepresentation, options: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: .7, ...options });

export function buildExpansionZones(scene: THREE.Scene): THREE.Group {
  const group=new THREE.Group();group.name='expansion-zones';scene.add(group);
  const border=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(campusBounds.width,.08,campusBounds.depth)),new THREE.LineBasicMaterial({color:'#3d6676',transparent:true,opacity:.5}));border.position.y=.03;group.add(border);
  for(const zone of expansionZones){
    if(zone.status==='transit')continue;
    const active=zone.status==='active',connection=zone.status==='connection';
    const platform=new THREE.Mesh(new THREE.CylinderGeometry(connection?1.4:3.1,connection?1.65:3.45,.4,connection?24:8),material(active?'#4c6670':'#263743',{transparent:!active,opacity:active?1:.78}));
    platform.position.set(zone.x,.22,zone.z);platform.rotation.y=Math.PI/8;platform.receiveShadow=true;group.add(platform);
    const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.09,.14,active?4.8:3.2,12),material(active?'#72dcea':'#567b8b',{emissive:active?'#247f91':'#203e4a',emissiveIntensity:.45}));beacon.position.set(zone.x,active?2.7:1.9,zone.z);group.add(beacon);
  }
  return group;
}
