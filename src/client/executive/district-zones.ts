import * as THREE from 'three';
import { districtPlots } from './campus-layout';

const material = (color: THREE.ColorRepresentation, options: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: .76, ...options });

export function buildDistrictZones(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group(); group.name = 'district-zones'; scene.add(group);
  for (const plot of districtPlots) {
    const foundation = new THREE.Mesh(new THREE.BoxGeometry(plot.width, .26, plot.depth), material('#233139'));
    foundation.position.set(plot.x,.08,plot.z); foundation.receiveShadow=true; group.add(foundation);
    const inset = new THREE.Mesh(new THREE.BoxGeometry(plot.width-.55,.08,plot.depth-.55),material(plot.accent,{transparent:true,opacity:.2,emissive:plot.accent,emissiveIntensity:.08}));
    inset.position.set(plot.x,.25,plot.z); group.add(inset);
    const coordination = new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.35,.16,28),material('#34434a'));
    coordination.position.set(plot.managerPoint.x,.35,plot.managerPoint.z);coordination.receiveShadow=true;group.add(coordination);
    const marker = new THREE.Mesh(new THREE.RingGeometry(1.05,1.2,32),new THREE.MeshBasicMaterial({color:plot.accent,transparent:true,opacity:.7,side:THREE.DoubleSide}));
    marker.rotation.x=-Math.PI/2;marker.position.set(plot.managerPoint.x,.45,plot.managerPoint.z);group.add(marker);
    for (const point of plot.connectionPoints) {
      const node = new THREE.Mesh(new THREE.CylinderGeometry(.22,.3,.25,14),material(plot.accent,{emissive:plot.accent,emissiveIntensity:.25}));
      node.position.set(point.x,.33,point.z);group.add(node);
    }
    if (plot.activeRoomIds.length === 0) {
      const placeholder = new THREE.Group();placeholder.position.set(plot.x,0,plot.z);group.add(placeholder);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(6.8,.38,5.2),material('#4c5960'));floor.position.y=.42;floor.receiveShadow=true;placeholder.add(floor);
      const glass = material(plot.accent,{transparent:true,opacity:.28,metalness:.25,roughness:.28});
      const rear=new THREE.Mesh(new THREE.BoxGeometry(6.8,2.8,.22),glass);rear.position.set(0,1.8,-2.45);placeholder.add(rear);
      const side=new THREE.Mesh(new THREE.BoxGeometry(.22,2.8,5),glass);side.position.set(-3.3,1.8,0);placeholder.add(side);
      const canopy=new THREE.Mesh(new THREE.BoxGeometry(5.4,.16,1.1),material('#738087'));canopy.position.set(.35,2.8,-1.95);placeholder.add(canopy);
    }
  }
  return group;
}
