import * as THREE from 'three';
import { architectureFor } from './building-definition';

export type BuildingKind = 'town' | 'finance' | 'workshop' | 'standard';
export interface BuildingSpec { id: string; name: string; x: number; z: number; color: string; kind: BuildingKind }
const material = (color: THREE.ColorRepresentation) => new THREE.MeshStandardMaterial({ color, roughness: .76 });
function box(parent: THREE.Object3D, x:number,y:number,z:number,w:number,h:number,d:number,color:THREE.ColorRepresentation) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material(color));
  mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh); return mesh;
}
function person(parent:THREE.Object3D,x:number,z:number,color:string) {
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.23,.27,.65,12),material(color)); body.position.set(x,.96,z);parent.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.24,12,10),material('#edbd9b'));head.position.set(x,1.46,z);parent.add(head);
}
function screen(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,color='#69cabb') {
  box(parent,x,y,z,w,h,.12,'#182734'); box(parent,x,y,z+.07,w*.86,h*.75,.025,color);
}
function glass(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color='#8ed8e0') {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,transparent:true,opacity:.46,metalness:.2,roughness:.18,emissive:'#1b5360',emissiveIntensity:.18}));
  mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function desk(parent:THREE.Object3D,x:number,z:number,w=1.8) {
  box(parent,x,.93,z,w,.13,.85,'#c4ae8e'); for(const dx of [-w*.4,w*.4])box(parent,x+dx,.63,z,.1,.55,.1,'#46505a');
}
export function buildExecutiveBuilding(spec:BuildingSpec):{group:THREE.Group; hit:THREE.Object3D; door:THREE.Group} {
  const group=new THREE.Group();group.position.set(spec.x,0,spec.z);group.userData={id:spec.id,name:spec.name};
  const town=spec.kind==='town', architecture=architectureFor(spec), w=architecture.exteriorWidth,d=architecture.exteriorDepth, wall=town?'#203c53':spec.color, trim=town?'#b99a61':'#b7a98d';
  const hit=box(group,0,.29,0,w,.46,d,town?'#594d42':'#8d8b7c');hit.userData=group.userData;
  box(group,0,.55,0,w-.18,.08,d-.18,town?'#b39f80':'#a9a99b');
  box(group,0,1.72,-d/2+.1,w,2.35,.2,wall);box(group,-w/2+.1,1.72,0,.2,2.35,d,wall);
  box(group,0,2.93,-d/2+.1,w+.12,.18,.27,trim);box(group,-w/2+.1,2.93,0,.27,.18,d,trim);
  for(const x of [-w*.32,w*.32]){box(group,x,1.8,-d/2+.23,1.1,1.15,.08,'#c2a879');box(group,x,1.8,-d/2+.28,.91,.96,.04,'#517987');}
  box(group,0,.34,d/2+.45,town?3:1.7,.22,1,'#a7a69a');box(group,0,.19,d/2+1.1,town?3.6:2,.16,.45,'#aaa99d');
  const door=new THREE.Group();door.name='front-door';door.userData={doorwayWidth:architecture.doorway.width,doorwayHeight:architecture.doorway.height,canonical:true};door.position.z=architecture.doorway.z;group.add(door);
  box(door,0,architecture.doorway.height/2,0,architecture.doorway.width,architecture.doorway.height,.12,trim);
  box(door,0,architecture.doorway.height/2,.07,architecture.doorway.width-.23,architecture.doorway.height-.3,.025,spec.color);
  box(door,-(architecture.doorway.width/2+.18),architecture.doorway.height/2,0,.16,architecture.doorway.height+.17,architecture.doorway.frameDepth,trim);box(door,architecture.doorway.width/2+.18,architecture.doorway.height/2,0,.16,architecture.doorway.height+.17,architecture.doorway.frameDepth,trim);
  for(const x of [-.8,.8]){box(group,x,.88,d/2-.02,.12,.72,.12,trim);box(group,x,1.25,d/2-.02,.21,.13,.2,'#ffdb91');}
  if(town){
    const ground=new THREE.Group(),upper=new THREE.Group();ground.name='town-ground';upper.name='town-upper';group.add(ground,upper);
    // Headquarters-only architecture keeps the common footprint and front approach clear.
    box(group,0,.15,0,w+.18,.2,d+.18,'#302f32');
    // Ceremonial glass-and-metal headquarters language adapted from the architectural reference.
    const roof=box(group,0,4.05,0,w+.75,.34,d+.62,'#b8a474');roof.name='town-roof-slab';
    const roofCap=box(group,0,4.25,0,w+.35,.1,d+.28,'#233b4b');roofCap.name='town-roof-cap';
    const leftFacade=glass(group,-2.35,1.78,d/2-.14,1.0,2.28,.08,'#9bdde1');leftFacade.name='town-glass-facade-left';
    const rightFacade=glass(group,2.35,1.78,d/2-.14,1.0,2.28,.08,'#9bdde1');rightFacade.name='town-glass-facade-right';
    const transom=glass(group,0,architecture.doorway.height+.3,d/2-.14,architecture.doorway.width+1.95,architecture.doorway.transomHeight,.08,'#9bdde1');transom.name='town-glass-transom';
    for(const x of [-2.8,2.8]){box(group,x,1.75,d/2+.02,.24,2.55,.32,'#b6a37d');box(group,x,3.05,d/2+.02,.42,.16,.46,'#e1c889');}
    box(group,0,3.12,d/2+.38,6.5,.22,1.1,'#304a59');
    for(const z of [3.9,4.35,4.8])box(group,0,.22,z,5.9,.16,.28,'#9e9789');
    for(const x of [-4.35,4.35]){
      const wing=new THREE.Mesh(new THREE.CylinderGeometry(1.45,1.45,2.25,24,1,false,0,Math.PI),new THREE.MeshStandardMaterial({color:'#84cbd2',transparent:true,opacity:.54,metalness:.25,roughness:.2}));
      wing.name='town-rounded-boardroom-wing';wing.position.set(x,1.7,.15);wing.rotation.y=x<0?Math.PI/2:-Math.PI/2;wing.castShadow=true;wing.receiveShadow=true;group.add(wing);
      box(group,x,2.92,.15,2.7,.16,2.7,'#b7a276');
    }
    for(const x of [-1.55,1.55]) {box(group,x,1.4,d/2-.16,.22,1.72,.25,'#886c48');box(group,x,2.32,d/2-.16,.38,.15,.36,'#dbbd7c');}
    box(group,0,2.37,d/2-.16,3.35,.18,.36,'#b7975f');
    box(group,0,2.54,d/2-.3,3.5,.12,.76,'#253a49');
    // Stepped-back upper executive floor. Its children use upper-floor local coordinates.
    upper.position.set(0,3.1,-.55);
    box(upper,0,.28,0,8.4,.35,5.4,'#554b3d');
    box(upper,0,.49,0,8.2,.08,5.2,'#c4ae89');
    box(upper,0,1.64,-2.6,8.4,2.25,.18,'#203c53');
    box(upper,-4.1,1.64,0,.18,2.25,5.3,'#203c53');
    box(upper,0,2.81,-2.6,8.6,.14,.3,'#c3a66c');
    box(upper,-4.1,2.81,0,.3,.14,5.4,'#c3a66c');
    const deck=glass(upper,0,1.45,0,7.35,1.55,.06,'#8ed3db');deck.name='town-operations-deck';
    box(upper,0,2.52,0,7.8,.12,.18,'#e0c27d');
    box(upper,0,3.12,-2.6,4.8,.45,.55,'#1a2938');
    box(upper,0,3.43,-2.6,3.4,.17,.65,'#ae8d55');
    box(upper,0,3.7,-2.6,1.6,.42,.7,'#263b4b');
    box(upper,0,3.96,-2.6,1.9,.1,.82,'#d6b56d');
    // Operations office: a generous desk, high-backed chair and district overview.
    box(upper,-2.2,.56,-.9,3.45,.08,3.1,'#7a6654');
    box(upper,-2.2,.86,-.8,2.55,.2,1.05,'#684b38');
    box(upper,-2.2,.98,-.8,2.3,.05,.9,'#c0a071');
    box(upper,-2.2,1.02,-.8,.75,.04,.42,'#38545c');
    box(upper,-2.25,1.05,-1.8,.82,.95,.25,'#26323c');box(upper,-2.25,.66,-1.65,.82,.14,.7,'#394a52');
    screen(upper,-2.2,1.89,-2.42,2.45,1.0,'#67a7ad');
    box(upper,-.35,1.25,-1.3,.18,1.35,2.4,'#a48657');
    box(upper,-.35,1.95,-1.3,.2,.08,2.4,'#d5b879');
    // Briefing zone and a distinctly gold-framed director decision station.
    box(ground,1.35,.85,.15,3.05,.17,1.18,'#76573e');box(ground,1.35,.95,.15,2.8,.05,.96,'#b99a6a');
    for(const x of [.3,1.35,2.4]) for(const z of [-.9,1.2]) {
      box(ground,x,.65,z,.55,.14,.48,'#334350');box(ground,x,.91,z+(z<0?-.22:.22),.55,.52,.1,'#536a75');
    }
    screen(ground,1.4,1.7,-d/2+.34,2.35,.85,'#739eaa');
    desk(ground,-2.9,-1.4,1.8);screen(ground,-2.9,1.7,-d/2+.34,1.7,.7,'#e0b978');
    box(upper,3.65,1.65,-.3,.15,1.55,2.1,'#c8a965');
    box(upper,3.74,1.65,-.3,.06,1.34,1.9,'#193448');
    box(upper,3.78,1.96,-.3,.04,.42,1.55,'#6eaab0');
    box(upper,3.78,1.38,-.75,.04,.3,.55,'#d7b363');
    box(upper,3.78,1.38,.15,.04,.3,.55,'#bd7b66');
    // Elevator representation only: no working lift or collision handling.
    box(group,-4.35,2.85,2.1,1.05,5.05,1.05,'#796544');
    box(group,-4.35,1.25,2.65,.75,1.5,.07,'#233d4c');
    box(group,-4.35,4.35,2.65,.75,1.5,.07,'#233d4c');
    box(group,-4.35,5.7,2.1,1.15,.18,1.15,'#d1ae6e');
    box(group,-4.35,.58,2.1,1.1,.08,1.1,'#b7a37b');
    const warm=new THREE.PointLight('#ffd89a',12,9,2);warm.position.set(-3,3,0);group.add(warm);
  } else if(spec.kind==='finance'){
    desk(group,-1,-.55,1.7);desk(group,1,-.55,1.7);screen(group,-1,1.4,-1.05,1.15,.7,'#4bc5ae');screen(group,1,1.4,-1.05,1.15,.7,'#67bad3');
    screen(group,0,2,-d/2+.32,2.1,.65,'#327e77');person(group,-1,.45,'#456d9d');person(group,1,.45,'#506a83');
  } else if(spec.kind==='workshop'){
    desk(group,-1,-.55,1.8);box(group,-1,1.25,-.5,.55,.45,.45,'#e9b961');box(group,-1,1.52,-.5,.18,.2,.18,'#74b7af');
    box(group,1.5,1.05,-1.3,.75,1.1,.7,'#7d6853');for(let y=0;y<3;y++)box(group,1.5,.7+y*.35,-.9,.65,.08,.08,'#d5b978');
    screen(group,0,2,-d/2+.32,1.6,.65,'#83bbb0');person(group,-1,.55,'#5f9473');
  } else {desk(group,0,-.35);screen(group,0,1.45,-.85,.9,.6);person(group,0,.65,'#487ca2');}
  return {group,hit,door};
}
