import * as THREE from 'three';
import type { DjFrame } from '../dnb';

/**
 * A /party in the chat turns the room into a club (see main.ts): lasers sweeping down from the
 * ceiling, a mirror ball turning in the middle and spots of coloured light chasing across the floor,
 * all on the DJ's beat and in the colour of the track that's on. `level` fades it all in and out.
 */
export interface PartyLights {
  group: THREE.Group;
  update(t: number, frame: DjFrame, level: number): void;
}

/** The room it lights: x and z from min to max, the ceiling at `top`. */
export function buildPartyLights(room: { minX: number; maxX: number; minZ: number; maxZ: number }, top: number): PartyLights {
  const group = new THREE.Group();
  group.visible = false;
  const cx = (room.minX + room.maxX) / 2;
  const cz = (room.minZ + room.maxZ) / 2;
  const w = room.maxX - room.minX;
  const d = room.maxZ - room.minZ;
  const glow = (color: string) =>
    Object.assign(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }), {
      // Light, not a thing: no ink outline round it (see main.ts's outline pass).
      userData: { outlineParameters: { visible: false } },
    });

  // Lasers: thin beams from along the ceiling, each swinging on its own.
  const LASERS = 12;
  const beam = new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true).translate(0, -0.5, 0);
  const lasers = Array.from({ length: LASERS }, (_, i) => {
    const mat = glow('#ff2d95');
    const m = new THREE.Mesh(beam, mat);
    const side = i % 2 ? 1 : -1;
    m.position.set(room.minX + ((i + 0.5) / LASERS) * w, top - 0.15, cz + side * d * 0.32);
    m.scale.set(1, Math.hypot(w, d) * 0.6, 1);
    m.renderOrder = 5;
    group.add(m);
    return { m, mat, phase: i * 1.7, side };
  });

  // The mirror ball, and the sparkles it throws.
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshStandardMaterial({ color: '#d9e1ea', emissive: '#8fa3b8', metalness: 0.9, roughness: 0.15, flatShading: true }));
  ball.position.set(cx, top - 0.9, cz);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.45, 4), new THREE.MeshBasicMaterial({ color: '#2b2d42' }));
  cord.position.set(cx, top - 0.45, cz);
  group.add(ball, cord);

  // Spots of light chasing across the floor.
  const SPOTS = 8;
  const disc = new THREE.CircleGeometry(1.1, 24).rotateX(-Math.PI / 2);
  const spots = Array.from({ length: SPOTS }, (_, i) => {
    const mat = glow('#00e5ff');
    const m = new THREE.Mesh(disc, mat);
    m.renderOrder = 4;
    group.add(m);
    return { m, mat, phase: (i / SPOTS) * Math.PI * 2 };
  });

  const color = new THREE.Color();
  const dir = new THREE.Vector3();
  return {
    group,
    update(t, frame, level) {
      group.visible = level > 0.01;
      if (!group.visible) return;
      const punch = 0.55 + 0.45 * Math.max(frame.kick, frame.snare * 0.8);
      for (const l of lasers) {
        // Swings down across the room and back, one side's beams against the other's.
        const a = t * (0.9 + frame.energy * 0.8) + l.phase;
        dir.set(Math.sin(a) * 0.9, -1, l.side * -0.55 + Math.cos(a * 0.7) * 0.5).normalize();
        l.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
        color.setHSL((frame.hue + l.phase * 0.07 + t * 0.05) % 1, 1, 0.5);
        l.mat.color.copy(color).multiplyScalar(1.6);
        l.mat.opacity = level * punch;
      }
      ball.rotation.y = t * 0.8;
      for (const s of spots) {
        const a = t * 0.45 + s.phase;
        s.m.position.set(cx + Math.sin(a * 1.3) * w * 0.38, 0.03, cz + Math.cos(a) * d * 0.36);
        color.setHSL((frame.hue + s.phase / (Math.PI * 2) + t * 0.08) % 1, 1, 0.5);
        s.mat.color.copy(color);
        s.mat.opacity = level * 0.6 * punch;
      }
    },
  };
}
