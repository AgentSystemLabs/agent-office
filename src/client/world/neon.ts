// The Neon HQ look (⚙️ → Theme): light strips, hologram signs and a grid floor round the hall, and a
// purple dusk painted over the sky's light each frame (as a map's own mood paints it, see world.ts).
import * as THREE from 'three';
import { FLOOR, WALL_HEIGHT } from '../../shared/layout';
import type { ActiveTheme } from '../../shared/protocol';
import { textPlane } from './toon';

const MAGENTA = '#ff2a6d';
const CYAN = '#05d9e8';
const NEON_HEMI = new THREE.Color('#3a1d6e'); // violet sky light
const NEON_AMBIENT = new THREE.Color('#241238');
const NEON_SUN = new THREE.Color('#c56bff');
const NEON_FOG = new THREE.Color('#2a0f3d'); // purple fog and background

/** The lights the sky sets each frame (see Stage). */
export interface NeonParts {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  scene: THREE.Scene;
}

/** Paints the neon dusk over what the sky just set: 0 leaves it exactly as it was, 1 is full neon. */
export function neonLight(fade: number, { sun, hemi, ambient, scene }: NeonParts): void {
  // Sky.update() rewrites these each frame (world/sky.ts), so tinting after it is idempotent and fades out cleanly.
  hemi.color.lerp(NEON_HEMI, fade * 0.6);
  ambient.color.lerp(NEON_AMBIENT, fade * 0.5);
  sun.color.lerp(NEON_SUN, fade * 0.6);
  sun.intensity *= 1 - 0.5 * fade;
  hemi.intensity *= 1 - 0.3 * fade;
  ambient.intensity *= 1 - 0.2 * fade;
  if (scene.fog instanceof THREE.Fog) scene.fog.color.lerp(NEON_FOG, fade * 0.75);
  if (scene.background instanceof THREE.Color) scene.background.lerp(NEON_FOG, fade * 0.7);
}

export class Neon {
  readonly group = new THREE.Group();
  /** The strips and sign backings, whose glow breathes in update(). */
  private readonly pulse: THREE.MeshBasicMaterial[] = [];
  /** Picked the Neon HQ look (see set); shown() also needs you somewhere it dresses. */
  active = false;
  private fade = 0;

  /** `withSigns` false skips the canvas-drawn signs: model tests run without a DOM. */
  constructor(withSigns = true) {
    // Visibility belongs to the frame loop (core/loop.ts updateSky), like the holiday's.
    this.group.visible = false;
    const w = FLOOR.maxX - FLOOR.minX;
    const d = FLOOR.maxZ - FLOOR.minZ;
    const midX = (FLOOR.minX + FLOOR.maxX) / 2;
    const midZ = (FLOOR.minZ + FLOOR.maxZ) / 2;
    for (const y of [WALL_HEIGHT - 0.5, 0.04]) {
      const color = y > 1 ? MAGENTA : CYAN;
      this.strip(w - 1, 0.08, 0.08, color, midX, y, FLOOR.maxZ - 0.3);
      this.strip(w - 1, 0.08, 0.08, color, midX, y, FLOOR.minZ + 0.3);
      this.strip(0.08, 0.08, d - 1, color, FLOOR.maxX - 0.3, y, midZ);
      this.strip(0.08, 0.08, d - 1, color, FLOOR.minX + 0.3, y, midZ);
    }
    // Lasers across the ceiling too, like the reel's, so the hall reads from the elevator doors.
    for (const z of [-6, 0, 6]) this.strip(w - 1, 0.08, 0.08, MAGENTA, midX, WALL_HEIGHT - 0.5, z);

    // A dark grid just over the floor, so it reads wet without a renderer overhaul.
    const grid = new THREE.GridHelper(w, w * 2, MAGENTA, '#3d1660');
    grid.position.set(midX, 0.015, midZ);
    grid.scale.z = d / w;
    for (const m of Array.isArray(grid.material) ? grid.material : [grid.material]) {
      m.transparent = true;
      m.opacity = 0.3;
      m.depthWrite = false;
    }
    this.group.add(grid);

    if (withSigns) {
      // On the far wall above the windows, facing back down the hall so they're read coming in.
      const panel = new THREE.MeshBasicMaterial({ color: '#1b0733', transparent: true, opacity: 0.45, depthWrite: false });
      for (const [text, x] of [['COMPLIANCE', -11], ['AGENTS', -5.5], ['IT', 0]] as const) {
        const z = FLOOR.maxZ - 0.15;
        const sign = textPlane(text, { color: CYAN, size: 120 });
        const { width, height } = sign.geometry.parameters;
        const backing = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.6, height + 0.4), panel);
        backing.position.set(x, 5.4, z);
        sign.position.set(x, 5.4, z - 0.02);
        backing.rotation.y = sign.rotation.y = Math.PI;
        this.group.add(backing, sign);
      }
    }

    // Two unshadowed lights: the glow, not more shadows to draw.
    const pink = new THREE.PointLight(MAGENTA, 12, 30, 2);
    pink.position.set(-9, 5, midZ);
    const blue = new THREE.PointLight(CYAN, 8, 30, 2);
    blue.position.set(9, 5, midZ);
    this.group.add(pink, blue);
  }

  set(theme: ActiveTheme | null): void {
    this.active = theme === 'neon';
  }

  /** Whether the look (and its dusk over the view) belongs here: picked, and in the office, not on the roof. */
  shown(upTop: boolean, inOffice: boolean): boolean {
    return this.active && !upTop && inOffice;
  }

  update(t: number, parts: NeonParts): void {
    this.fade += ((this.active ? 1 : 0) - this.fade) * 0.02;
    neonLight(this.fade, parts);
    this.pulse.forEach((m, i) => (m.opacity = 0.65 + 0.3 * Math.sin(t * 2 + i)));
  }

  private strip(w: number, h: number, d: number, color: string, x: number, y: number, z: number): void {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.glow(color, 0.8));
    strip.position.set(x, y, z);
    this.group.add(strip);
  }

  private glow(color: string, opacity: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    this.pulse.push(m);
    return m;
  }
}
