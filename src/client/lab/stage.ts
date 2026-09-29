import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { toon } from '../world/toon';

// What every lab page shows its models on: lit and outlined like the office (see main.ts), on a floor
// with a half-meter grid, to judge sizes and whether feet slide.

export interface Stage {
  renderer: THREE.WebGLRenderer;
  effect: OutlineEffect;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  floor: THREE.Mesh;
  /** Draws one frame. */
  render(): void;
}

/** `showFloor` false leaves only the grid, to see what goes under the floor. */
export function stage(canvas: HTMLCanvasElement, showFloor = true): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const effect = new OutlineEffect(renderer, { defaultThickness: 0.0032, defaultColor: [0.17, 0.18, 0.26] });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bfe3ff');
  scene.add(new THREE.HemisphereLight('#fff5e6', '#c9a27a', 1.5), new THREE.AmbientLight('#ffffff', 0.5));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
  sun.position.set(-8, 18, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 50 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), toon('#e8d3b0'));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.visible = showFloor;
  scene.add(floor);
  const grid = new THREE.GridHelper(200, 400, '#dcc39c', '#dcc39c');
  grid.position.y = 0.002;
  scene.add(grid);

  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 200);
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
  return { renderer, effect, scene, camera, sun, floor, render: () => effect.render(scene, camera) };
}

/** Sets window.__ready, which the screenshot helper (shot.mjs) waits for and prints. */
export function ready(facts: Record<string, unknown>) {
  (window as unknown as { __ready: unknown }).__ready = facts;
}
