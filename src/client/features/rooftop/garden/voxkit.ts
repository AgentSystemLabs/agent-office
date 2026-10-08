import * as THREE from 'three';
import { Vox } from '../../../world/vox';

// The tools the garden's plants are built with: a painter that lays tiny blocks along lines and curves,
// fronds, broad leaves and trunks made of them, and a batch that stamps each finished plant (built once,
// then shared) wherever it grows.

export type V3 = [number, number, number];
const [CA, CB] = [new THREE.Color(), new THREE.Color()];
export const mix = (a: string, b: string, t: number): string => '#' + CA.set(a).lerp(CB.set(b), Math.min(1, Math.max(0, t))).getHexString();
const lerp = THREE.MathUtils.lerp;

export class Paint {
  readonly v: Vox;
  constructor(readonly s: number, jitter = 0.09) {
    this.v = new Vox(s, jitter);
  }
  dot(x: number, y: number, z: number, c: string) {
    this.v.put(Math.floor(x / this.s), Math.floor(y / this.s), Math.floor(z / this.s), c);
  }
  line(a: V3, b: V3, c: string | ((t: number) => string)) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (this.s * 0.5)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.dot(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), typeof c === 'string' ? c : c(t));
    }
  }
}

/** A path rising from base at an angle (pitch) along a heading (yaw; 0 is +z) and bending down by droop. */
export function spine(base: V3, yaw: number, pitch: number, len: number, droop: number) {
  const [dx, dz, c, sn] = [Math.sin(yaw), Math.cos(yaw), Math.cos(pitch), Math.sin(pitch)];
  return { dx, dz, at: (t: number): V3 => [base[0] + dx * len * c * t, base[1] + len * (sn * t - droop * t * t), base[2] + dz * len * c * t] };
}

export interface FrondOpts {
  pairs: number;
  leaf: number;
  sweep: number;
  drop: number;
  rib: string;
  a: string;
  b: string;
}

/** A feathery frond: a rib with a row of leaflets down each side, each a short line of blocks drooping away. */
export function frond(p: Paint, base: V3, yaw: number, pitch: number, len: number, droop: number, o: FrondOpts) {
  const sp = spine(base, yaw, pitch, len, droop);
  const [px, pz] = [sp.dz, -sp.dx];
  p.line(sp.at(0), sp.at(1), (t) => mix(o.rib, o.b, t * 0.8));
  for (let k = 1; k <= o.pairs; k++) {
    const t = 0.06 + (0.94 * k) / o.pairs;
    const q = sp.at(t);
    const ll = o.leaf * Math.min(1, t / 0.2) * (1 - 0.7 * t * t);
    const col = mix(o.a, o.b, t);
    for (const side of [-1, 1]) {
      const [ox, oz] = [(px * Math.cos(o.sweep) * side + sp.dx * Math.sin(o.sweep)) * ll, (pz * Math.cos(o.sweep) * side + sp.dz * Math.sin(o.sweep)) * ll];
      const mid: V3 = [q[0] + ox * 0.5, q[1] - ll * o.drop * 0.12, q[2] + oz * 0.5];
      p.line(q, mid, col);
      p.line(mid, [q[0] + ox, q[1] - ll * o.drop, q[2] + oz], mix(col, o.b, 0.5));
    }
  }
}

export interface BladeOpts {
  prof: (t: number) => number;
  droop: number;
  fold: number;
  a: string;
  b: string;
  vein: string;
  skip?: (t: number, u: number) => boolean;
  edge?: string;
}

/** A broad leaf: a solid sheet of blocks along a bending midrib, with paler veins; t runs base to tip, u edge to edge. */
export function blade(p: Paint, base: V3, yaw: number, pitch: number, len: number, wid: number, o: BladeOpts) {
  const sp = spine(base, yaw, pitch, len, o.droop);
  const [px, pz] = [sp.dz, -sp.dx];
  const dt = (p.s * 0.5) / len;
  for (let t = 0; t <= 1.0001; t += dt) {
    const w = (wid * o.prof(Math.min(1, t))) / 2;
    const m = Math.max(0, Math.ceil(w / (p.s * 0.5)));
    const q = sp.at(Math.min(1, t));
    for (let i = -m; i <= m; i++) {
      const u = m ? i / m : 0;
      const au = Math.abs(u);
      if (o.skip?.(t, au)) continue;
      let col = mix(o.a, o.b, t * 0.9 + au * 0.15);
      if (au < 0.07) col = o.vein;
      else if ((((t * len) / (p.s * 4) - au * 1.5) % 1 + 1) % 1 < 0.16) col = mix(col, o.vein, 0.3);
      if (o.edge && au > 0.86) col = o.edge;
      p.dot(q[0] + px * u * w, q[1] + o.fold * au * w, q[2] + pz * u * w, col);
    }
  }
}

/** A round trunk of blocks, tapering, leaning and ringed; returns where its top is. */
export function column(p: Paint, h: number, r0: number, r1: number, lean: [number, number], color: (t: number, y: number) => string, ring?: (t: number, y: number) => number): V3 {
  const s = p.s;
  for (let y = 0; y < h; y += s) {
    const t = y / h;
    const r = lerp(r0, r1, t) + (ring ? ring(t, y) : 0);
    const [ox, oz] = [lean[0] * h * t * t, lean[1] * h * t * t];
    const c = color(t, y);
    const n = Math.ceil(r / s);
    for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) if ((i * s) ** 2 + (k * s) ** 2 <= r * r) p.dot(ox + i * s, y, oz + k * s, c);
  }
  return [lean[0] * h, h, lean[1] * h];
}

/** Each distinct plant is built once (the first time it's asked for) and kept. */
const made = new Map<string, THREE.BufferGeometry>();

/** Plants stamped with a position, a turn and a scale, as one instanced mesh per kind of plant. Leaves are kept inside the garden's glass, and sway. */
export class VoxBatch {
  private kinds = new Map<string, { geo: THREE.BufferGeometry; at: THREE.Matrix4[] }>();
  constructor(private limit: THREE.Box3) {}

  add(key: string, build: () => THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, scale = 1) {
    let geo = made.get(key);
    if (!geo) made.set(key, (geo = build()));
    let k = this.kinds.get(key);
    if (!k) this.kinds.set(key, (k = { geo, at: [] }));
    k.at.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale)));
  }

  build(wind: { value: number }): THREE.Group {
    const group = new THREE.Group();
    const box = { value: new THREE.Vector4() };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = wind;
      sh.uniforms.uBox = box;
      sh.vertexShader = 'uniform float uT;\nuniform vec4 uBox;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', `vec3 transformed = position;
          float hh = max(position.y, 0.0);
          float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
          transformed.x += sin(uT * 1.3 + ph + position.y * 2.0) * 0.012 * hh * hh;
          transformed.z += cos(uT * 1.1 + ph + position.y * 1.5) * 0.01 * hh * hh;`)
        .replace('#include <project_vertex>', `vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          wp.x = clamp(wp.x, uBox.x, uBox.z);
          wp.z = clamp(wp.z, uBox.y, uBox.w);
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;`);
    };
    mat.customProgramCacheKey = () => 'garden-vox';
    for (const { geo, at } of this.kinds.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, at.length);
      at.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.onBeforeRender = () => {
        const t = mesh.matrixWorld.elements;
        box.value.set(this.limit.min.x + t[12], this.limit.min.z + t[14], this.limit.max.x + t[12], this.limit.max.z + t[14]);
      };
      group.add(mesh);
    }
    return group;
  }
}

