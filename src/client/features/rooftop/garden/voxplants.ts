import * as THREE from 'three';
import { mulberry32 } from '../../../../shared/rng';
import { Paint, blade, column, frond, mix, spine, type FrondOpts, type V3 } from './voxkit';

// The garden's plants as models made of small blocks (4 to 5 cm: the finest in the building), each a
// few variants, built once and stamped wherever it grows. Their yaw 0 fans toward +z; the placement
// turns them. Greens run dark at the base to pale at the tip, trunks are ringed, flowers have eyes.

const lerp = THREE.MathUtils.lerp;
const jig = (c: string, R: () => number, a = 0.06) => mix(c, R() < 0.5 ? '#000000' : '#ffffff', R() * a);
/** Heading of the i-th of n leaves: round the plant, or fanned out in front of it (for plants at an edge). */
const heading = (i: number, R: () => number, fan: boolean) => (fan ? (((i * 0.618034 + R() * 0.08) % 1) - 0.5) * 3.8 : i * 2.39996 + R() * 0.3);

/** A ring of fronds round a trunk's top: young ones steep, old ones low and long. */
function crown(p: Paint, R: () => number, top: V3, n: number, len: [number, number], pitch: [number, number], droop: number, fan: boolean, o: FrondOpts, greens: [string, string][]) {
  for (let i = 0; i < n; i++) {
    const k = i / Math.max(1, n - 1);
    const [a, b] = greens[Math.floor(R() * greens.length)];
    frond(p, top, heading(i, R, fan), lerp(pitch[0], pitch[1], k) + (R() - 0.5) * 0.15, lerp(len[0], len[1], 0.35 + 0.65 * k) * (0.9 + 0.2 * R()), droop, { ...o, a: jig(a, R), b: jig(b, R) });
  }
}

const FERN_GREENS: [string, string][] = [['#2c6a2b', '#5fa646'], ['#35742e', '#6bb04a'], ['#2a6130', '#52993f']];

export function treeFernGeo(h: number, fan: boolean, variant: number) {
  const R = mulberry32(variant * 977 + Math.round(h * 40));
  const p = new Paint(0.04);
  const lean: [number, number] = [(R() - 0.5) * 0.08, (R() - 0.5) * 0.08];
  const bark = ['#4d3626', '#5a402d', '#6a4b34', '#3f2c1f'];
  const top = column(p, h, 0.15, 0.1, lean, (_t, y) => ((y / 0.16) % 1 < 0.2 ? '#2e1f15' : bark[Math.floor(y / 0.04) % 4]), (_t, y) => ((y / 0.16) % 1 < 0.2 ? 0.03 : 0));
  p.v.ell(top[0], top[1] + 0.02, top[2], 0.13, 0.07, 0.13, '#3b2a1d');
  crown(p, R, top, 15, [1.0, 1.55], [1.2, 0.3], 0.9, fan, { pairs: 14, leaf: 0.24, sweep: 0.7, drop: 0.5, rib: '#6b7f3a', a: '', b: '' }, FERN_GREENS);
  for (let i = 0; i < 2; i++) {
    const a = R() * 6.28;
    const [cx, cz] = [Math.cos(a) * 0.1, Math.sin(a) * 0.1];
    p.line(top, [top[0] + cx, top[1] + 0.3, top[2] + cz], '#8aa84a');
    for (let q = 0; q < 14; q++) {
      const t = q / 13;
      const r = 0.06 * (1 - t * 0.8);
      p.dot(top[0] + cx + Math.cos(a) * (r * Math.sin(t * 6.5) - 0.0), top[1] + 0.3 + r * Math.cos(t * 6.5) * 0.9, top[2] + cz + Math.sin(a) * (r * Math.sin(t * 6.5)), mix('#9cc04f', '#c4dc7a', t));
    }
  }
  return p.v.build();
}

export function palmGeo(h: number, fan: boolean, variant: number) {
  const R = mulberry32(variant * 733 + Math.round(h * 40));
  const p = new Paint(0.05);
  const lean: [number, number] = [(R() - 0.5) * 0.14, (R() - 0.5) * 0.14];
  const grey = ['#7a6a55', '#6c5d49', '#85755f'];
  const top = column(p, h, 0.1, 0.07, lean, (_t, y) => ((y / 0.1) % 1 < 0.3 ? '#4f4334' : grey[Math.floor(y / 0.05) % 3]), (_t, y) => ((y / 0.1) % 1 < 0.3 ? 0 : 0.02));
  for (let y = 0; y < 0.34; y += 0.05) {
    const c = mix('#7da845', '#a6c85e', y / 0.34);
    for (const [i, k] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) p.dot(top[0] + i * 0.05, top[1] - 0.06 + y, top[2] + k * 0.05, c);
  }
  const crownTop: V3 = [top[0], top[1] + 0.12, top[2]];
  crown(p, R, crownTop, 11, [1.45, 1.85], [1.1, -0.1], 0.9, fan, { pairs: 18, leaf: 0.38, sweep: 0.55, drop: 0.85, rib: '#5d8a38', a: '', b: '' }, [['#2f7a30', '#5fa84a'], ['#36822f', '#6cb350'], ['#2b6f2e', '#58a043']]);
  for (let i = 0; i < 4; i++) p.v.ell(top[0] + Math.cos(i * 1.7) * 0.09, top[1] - 0.14, top[2] + Math.sin(i * 1.7) * 0.09, 0.055, 0.065, 0.055, '#6b4a2a');
  return p.v.build();
}

export function bananaGeo(h: number, fan: boolean, bud: boolean, variant: number) {
  const R = mulberry32(variant * 421 + Math.round(h * 40) + (bud ? 9 : 0));
  const p = new Paint(0.05);
  const top = column(p, h * 0.72, 0.15, 0.09, [(R() - 0.5) * 0.06, (R() - 0.5) * 0.06], (t, y) => (t < 0.08 ? '#7a6a45' : (y / 0.14) % 1 < 0.14 ? '#5f7a38' : Math.floor(y / 0.05) % 2 ? '#8fae5c' : '#99b866'));
  for (let i = 0; i < 8; i++) {
    const k = i / 7;
    const len = lerp(1.5, 2.05, 0.35 + 0.65 * k) * (0.9 + 0.2 * R());
    const seed = R() * 40;
    blade(p, top, heading(i, R, fan), lerp(1.15, 0.4, k) + (R() - 0.5) * 0.15, len, len * 0.36, {
      prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.7),
      droop: 0.9,
      fold: 0.25,
      a: jig('#3a8228', R),
      b: jig('#6db23c', R),
      vein: '#a6cc5a',
      skip: (t, u) => u > 0.5 && t > 0.15 && Math.sin(t * len * 38 + seed) > 0.35 + (1 - u) * 1.2,
    });
  }
  if (bud) {
    const a = R() * 6.28;
    const at = (r: number, dy: number): V3 => [top[0] + Math.cos(a) * r, top[1] + dy, top[2] + Math.sin(a) * r];
    p.line(at(0, -0.1), at(0.2, 0.0), '#7a8f4a');
    p.line(at(0.2, 0.0), at(0.4, -0.15), '#7a8f4a');
    p.line(at(0.4, -0.15), at(0.42, -0.42), '#6d8240');
    const c = at(0.42, -0.6);
    p.v.ell(c[0], c[1], c[2], 0.07, 0.17, 0.07, (_i, j) => (j % 3 === 0 ? '#7a2a64' : '#5a1d4c'));
    for (let q = 0; q < 3; q++) p.v.ell(c[0] + Math.cos(a) * (0.07 + q * 0.01), c[1] + 0.12 - q * 0.08, c[2] + Math.sin(a) * 0.07, 0.04, 0.04, 0.04, '#b9cf55');
  }
  return p.v.build();
}

export function monsteraGeo(scale: number, fan: boolean, variant: number) {
  const R = mulberry32(variant * 311 + Math.round(scale * 40));
  const p = new Paint(0.035);
  for (let i = 0; i < 9; i++) {
    const yaw = heading(i, R, fan);
    const reach = (0.35 + 0.5 * R()) * scale;
    const rise = (0.45 + 0.5 * R()) * scale;
    const [dx, dz] = [Math.sin(yaw), Math.cos(yaw)];
    const end: V3 = [dx * reach, rise, dz * reach];
    p.line([0, 0, 0], [dx * reach * 0.2, rise * 0.7, dz * reach * 0.2], '#4f8236');
    p.line([dx * reach * 0.2, rise * 0.7, dz * reach * 0.2], end, '#5b8f3d');
    const len = (0.42 + 0.2 * R()) * scale;
    const holes = [[0.35, 0.3], [0.55, 0.38], [0.72, 0.3]];
    blade(p, end, yaw + (R() - 0.5) * 0.5, 0.1 + R() * 0.35, len, len * 0.95, {
      prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.85),
      droop: 0.35,
      fold: 0.12,
      a: jig('#1f5a33', R),
      b: jig('#2e7a40', R),
      vein: '#8fbf6a',
      skip: (t, u) => (u > 0.55 && t > 0.2 && t < 0.9 && (t * 9) % 1 < 0.5 && Math.floor(t * 9) % 2 === 0) || (t < 0.1 && u < 0.18) || holes.some(([ht, hu]) => (t - ht) ** 2 + (u - hu) ** 2 * 0.5 < 0.0035),
    });
  }
  return p.v.build();
}

export function bambooGeo(culms: number, h: number, variant: number) {
  const R = mulberry32(variant * 199 + culms * 31 + Math.round(h * 10));
  const p = new Paint(0.04);
  const s = p.s;
  for (let i = 0; i < culms; i++) {
    const a = R() * 6.28;
    const off = 0.05 + R() * 0.3;
    const ch = h * (0.75 + 0.25 * R());
    const lean = [Math.cos(a) * (0.03 + 0.07 * R()), Math.sin(a) * (0.03 + 0.07 * R())];
    const [bx, bz] = [Math.cos(a) * off, Math.sin(a) * off];
    const col = ['#8aa84a', '#a3b45a', '#6f9440'][Math.floor(R() * 3)];
    const node = mix(col, '#3f5a22', 0.55);
    const at = (y: number): [number, number] => [bx + lean[0] * ch * (y / ch) ** 2, bz + lean[1] * ch * (y / ch) ** 2];
    for (let y = 0; y < ch; y += s) {
      const [cx, cz] = at(y);
      const isNode = (y / 0.32) % 1 < 0.13;
      const c = isNode ? node : y % 0.32 > 0.2 ? mix(col, '#cfe08a', 0.2) : col;
      if (y < ch * 0.4) for (const [di, dk] of [[0, 0], [1, 0], [0, 1], [1, 1]]) p.dot(Math.round(cx / s) * s + (di - 0.5) * s, y, Math.round(cz / s) * s + (dk - 0.5) * s, c);
      else p.dot(cx, y, cz, c);
      if (isNode && y > ch * 0.25) for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.dot(cx + di * s, y, cz + dk * s, node);
    }
    for (let y = ch * 0.5; y < ch; y += 0.3) {
      const [cx, cz] = at(y);
      for (let k = 0; k < 3; k++) blade(p, [cx, y, cz], R() * 6.28, -0.3 + R() * 0.7, (0.22 + 0.1 * R()) * (1.5 - 0.5 * (y / ch)), 0.05, { prof: (t) => Math.sin(Math.PI * Math.pow(t, 0.8)), droop: 0.6, fold: 0, a: jig(['#4f8a38', '#5f9a3a'][k % 2], R), b: '#8dbf4e', vein: '#9ccd5a' });
    }
  }
  return p.v.build();
}

export function grassGeo(n: number, h: number, golds: number, variant: number) {
  const R = mulberry32(variant * 557 + n * 13 + Math.round(h * 20));
  const p = new Paint(0.025, 0.1);
  for (let i = 0; i < n; i++) {
    const a = R() * 6.28;
    const off = R() * 0.1;
    const dry = R() < golds;
    const hex = dry ? ['#c3b560', '#b5a552'][i % 2] : ['#86a64a', '#6f9a44', '#9ab455'][Math.floor(R() * 3)];
    const sp = spine([Math.cos(a) * off, 0, Math.sin(a) * off], a, 1.0 + R() * 0.45, h * (0.6 + 0.5 * R()), 0.8 + R() * 0.9);
    const n2 = Math.ceil((h * 1.5) / 0.0125);
    for (let q = 0; q <= n2; q++) {
      const t = q / n2;
      const pt = sp.at(t);
      const c = dry ? mix(hex, '#e2d98a', t * 0.5) : mix('#3f6a2a', mix(hex, '#d9e3a2', t * t * 0.4), Math.min(1, t * 2.2));
      p.dot(pt[0], pt[1], pt[2], c);
      if (t < 0.25) p.dot(pt[0] + sp.dz * 0.025, pt[1], pt[2] - sp.dx * 0.025, c);
    }
  }
  return p.v.build();
}

export function broadGeo(n: number, s: number, hex: string, variant: number) {
  const R = mulberry32(variant * 887 + n * 17 + Math.round(s * 100));
  const p = new Paint(0.03);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const len = s * (0.7 + 0.5 * R());
    blade(p, [(R() - 0.5) * 0.1, 0, (R() - 0.5) * 0.1], i * 2.39996, lerp(1.25, 0.55, k), len, len * 0.55, {
      prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.8),
      droop: 0.7,
      fold: 0.3,
      a: jig(mix(hex, '#10301a', 0.25), R),
      b: jig(mix(hex, '#8ad05a', 0.25), R),
      vein: '#b7dc8a',
      edge: i % 3 === 0 ? '#c9dc78' : undefined,
    });
  }
  return p.v.build();
}

export function groundFernGeo(s: number, variant: number) {
  const R = mulberry32(variant * 61 + Math.round(s * 10));
  const p = new Paint(0.03);
  crown(p, R, [0, 0, 0], 9, [0.5 * s, 0.8 * s], [0.95, 0.3], 0.6, false, { pairs: 9, leaf: 0.13 * s, sweep: 0.7, drop: 0.5, rib: '#5f7a35', a: '', b: '' }, [['#3a7f33', '#69b24b'], ['#2f7030', '#5aa543']]);
  return p.v.build();
}

/** One clover leaf lying flat: three round lobes and a pale centre. */
export function cloverGeo(variant: number) {
  const p = new Paint(0.02, 0.1);
  const g = [['#5e9e44', '#7fc05a'], ['#6aa94c', '#8ccb64'], ['#4e8f3e', '#6fb350']][variant % 3];
  for (const a of [0, 2.1, 4.2]) {
    const [cx, cz] = [Math.cos(a) * 0.026, Math.sin(a) * 0.026];
    for (const [i, k] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]]) p.dot(cx + i * 0.02, 0, cz + k * 0.02, g[(i + k) & 1]);
  }
  p.dot(0, 0.02, 0, '#d4efae');
  return p.v.build();
}

export function flowerGeo(h: number, color: string, kind: 'head' | 'spike', variant: number) {
  const R = mulberry32(variant * 97 + Math.round(h * 100) + color.charCodeAt(1));
  const p = new Paint(0.02, 0.08);
  const [sx, sz] = [(R() - 0.5) * 0.12, (R() - 0.5) * 0.12];
  p.line([0, 0, 0], [sx, h, sz], (t) => mix('#3e6b2c', '#5f9040', t));
  for (const a of [0.8, 3.9]) blade(p, [sx * 0.3, h * 0.3, sz * 0.3], a, 0.5, 0.08, 0.03, { prof: (t) => Math.sin(Math.PI * t), droop: 0.5, fold: 0, a: '#3f7a30', b: '#6aa34a', vein: '#8fc060' });
  const [lo, hi] = [mix(color, '#000000', 0.25), mix(color, '#ffffff', 0.25)];
  if (kind === 'head') {
    for (const [r, dy, n, c] of [[0.058, 0.012, 9, lo], [0.04, 0.02, 8, hi]] as const)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28 + (r < 0.05 ? 0.3 : 0);
        p.line([sx, h, sz], [sx + Math.cos(a) * r, h + dy, sz + Math.sin(a) * r], (t) => mix(c, color, t));
      }
    for (const [i, k] of [[0, 0], [1, 0], [0, 1], [1, 1]]) p.dot(sx + i * 0.02 - 0.01, h + 0.012, sz + k * 0.02 - 0.01, '#e8b92f');
  } else {
    for (let q = 0; q < 14; q++) {
      const t = 0.5 + 0.5 * (q / 14);
      const a = q * 2.4;
      const r = 0.032 * (1 - q / 18);
      const [x, y, z] = [sx * t * t, h * t, sz * t * t];
      for (const da of [0, 2.1, 4.2]) p.dot(x + Math.cos(a + da) * r, y, z + Math.sin(a + da) * r, q % 2 ? lo : hi);
      p.dot(x, y, z, color);
    }
  }
  return p.v.build();
}

/** A hanging strand of ivy, a vine with leaves along it. */
export function ivyGeo(len: number, variant: number) {
  const R = mulberry32(variant * 41 + Math.round(len * 100));
  const p = new Paint(0.025, 0.1);
  const sway = (R() - 0.5) * 0.15;
  const pt = (t: number): V3 => [sway * t * t + Math.sin(t * 5 + variant) * 0.025, -len * t, Math.cos(t * 4 + variant) * 0.025];
  p.line(pt(0), pt(1), '#4a6b32');
  for (let d = 0.05; d < len; d += 0.09 + R() * 0.05) {
    const q = pt(d / len);
    blade(p, q, R() * 6.28, -0.5 - R() * 0.6, 0.07 + 0.05 * R(), 0.08, { prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.7), droop: 0.4, fold: 0.2, a: jig(['#2f6b34', '#3d7d3a', '#4a8a40'][Math.floor(R() * 3)], R), b: '#6aa850', vein: '#9cc47a' });
  }
  return p.v.build();
}

