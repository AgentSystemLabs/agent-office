/**
 * What the office is drawn on and with: the renderer on its canvas, the scene and its lights, the
 * camera, the office building, the sky and the holiday decorations.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { store } from '../state';
import { Holiday } from '../world/holiday';
import { buildOffice } from '../world/office';
import type { Office } from '../world/types';
import { HAZE_MAX, Sky } from '../world/sky';
import type { Ctx } from './context';
import { Post } from './post';

/** How far the camera sees in the office: as far as the haze ever is, from the top floor. */
export const FAR = HAZE_MAX + 20;
/** How wide the camera sees (degrees), unless what you're doing has it otherwise (see ctx.view). */
export const FOV = 55;

/** The renderer, the scene with its lights and camera, and what's always in it (see createScene). */
export interface Stage {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  /** Draws the scene with its finish: occlusion, bloom, tone mapping (see drawFrame in core/loop.ts). */
  readonly post: Post;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  /** The sun by day and the moon by night; the sky moves it (world/sky.ts). */
  readonly sun: THREE.DirectionalLight;
  readonly office: Office;
  readonly sky: Sky;
  /** Halloween or Christmas decorations, up while the building's dressed up for one (see dressUp in features/workers/views.ts). */
  readonly holiday: Holiday;
}

export function makeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer | null {
  try {
    return new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    console.error(err);
    return null;
  }
}

/** No WebGL here (switched off, or no graphics for it): on to the 2D view, which does without. */
export function noWebGL(): Promise<never> {
  location.replace('/lite?why=webgl');
  return new Promise(() => {});
}

/** Sets up the renderer on `canvas`, and builds the scene: its lights, the camera, the office, the sky. */
export function createScene(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer): Stage {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Realistic look: filmic tone mapping, applied by the post pass (core/post.ts).
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;

  const scene = new THREE.Scene();
  // The sky's color and the fog change with the time of day and the weather (world/sky.ts).
  scene.background = new THREE.Color('#bfe3ff');
  scene.fog = new THREE.Fog('#bfe3ff', 40, 90);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, FAR);
  // Image-based light: soft sky and bounce reflections on every surface.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight('#fff5e6', '#c9a27a', 0.5);
  const ambient = new THREE.AmbientLight('#ffffff', 0.15);
  scene.add(hemi, ambient);
  // The sun by day and the moon by night; the sky moves it (world/sky.ts).
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
  sun.position.set(-8, 18, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.radius = 3;
  // Wide enough for the office, the garage under it and the balcony and lot out front, from wherever the sun is.
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 30, bottom: -30, near: 1, far: 100 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const office = buildOffice();
  scene.add(office.group);
  const sky = new Sky(scene, { sun, hemi, ambient }, office.night, () => store.officeNow());
  // Halloween or Christmas decorations, up while the building's dressed up for one (see dressUp).
  const holiday = new Holiday(office);
  scene.add(holiday.group);

  const post = new Post(renderer, scene, camera);
  return { canvas, renderer, post, scene, camera, hemi, ambient, sun, office, sky, holiday };
}

/** The sky follows the office's weather and time of day, and its thunder is heard. */
export function installSky(ctx: Ctx) {
  const { sky } = ctx;
  store.on('sky', () => store.sky && sky.set(store.sky));
  sky.onThunder = (delay, loud) => ctx.sound.thunder(delay, loud);
}

/** The canvas and the camera (and your hands' own camera) fit the window, and keep fitting it. */
export function fitWindow(ctx: Ctx) {
  function resize() {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    ctx.renderer.setSize(w, hgt, false);
    ctx.post.setSize(w, hgt);
    ctx.camera.aspect = w / hgt;
    ctx.camera.updateProjectionMatrix();
    ctx.hands.setAspect(w / hgt);
  }
  window.addEventListener('resize', resize);
  resize();
}
