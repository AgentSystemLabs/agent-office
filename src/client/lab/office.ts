import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildOffice } from '../world/office';
import { preloadModels } from '../world/models';
import { FLOOR_PALETTES } from '../../shared/floors';
import { ready } from './stage';

await preloadModels();
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas')!, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0e1724');
scene.add(new THREE.HemisphereLight('#d5edff', '#233549', 2.3));
const sun = new THREE.DirectionalLight('#dcecff', 2.4);
sun.position.set(-12, 25, 4);
scene.add(sun);
const office = buildOffice();
office.setLook(FLOOR_PALETTES[0]);
const interior = new URLSearchParams(location.search).get('interior');
const setInterior = (modern: boolean) => {
  office.setInterior(modern);
  document.getElementById('classic')!.setAttribute('aria-pressed', String(!modern));
  document.getElementById('future')!.setAttribute('aria-pressed', String(modern));
};
document.getElementById('classic')!.onclick = () => setInterior(false);
document.getElementById('future')!.onclick = () => setInterior(true);
setInterior(interior !== 'original');
(window as unknown as { officeLab: typeof office }).officeLab = office;
office.danceFloor.group.visible = false;
scene.add(office.group);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 400);
const view = new URLSearchParams(location.search).get('view');
camera.position.set(view === 'meeting' ? 3 : -12, 2.3, view === 'meeting' ? 5 : 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(view === 'meeting' ? 13 : -1, 2.1, view === 'meeting' ? 10 : -5);
controls.update();
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
ready({ desks: office.desks.size, interactables: office.interactables.length, colliders: office.colliders.length, style: interior === 'original' ? 'Original' : 'Futuristic' });
