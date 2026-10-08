import { Build, line, type Theme } from './vanvox';

// Downtown Vancouver's landmarks, in blocks, each in its own local coordinates (the zone's centre is 0, 0).

const GLASS: Theme[] = [
  { wall: '#3d6f8f', glass: '#5d9bbf', band: '#c8d4dc' },
  { wall: '#2f6b6b', glass: '#58a7a2', band: '#d6dedd' },
  { wall: '#4a5f86', glass: '#7a98c8', band: '#cfd6e2' },
  { wall: '#58707f', glass: '#8fb4c6', band: '#e1e6e8' },
  { wall: '#6b7f73', glass: '#9cc1ae', band: '#dfe5e0' },
];

/** The downtown core: Harbour Centre with its saucer and spire, the Marine Building, Shangri-La and a crowd of glass condo towers. */
export function downtown(rnd: () => number): Build {
  const b = new Build(rnd);
  // Harbour Centre: a concrete shaft, the revolving saucer, a spire.
  const hc: Theme = { wall: '#cfcac0', glass: '#6e8aa0', band: '#b8b3a8' };
  b.tower(-18, 12, 14, 14, 0, 112, hc, 15);
  for (let l = 0; l < 3; l++) b.disc(-18, 12, 12 - (l === 1 ? 0 : 2), 112 + l * 2, l === 1 ? '#7fa6c4' : '#d9d6cf', undefined, 2);
  b.disc(-18, 12, 6, 118, '#cfcac0', undefined, 2);
  b.slab(-19, 120, 11, -17, 150, 13, '#d9d6cf');
  b.slab(-19, 150, 11, -17, 152, 13, '#d33a2c');
  // The Marine Building: stepped art deco, cream terracotta with a green copper roof.
  const mb: Theme = { wall: '#d8d0b8', glass: '#6a8a86', band: '#c4b992' };
  b.tower(14, -8, 28, 22, 0, 38, mb, 25);
  b.tower(14, -8, 20, 16, 38, 28, mb, 25);
  b.tower(14, -8, 13, 11, 66, 18, mb, 25);
  b.pyramid(14, -8, 13, 11, 84, '#3f9c82', 6);
  b.slab(14, 90, -8, 15, 96, -7, '#d9b24a');
  // Shangri-La: a slim blue-green giant.
  b.tower(-2, -28, 22, 24, 0, 28, GLASS[1], 25);
  b.tower(-2, -28, 18, 18, 28, 150, { wall: '#32636f', glass: '#4f98a3', band: '#9fb8bd' }, 28, '#7c9aa3');
  // A crowd of condo towers, each on a lower podium.
  const spots: [number, number][] = [[28, 30], [-34, -2], [4, 34], [34, -34], [-20, -42], [42, 4], [-40, 30], [16, 14], [-8, 0]];
  spots.forEach(([x, z], n) => {
    const t = GLASS[n % GLASS.length];
    const w = 14 + Math.floor(rnd() * 8), d = 14 + Math.floor(rnd() * 8);
    b.tower(x, z, w + 6, d + 6, 0, 12, { ...t, wall: '#c9c4bb' }, 20);
    b.tower(x, z, w, d, 12, 36 + Math.floor(rnd() * 90), t, 30);
  });
  // The streets between: a strip of pavement.
  b.slab(-52, 0, -52, 52, 1, 52, '#8d8f93', 0.04);
  return b;
}

/** Canada Place with its five white sails, and a cruise ship alongside. */
export function canadaPlace(rnd: () => number): Build {
  const b = new Build(rnd);
  b.slab(-34, 0, -10, 34, 6, 10, '#d8d8d4');
  b.slab(-36, 0, -8, -34, 6, 8, '#d8d8d4');
  b.slab(-34, 6, -10, 34, 7, 10, '#a9a9a6');
  b.slab(-30, 7, -8, 30, 11, 8, '#e9e9e5');
  for (let s = 0; s < 5; s++) {
    const cx = -26 + s * 13;
    for (let j = 0; j < 17; j++) {
      const hw = Math.max(1, Math.round(5.5 * (1 - j / 17) + 1));
      const hd = Math.max(1, Math.round(3.5 * (1 - j / 22)));
      b.slab(cx - hw, 11 + j, -hd, cx + hw + 1, 12 + j, hd + 1, j % 5 === 0 ? '#e6eaf0' : '#fbfbf8');
    }
  }
  // Cruise ship: hull, white decks, a blue funnel.
  b.slab(-30, 0, 18, 42, 7, 28, '#223a63');
  b.slab(-26, 7, 19, 40, 9, 27, '#f2f2ee');
  for (let d = 0; d < 4; d++) b.slab(-20 + d * 2, 9 + d * 3, 20, 36 - d * 2, 12 + d * 3, 26, d % 2 ? '#f6f6f2' : '#e8e8e4');
  b.slab(-4, 21, 21, 4, 27, 25, '#1c5b9c');
  for (let i = -28; i < 40; i += 3) b.lit.put(i, 4, 17, '#ffffff');
  return b;
}

/** Science World's silver geodesic dome on legs, and the BC Place stadium. */
export function scienceWorld(rnd: () => number): Build {
  const b = new Build(rnd);
  const R = 15, cy = 17;
  for (let i = -R; i <= R; i++)
    for (let j = -R; j <= R; j++)
      for (let k = -R; k <= R; k++) {
        const r2 = i * i + j * j + k * k;
        if (r2 > R * R || r2 < (R - 1.4) ** 2) continue;
        const seam = (i + j * 2 + k) % 5 === 0 || (i - j + k * 2) % 6 === 0;
        b.v.put(i, j + cy, k, seam ? '#6f8497' : '#c9d6e0', 0.06);
      }
  for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) b.slab(x - 1, 0, z - 1, x + 2, 6, z + 2, '#8e9aa5');
  b.slab(-20, 0, 12, 22, 5, 26, '#d7d9db');
  return b;
}

export function bcPlace(rnd: () => number): Build {
  const b = new Build(rnd);
  for (let j = 0; j < 22; j++)
    for (let i = -34; i <= 34; i++)
      for (let k = -26; k <= 26; k++) {
        const e = (i / 34) ** 2 + (k / 26) ** 2;
        if (e > 1 || e < 0.9) continue;
        b.v.put(i, j, k, j % 4 === 3 ? '#9aa3ac' : (i + k) % 5 === 0 ? '#c4c9ce' : '#e9ecee', 0.04);
      }
  for (let l = 0; l < 7; l++) {
    const f = 1 - l * 0.14;
    for (let i = -34; i <= 34; i++)
      for (let k = -26; k <= 26; k++) {
        const e = (i / 34) ** 2 + (k / 26) ** 2;
        if (e <= f * f && e >= (f - 0.16) ** 2) b.v.put(i, 22 + l, k, l % 2 ? '#f4f6f8' : '#ffffff', 0.03);
      }
  }
  for (let a = 0; a < 20; a++) {
    const x = Math.round(Math.cos((a / 20) * 6.28) * 36), z = Math.round(Math.sin((a / 20) * 6.28) * 28);
    line(b.v, [x, 0, z], [x, 26, z], '#7f8a94');
    b.lit.put(x, 24, z, '#ffffff');
  }
  return b;
}
