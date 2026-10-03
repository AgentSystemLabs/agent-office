import * as THREE from 'three';
import { ARENA, type FpsShot } from '../../../shared/fps';

export type ImpactKind = 'body' | 'head' | 'metal' | 'wood' | 'stone';

/** Classify the server's endpoint, never the client's crosshair or a rendered character. */
export function impactKind(shot: FpsShot): ImpactKind | null {
  if (shot.hit) return shot.headshot ? 'head' : 'body';
  const p = shot.to;
  const solid = ARENA.find(b => Math.abs(p.x - b.x) <= b.w / 2 + .001
    && Math.abs(p.y - b.y) <= b.h / 2 + .001 && Math.abs(p.z - b.z) <= b.d / 2 + .001);
  return solid ? solid.kind === 'container' ? 'metal' : solid.kind === 'crate' ? 'wood' : 'stone' : null;
}

interface Burst { points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>; velocity: Float32Array; age: number; duration: number }

/** Small, depth-tested contact bursts. All motion is visual; no camera or gameplay state is touched. */
export class FpsImpacts {
  readonly root = new THREE.Group();
  private bursts: Burst[] = [];

  emit(shot: FpsShot, kind: ImpactKind) {
    // Bound GPU resources even if both players keep firing into cover.
    if (this.bursts.length >= 12) this.remove(this.bursts.shift()!);
    const blood = kind === 'body' || kind === 'head';
    const count = kind === 'head' ? 12 : blood ? 8 : 5;
    const duration = blood ? .28 : .16;
    const positions = new Float32Array(count * 3), velocity = new Float32Array(count * 3);
    const outward = new THREE.Vector3(shot.from.x - shot.to.x, shot.from.y - shot.to.y, shot.from.z - shot.to.z).normalize();
    const side = new THREE.Vector3().crossVectors(outward, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < .001) side.set(1, 0, 0); else side.normalize();
    const up = new THREE.Vector3().crossVectors(side, outward).normalize();
    for (let i = 0; i < count; i++) {
      const v = outward.clone().multiplyScalar(.6 + Math.random() * .9)
        .addScaledVector(side, (Math.random() - .5) * 2).addScaledVector(up, (Math.random() - .3) * 1.6);
      v.toArray(velocity, i * 3);
      positions.set([shot.to.x + outward.x * .025, shot.to.y + outward.y * .025, shot.to.z + outward.z * .025], i * 3);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const color = blood ? '#b92332' : kind === 'metal' ? '#ffdb86' : kind === 'wood' ? '#caac77' : '#d2d1c4';
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: blood ? .065 : .04, transparent: true, depthWrite: false }));
    points.frustumCulled = false; // The vertices move during their short lifetime.
    this.root.add(points); this.bursts.push({ points, velocity, age: 0, duration });
  }

  update(dt: number) {
    for (const burst of [...this.bursts]) {
      burst.age += dt;
      if (burst.age >= burst.duration) { this.bursts.splice(this.bursts.indexOf(burst), 1); this.remove(burst); continue; }
      const position = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i++) {
        const j = i * 3; burst.velocity[j + 1] -= 3 * dt;
        position.setXYZ(i, position.getX(i) + burst.velocity[j] * dt,
          position.getY(i) + burst.velocity[j + 1] * dt, position.getZ(i) + burst.velocity[j + 2] * dt);
      }
      position.needsUpdate = true; burst.points.material.opacity = 1 - burst.age / burst.duration;
    }
  }

  clear() { for (const burst of this.bursts) this.remove(burst); this.bursts = []; }
  private remove(burst: Burst) { this.root.remove(burst.points); burst.points.geometry.dispose(); burst.points.material.dispose(); }
}
