/**
 * Things a controller ray can hit in VR: the terminal panel, a mirrored window, the virtual
 * keyboard, the left-hand palette card. Each frame the XR feature picks the nearest surface under
 * each hand and routes hover / press / scroll to it.
 */
import * as THREE from 'three';
import type { Hand } from './rays';

/** Where a ray meets a surface, in the surface's own UV (0..1) and world distance. */
export interface SurfaceHit {
  u: number;
  v: number;
  distance: number;
}

export interface XrSurface {
  /** Whether the ray should try this surface this frame. */
  active(): boolean;
  /** The mesh to intersect (a plane facing the player, usually). */
  readonly mesh: THREE.Object3D;
  /** Where `raycaster` meets the surface, or null. Call after the rig has moved. */
  hit(raycaster: THREE.Raycaster): SurfaceHit | null;
  /** The hand is pointing here (or nowhere). */
  hover?(hand: Hand, hit: SurfaceHit | null): void;
  /** Trigger / pinch went down or up on this hit. True keeps the press from the office's keys. */
  press?(hand: Hand, hit: SurfaceHit, down: boolean): boolean;
  /** Right stick up/down while pointing here. */
  scroll?(hit: SurfaceHit, dy: number): void;
  /** Once a frame while the surface is up, after hits are known. */
  paint?(now: number): void;
  /** Put away whatever this surface is showing (session end, etc.). */
  close?(): void;
}

/** Intersect a plane mesh and return UV hits (v flipped so 0 is the top, as canvas y). */
export function planeHit(mesh: THREE.Object3D, raycaster: THREE.Raycaster): SurfaceHit | null {
  if (!mesh.visible) return null;
  const [h] = raycaster.intersectObject(mesh, false);
  if (!h?.uv) return null;
  return { u: h.uv.x, v: 1 - h.uv.y, distance: h.distance };
}

/** The nearest active surface each hand points at, and how far. */
export function pickSurfaces(
  surfaces: readonly XrSurface[],
  rays: { rayOf(hand: Hand): THREE.Ray | null },
  raycaster: THREE.Raycaster,
  hands: readonly Hand[],
): Record<Hand, { surface: XrSurface; hit: SurfaceHit } | null> {
  const out: Record<Hand, { surface: XrSurface; hit: SurfaceHit } | null> = { left: null, right: null };
  const live = surfaces.filter((s) => s.active());
  for (const hand of hands) {
    const ray = rays.rayOf(hand);
    if (!ray) continue;
    raycaster.ray.copy(ray);
    let best: { surface: XrSurface; hit: SurfaceHit } | null = null;
    for (const surface of live) {
      const hit = surface.hit(raycaster);
      if (!hit) continue;
      if (!best || hit.distance < best.hit.distance) best = { surface, hit };
    }
    out[hand] = best;
    for (const surface of live) surface.hover?.(hand, best?.surface === surface ? best.hit : null);
  }
  return out;
}
