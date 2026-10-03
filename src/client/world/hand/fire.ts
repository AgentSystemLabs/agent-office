import * as THREE from 'three';

/** Witch-fire curling up round the fingers of each arm that has it, and flickering (retired with Halloween). */
export function burnFire(arms: readonly { side: 1 | -1; fire: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null }[], t: number) {
  for (const arm of arms) {
    const fire = arm.fire;
    if (!fire) continue;
    const pos = fire.geometry.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      const rise = (t * 0.45 + i / n) % 1;
      const a = t * 2.4 * arm.side + (i / n) * Math.PI * 2;
      const r = 0.055 + Math.sin(t * 3 + i * 1.7) * 0.012 - rise * 0.02;
      pos.setXYZ(i, Math.cos(a) * r, -0.015 + rise * 0.11, -0.05 + Math.sin(a) * r * 1.3);
    }
    pos.needsUpdate = true;
    fire.material.opacity = 0.6 + 0.25 * Math.sin(t * 9 + arm.side) + 0.1 * Math.sin(t * 23);
    fire.material.size = 0.028 + 0.006 * Math.sin(t * 5 + arm.side);
  }
}
