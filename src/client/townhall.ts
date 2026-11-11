import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { init, NavMeshQuery } from 'recast-navigation';
import { NavMeshHelper, threeToSoloNavMesh } from '@recast-navigation/three';
import { createWalkabilityTest, getVerticalTransitionLinks, type WalkPoint } from './townhall/walkability-test';
import { getWalkabilityDoorType, isDoorFrameOrMarker, isWalkabilityDoorName } from './townhall/door-classification';
import { openHingedDoor, openSlidingDoor } from './townhall/door-motion';

const canvas = document.querySelector('#townhall') as HTMLCanvasElement;
const runButton = document.querySelector('#run') as HTMLButtonElement;
const overviewButton = document.querySelector('#overview') as HTMLButtonElement;
const status = document.querySelector('#status') as HTMLDivElement;
const report = document.querySelector('#report') as HTMLPreElement;

const WALKABILITY_OPEN_DOORS = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a8c9d8');
scene.fog = new THREE.Fog('#a8c9d8', 45, 110);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 150);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

scene.add(new THREE.HemisphereLight('#ffffff', '#53606b', 2));
const sun = new THREE.DirectionalLight('#fff3d6', 3);
sun.position.set(-20, 30, 15);
sun.castShadow = true;
scene.add(sun);

const shell = new THREE.Group();
shell.name = 'Town_Hall_Blender_Only';
scene.add(shell);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.enabled = false;
// Blender-like inspection controls: drag to orbit, two-finger pinch/scroll to zoom, and
// two-finger/right-button dragging to pan around the building.
orbit.enablePan = true;
orbit.screenSpacePanning = true;
orbit.rotateSpeed = 0.8;
orbit.zoomSpeed = 0.9;
orbit.panSpeed = 0.8;
orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
orbit.mouseButtons.RIGHT = THREE.MOUSE.PAN;
orbit.touches.ONE = THREE.TOUCH.ROTATE;
orbit.touches.TWO = THREE.TOUCH.DOLLY_PAN;
let overview = false;
let buildingBounds = new THREE.Box3();

let meshes: THREE.Mesh[] = [];
let query: NavMeshQuery | undefined;
let helper: NavMeshHelper | undefined;
let walkability: ReturnType<typeof createWalkabilityTest> | undefined;
let player: WalkPoint = { x: 0, y: 0, z: 9 };
let currentPoly = 0;
// Three.js camera yaw 0 looks toward -Z, which is the building's interior direction from the lobby.
// The lobby spawn is on the negative-Z/front side of the GLB; face +Z so W
// moves into the building when the walkthrough begins.
let yaw = Math.PI;
let pitch = -0.08;
const keys = new Set<string>();
const PLAYER_EYE_HEIGHT = 1.4;
const JUMP_SPEED = 5.2;
const GRAVITY = 14;
let jumpOffset = 0;
let jumpVelocity = 0;

const doorOriginalTransforms = new Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();

function isExportHelper(name: string) {
  return name.startsWith('CUTTER_') || name.startsWith('COLL_') || name.startsWith('NAV_');
}

function restoreDoorsToClosedState() {
  for (const [door, original] of doorOriginalTransforms) {
    door.position.copy(original.position);
    door.quaternion.copy(original.quaternion);
    door.scale.copy(original.scale);
    door.updateMatrixWorld(true);
  }
}

function openDoorsForWalkabilityTest() {
  const openedDoors: string[] = [];
  const skippedDoors: string[] = [];
  const warnings: string[] = [];
  let detectedDoors = 0;

  shell.traverse((object) => {
    const name = object.name;
    if (!name || !object.isObject3D) return;
    if (!isWalkabilityDoorName(name) || isDoorFrameOrMarker(name)) return;
    if (!(object instanceof THREE.Mesh)) {
      skippedDoors.push(name);
      return;
    }

    detectedDoors += 1;
    const doorType = getWalkabilityDoorType(name, object.userData);
    if (!doorType) {
      skippedDoors.push(name);
      warnings.push(`Skipped ambiguous door mesh "${name}" without a safe door type.`);
      return;
    }

    if (!doorOriginalTransforms.has(object)) {
      doorOriginalTransforms.set(object, {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });
    }

    if (doorType === 'hinged') openHingedDoor(object);
    else openSlidingDoor(object);
    openedDoors.push(name);
  });

  console.log(`[Town Hall walkability] Doors detected: ${detectedDoors}`);
  console.log('[Town Hall walkability] Doors opened:', openedDoors);
  console.log('[Town Hall walkability] Doors skipped:', skippedDoors);
  if (!openedDoors.length && detectedDoors > 0) {
    console.warn('[Town Hall walkability] No walkability door panels were opened; check the naming and custom properties.');
  }
  if (!detectedDoors) {
    console.warn('[Town Hall walkability] Warning: no door panels were found in the GLB for walkability testing.');
  }
  if (warnings.length) {
    console.warn('[Town Hall walkability] Door warnings:', warnings);
  }
}

function makeMaterialsDoubleSided(object: THREE.Mesh) {
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    material.side = THREE.DoubleSide;
    material.needsUpdate = true;
  }
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function closest(point: WalkPoint) {
  return query?.findClosestPoint(point, { halfExtents: { x: 1.5, y: 2.5, z: 1.5 } });
}

async function buildNavigation() {
  await init();
  const result = threeToSoloNavMesh(meshes, {
    cs: 0.15,
    ch: 0.1,
    walkableSlopeAngle: 45,
    walkableHeight: 18,
    walkableClimb: 4,
    // The exported stair flights are narrower than the surrounding corridors.
    // A 0.30m agent radius (2 recast cells at cs=0.15) keeps them walkable.
    walkableRadius: 2,
    maxEdgeLen: 12,
    maxSimplificationError: 1.3,
    minRegionArea: 8,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
    offMeshConnections: getVerticalTransitionLinks(shell),
  });
  if (!result.success || !result.navMesh) throw new Error(result.error ?? 'Could not build a navigation mesh from the Blender GLB.');
  query = new NavMeshQuery(result.navMesh);
  helper = new NavMeshHelper(result.navMesh, {
    navMeshMaterial: new THREE.MeshBasicMaterial({ color: 0x25d989, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
  });
  helper.name = 'Town_Hall_Walkable_NavMesh';
  helper.renderOrder = 10;
  scene.add(helper);

  const lobbyAnchor = shell.getObjectByName('SPAWN_F1_lobby');
  if (lobbyAnchor) {
    const anchorPosition = new THREE.Vector3();
    lobbyAnchor.getWorldPosition(anchorPosition);
    player = { x: anchorPosition.x, y: anchorPosition.y, z: anchorPosition.z };
  }
  const spawn = closest(player);
  if (!spawn?.success) throw new Error('The Town Hall lobby spawn point is not on a walkable surface.');
  player = spawn.point;
  currentPoly = spawn.polyRef;
  walkability = createWalkabilityTest({
    scene,
    shell,
    camera,
    canvas,
    meshes,
    getQuery: () => query,
    getCurrentPosition: () => player,
  });
}

function runTests() {
  walkability?.runStandardTests();
}

function move(dt: number) {
  if (!query || !currentPoly) return;
  let forward = 0;
  let side = 0;
  if (keys.has('KeyW')) forward += 1;
  if (keys.has('KeyS')) forward -= 1;
  if (keys.has('KeyA')) side -= 1;
  if (keys.has('KeyD')) side += 1;
  if (!forward && !side) return;
  const length = Math.hypot(forward, side);
  forward /= length;
  side /= length;
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 7 : 4.5;
  // Camera forward is local -Z. This keeps W moving where the player is looking.
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const desired = {
    x: player.x + (forward * forwardX + side * rightX) * speed * dt,
    y: player.y,
    z: player.z + (forward * forwardZ + side * rightZ) * speed * dt,
  };
  const nearest = query.findNearestPoly(player, { halfExtents: { x: 1.2, y: 2.5, z: 1.2 } });
  if (!nearest.success) return;
  currentPoly = nearest.nearestRef;
  const start = nearest.isOverPoly ? player : nearest.nearestPoint;
  const moved = query.moveAlongSurface(currentPoly, start, desired, { maxVisitedSize: 1024 });
  if (moved.success) {
    player = moved.resultPosition;
    const after = query.findNearestPoly(player, { halfExtents: { x: 1.2, y: 2.5, z: 1.2 } });
    if (after.success) currentPoly = after.nearestRef;
  }
}

function updateJump(dt: number) {
  if (overview || (jumpOffset <= 0 && jumpVelocity <= 0)) return;
  jumpVelocity -= GRAVITY * dt;
  jumpOffset = Math.max(0, jumpOffset + jumpVelocity * dt);
  if (jumpOffset === 0) jumpVelocity = 0;
}

function draw() {
  if (overview) {
    orbit.update();
    renderer.render(scene, camera);
    return;
  }
  camera.position.set(player.x, player.y + PLAYER_EYE_HEIGHT + jumpOffset, player.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(pitch, yaw, 0);
  renderer.render(scene, camera);
}

function showOverview() {
  overview = !overview;
  document.exitPointerLock();
  orbit.enabled = overview;
  if (overview) {
    const center = buildingBounds.getCenter(new THREE.Vector3());
    const size = buildingBounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 10);
    camera.position.set(center.x + radius * 1.35, center.y + radius * 0.95, center.z + radius * 1.35);
    camera.near = 0.05;
    camera.far = Math.max(150, radius * 8);
    camera.updateProjectionMatrix();
    orbit.target.copy(center);
    orbit.maxDistance = radius * 5;
    orbit.minDistance = Math.max(2, radius * 0.15);
    orbit.update();
    overviewButton.textContent = 'Return to walkthrough';
    status.textContent = 'Exterior overview. Drag to orbit, scroll to zoom, or return to walkthrough.';
  } else {
    overviewButton.textContent = 'View whole building';
    status.textContent = 'Walkthrough mode. Click the building, then use WASD.';
  }
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  move(dt);
  updateJump(dt);
  draw();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => keys.add(event.code));
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || overview) return;
  event.preventDefault();
  if (jumpOffset === 0 && jumpVelocity === 0) jumpVelocity = JUMP_SPEED;
});
canvas.addEventListener('click', () => {
  if (!overview) canvas.requestPointerLock();
});
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= event.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.0022, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
});
// On macOS, a two-finger trackpad drag is delivered as a wheel gesture rather
// than mouse movement. In first-person mode, use that gesture to look around
// even after Escape has released pointer lock.
canvas.addEventListener('wheel', (event) => {
  if (overview) return;
  event.preventDefault();
  const sensitivity = 0.003;
  yaw -= event.deltaX * sensitivity;
  pitch = THREE.MathUtils.clamp(
    pitch - event.deltaY * sensitivity,
    -Math.PI / 2 + 0.05,
    Math.PI / 2 - 0.05,
  );
}, { passive: false });
runButton.addEventListener('click', runTests);
overviewButton.addEventListener('click', showOverview);
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyO') showOverview();
  if (event.code === 'KeyR' && !event.repeat) {
    event.preventDefault();
    walkability?.runStandardTests();
  }
});

resize();
requestAnimationFrame(frame);
// Cache-bust the GLB so every reload fetches the latest Blender export.
const shellUrl = `/town-hall-shell.glb?v=${Date.now()}`;
new GLTFLoader().loadAsync(shellUrl).then(async (gltf) => {
  shell.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    if (isExportHelper(object.name)) {
      object.visible = false;
      return;
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    makeMaterialsDoubleSided(mesh);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
  });
  if (!meshes.length) throw new Error('The GLB loaded, but it contains no mesh geometry.');
  if (WALKABILITY_OPEN_DOORS) {
    openDoorsForWalkabilityTest();
  }
  buildingBounds = new THREE.Box3().setFromObject(shell);
  await buildNavigation();
  status.textContent = 'Ready. Press R or click Run walkability test to start one complete audit.';
}).catch((error: unknown) => {
  status.textContent = 'Could not load the Blender Town Hall.';
  report.textContent = error instanceof Error ? error.message : String(error);
  console.error('[Town Hall walkthrough]', error);
});
