import { seeded } from './textures';

// The pictures of what's outside the station's windows (see space.ts): the Earth by day and by night
// and its clouds, the Moon, a ringed giant and a red planet, the stars and the Sun's glare. They're
// drawn the way a map of the world is, longitude across and latitude down.

type G = CanvasRenderingContext2D;
type Coast = [lon: number, lat: number][];

/** The world's coastlines, roughly: enough to know it by from orbit. */
const LANDS: Coast[] = [
  // North and Central America, from Alaska round by the Arctic coast, down the east, and back up the west.
  [[-165, 62], [-162, 68], [-156, 71], [-140, 70], [-120, 70], [-100, 69], [-90, 70], [-82, 66], [-78, 62], [-70, 60], [-64, 60], [-56, 53], [-64, 48], [-66, 44], [-70, 42], [-75, 38], [-77, 34], [-81, 31], [-80, 26], [-82, 29], [-85, 30], [-90, 29], [-94, 29], [-97, 26], [-97, 21], [-94, 18], [-90, 19], [-87, 21], [-88, 16], [-84, 15], [-83, 11], [-80, 9], [-78, 8], [-80, 7], [-84, 9], [-87, 13], [-92, 15], [-96, 16], [-102, 18], [-106, 22], [-110, 26], [-113, 30], [-117, 33], [-121, 36], [-124, 41], [-124, 47], [-128, 51], [-134, 57], [-141, 60], [-150, 60], [-155, 58], [-160, 56], [-164, 58]],
  // Greenland.
  [[-52, 82], [-30, 83], [-20, 78], [-22, 70], [-40, 65], [-44, 60], [-52, 65], [-55, 70], [-60, 76]],
  // South America.
  [[-78, 8], [-72, 12], [-62, 10], [-52, 5], [-50, 0], [-44, -2], [-35, -6], [-37, -12], [-39, -18], [-42, -23], [-48, -27], [-53, -33], [-57, -37], [-62, -40], [-65, -46], [-68, -52], [-72, -53], [-74, -46], [-73, -38], [-71, -30], [-70, -20], [-76, -14], [-81, -6], [-80, 0], [-78, 3]],
  // Africa, and Madagascar.
  [[-17, 15], [-16, 22], [-10, 29], [-6, 35], [3, 37], [10, 37], [11, 33], [20, 32], [25, 32], [32, 31], [35, 24], [38, 18], [43, 12], [51, 11], [48, 4], [42, -2], [40, -10], [40, -16], [35, -22], [33, -27], [28, -33], [20, -35], [17, -30], [14, -22], [12, -14], [13, -6], [9, 0], [9, 4], [4, 6], [-4, 5], [-8, 4], [-13, 8], [-17, 12]],
  [[49, -12], [50, -16], [47, -25], [44, -22], [44, -16]],
  // Europe and Asia, from Iberia round by the Arctic to the Pacific, and back along the south.
  [[-9, 37], [-9, 43], [-1, 44], [-4, 48], [3, 51], [8, 54], [12, 56], [5, 59], [6, 62], [14, 68], [25, 71], [40, 67], [45, 68], [60, 69], [70, 73], [90, 76], [105, 78], [112, 74], [130, 72], [150, 71], [170, 70], [180, 66], [172, 61], [163, 59], [156, 51], [142, 54], [135, 54], [140, 48], [130, 42], [128, 36], [126, 35], [122, 39], [118, 38], [121, 31], [119, 25], [110, 21], [108, 17], [109, 11], [105, 9], [100, 13], [99, 8], [103, 2], [101, 3], [98, 8], [98, 15], [94, 17], [91, 22], [87, 21], [80, 15], [80, 9], [77, 8], [73, 17], [72, 21], [67, 24], [61, 25], [57, 26], [56, 27], [51, 28], [48, 30], [51, 25], [56, 24], [59, 22], [55, 17], [45, 13], [43, 13], [39, 21], [35, 28], [35, 32], [36, 36], [30, 36], [27, 37], [26, 40], [29, 41], [23, 40], [23, 37], [21, 39], [19, 42], [13, 45], [12, 44], [18, 40], [16, 38], [12, 42], [9, 44], [3, 43], [0, 39], [-2, 37], [-5, 36]],
  // Britain, Japan, and the islands between Asia and Australia.
  [[-5, 50], [1, 51], [0, 54], [-2, 56], [-3, 58], [-6, 57], [-5, 54], [-3, 53], [-5, 52]],
  [[130, 32], [135, 34], [140, 36], [141, 40], [142, 44], [144, 43], [141, 37], [136, 33]],
  [[95, 5], [104, -5], [106, -6], [100, 2]],
  [[109, 1], [114, 5], [118, 4], [117, -3], [111, -3]],
  [[131, -1], [141, -3], [150, -7], [146, -9], [138, -8], [132, -4]],
  // Australia and New Zealand.
  [[114, -22], [122, -18], [129, -15], [131, -12], [136, -12], [137, -16], [141, -14], [142, -11], [146, -19], [153, -26], [153, -31], [150, -37], [144, -39], [138, -35], [135, -35], [131, -32], [124, -33], [115, -34], [114, -28]],
  [[173, -35], [178, -38], [175, -41], [168, -46], [167, -45], [172, -41]],
];

/** Where it's dry: the Sahara, Arabia, the middle of Asia, the south-west of North America, Australia's middle, the Kalahari, Patagonia. */
const DESERTS: [lon: number, lat: number, rx: number, ry: number][] = [
  [8, 23, 28, 8],
  [46, 23, 9, 7],
  [62, 40, 14, 6],
  [100, 41, 14, 5],
  [-110, 33, 8, 6],
  [132, -25, 13, 6],
  [20, -24, 6, 5],
  [-68, -42, 4, 8],
];

/** Where the lights are thickest at night. */
const CITIES: [lon: number, lat: number, rx: number, ry: number, n: number][] = [
  [-82, 39, 14, 9, 150],
  [-118, 36, 5, 5, 40],
  [10, 49, 16, 8, 190],
  [78, 22, 9, 10, 130],
  [114, 31, 9, 10, 170],
  [138, 36, 4, 4, 60],
  [-47, -22, 6, 5, 50],
  [31, 30, 3, 4, 30],
  [28, -27, 4, 3, 22],
  [107, -6, 5, 3, 30],
  [147, -35, 5, 4, 26],
  [-99, 20, 4, 3, 26],
  [37, 55, 6, 3, 30],
  [5, 8, 6, 3, 28],
];

/** Traces the world's land on a `w` by `h` map. */
function land(g: G, w: number, h: number) {
  g.beginPath();
  for (const coast of LANDS) {
    coast.forEach(([lon, lat], i) => {
      const x = ((lon + 180) / 360) * w;
      const y = ((90 - lat) / 180) * h;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.closePath();
  }
}

/** An ice cap's ragged edge across a `w` wide map, round latitude `lat`. */
function ice(g: G, w: number, h: number, lat: number, south: boolean, rand: () => number) {
  g.beginPath();
  g.moveTo(0, south ? h : 0);
  for (let x = 0; x <= w; x += w / 48) {
    const wob = Math.sin((x / w) * Math.PI * 6) * 2.5 + (rand() - 0.5) * 3;
    g.lineTo(x, ((90 - (south ? -1 : 1) * (lat + wob)) / 180) * h);
  }
  g.lineTo(w, south ? h : 0);
  g.closePath();
  g.fill();
}

/** The Earth by day: blue seas, green and tan land, white at the poles. */
export function earthDay(w: number, h: number): (g: G) => void {
  return (g) => {
    const rand = seeded(11);
    const sea = g.createLinearGradient(0, 0, 0, h);
    sea.addColorStop(0, '#0b2f6b');
    sea.addColorStop(0.5, '#1458b8');
    sea.addColorStop(1, '#0b2f6b');
    g.fillStyle = sea;
    g.fillRect(0, 0, w, h);
    // Shallows round the coasts.
    land(g, w, h);
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(90, 190, 235, 0.55)';
    g.lineWidth = w / 230;
    g.stroke();
    // The land, greener toward the equator, greyer and then white toward the poles.
    const earth = g.createLinearGradient(0, 0, 0, h);
    for (const [lat, color] of [
      [90, '#eef4f8'],
      [76, '#dfe8ea'],
      [68, '#8f9f7c'],
      [55, '#3f7d46'],
      [38, '#62a34b'],
      [24, '#8fae55'],
      [8, '#2f8c3e'],
      [-8, '#2f8c3e'],
      [-24, '#8fae55'],
      [-40, '#62a34b'],
      [-56, '#8f9f7c'],
    ] as const) {
      earth.addColorStop((90 - lat) / 180, color);
    }
    g.fillStyle = earth;
    g.fill();
    // Only over the land from here on: the deserts, and a mottle of darker and lighter ground.
    g.save();
    g.clip();
    for (const [lon, lat, rx, ry] of DESERTS) {
      const r = (Math.max(rx, ry) / 360) * w;
      const sand = g.createRadialGradient(0, 0, 0, 0, 0, r);
      sand.addColorStop(0, 'rgba(214, 186, 120, 0.95)');
      sand.addColorStop(0.7, 'rgba(206, 176, 112, 0.7)');
      sand.addColorStop(1, 'rgba(206, 176, 112, 0)');
      g.fillStyle = sand;
      // A round patch, squashed to the desert's shape.
      g.save();
      g.translate(((lon + 180) / 360) * w, ((90 - lat) / 180) * h);
      g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
      g.fillRect(-r, -r, 2 * r, 2 * r);
      g.restore();
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rand() < 0.5 ? 'rgba(20, 60, 30, 0.16)' : 'rgba(190, 210, 140, 0.13)';
      g.beginPath();
      g.ellipse(rand() * w, rand() * h, (2 + rand() * 9) * (w / 1024), (1.5 + rand() * 5) * (w / 1024), rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // The ice: Antarctica, and the Arctic's floes.
    g.fillStyle = '#f2f6fa';
    ice(g, w, h, 70, true, rand);
    g.fillStyle = 'rgba(240, 246, 250, 0.85)';
    ice(g, w, h, 80, false, rand);
  };
}

/** The Earth by night: the lights of its cities, where there's land. */
export function earthNight(w: number, h: number): (g: G) => void {
  return (g) => {
    const rand = seeded(23);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.save();
    land(g, w, h);
    g.clip();
    const dot = (lon: number, lat: number, size: number, alpha: number) => {
      g.fillStyle = `rgba(255, ${190 + Math.floor(rand() * 50)}, ${110 + Math.floor(rand() * 60)}, ${alpha})`;
      g.beginPath();
      g.arc(((lon + 180) / 360) * w, ((90 - lat) / 180) * h, size * (w / 1024), 0, Math.PI * 2);
      g.fill();
    };
    // A scatter everywhere people live, and thick where the cities are.
    for (let i = 0; i < 1100; i++) dot(-180 + rand() * 360, -55 + rand() * 120, 0.5 + rand() * 0.9, 0.25 + rand() * 0.4);
    for (const [lon, lat, rx, ry, n] of CITIES) {
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand());
        dot(lon + Math.cos(a) * r * rx, lat + Math.sin(a) * r * ry, 0.6 + rand() * 1.3, 0.5 + rand() * 0.5);
      }
    }
    g.restore();
  };
}

/** Smooth noise in space, `seed`'s own: 0–1 at (x, y, z), a few octaves of it summed. */
function fbm(seed: number): (x: number, y: number, z: number) => number {
  const hash = (x: number, y: number, z: number) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1013904223) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const ease = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number, z: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = ease(x - xi);
    const v = ease(y - yi);
    const s = ease(z - zi);
    const mix = (a: number, b: number, t: number) => a + (b - a) * t;
    const at = (dz: number) => mix(mix(hash(xi, yi, zi + dz), hash(xi + 1, yi, zi + dz), u), mix(hash(xi, yi + 1, zi + dz), hash(xi + 1, yi + 1, zi + dz), u), v);
    return mix(at(0), at(1), s);
  };
  return (x, y, z) => {
    let sum = 0;
    let amp = 0.5;
    for (let o = 0; o < 4; o++) {
      sum += noise(x, y, z) * amp;
      x *= 2.03;
      y *= 2.03;
      z *= 2.03;
      amp *= 0.5;
    }
    return sum / 0.9375;
  };
}

/** The Earth's clouds, white where there are any: swirls, drawn on the globe itself so they meet round the back and at the poles. */
export function earthClouds(w: number, h: number): (g: G) => void {
  return (g) => {
    const n = fbm(5);
    const warp = fbm(9);
    const img = g.createImageData(w, h);
    for (let j = 0; j < h; j++) {
      const lat = (0.5 - (j + 0.5) / h) * Math.PI;
      const cl = Math.cos(lat);
      const y = Math.sin(lat);
      for (let i = 0; i < w; i++) {
        const lon = ((i + 0.5) / w) * Math.PI * 2;
        const x = cl * Math.cos(lon);
        const z = cl * Math.sin(lon);
        // Stretched along the latitudes, and pulled about a little, the way weather is.
        const k = warp(x * 2 + 7, y * 2, z * 2) - 0.5;
        const v = n(x * 3.1 + k * 1.6, y * 6.2 + k * 0.8, z * 3.1 - k * 1.6);
        const c = Math.max(0, Math.min(1, (v - 0.5) / 0.22));
        const a = Math.round(c * c * (3 - 2 * c) * 255);
        const p = (j * w + i) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = a;
        img.data[p + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  };
}

/** The Moon: pale grey, its dark seas and its craters. */
export function moonFace(w: number, h: number): (g: G) => void {
  return (g) => {
    const rand = seeded(31);
    g.fillStyle = '#c9c8c2';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = 'rgba(120, 122, 128, 0.5)';
      g.beginPath();
      g.ellipse(rand() * w, h * (0.25 + rand() * 0.5), (0.03 + rand() * 0.07) * w, (0.04 + rand() * 0.08) * h, rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 70; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = (0.004 + rand() * 0.014) * w;
      g.fillStyle = 'rgba(95, 96, 102, 0.55)';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(235, 234, 228, 0.6)';
      g.beginPath();
      g.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, Math.PI * 2);
      g.fill();
    }
  };
}

/** A giant's bands of cloud, in `colors` from pole to pole, with a storm or two turning in them. */
export function bands(colors: string[], seed: number): (g: G) => void {
  return (g) => {
    const { width: w, height: h } = g.canvas;
    const rand = seeded(seed);
    const stripes = g.createLinearGradient(0, 0, 0, h);
    const n = 22;
    for (let i = 0; i <= n; i++) stripes.addColorStop(i / n, colors[Math.floor(rand() * colors.length)]);
    g.fillStyle = stripes;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(255, 245, 225, ${0.25 + rand() * 0.3})`;
      g.beginPath();
      g.ellipse(rand() * w, h * (0.25 + rand() * 0.5), (0.02 + rand() * 0.04) * w, (0.012 + rand() * 0.02) * h, 0, 0, Math.PI * 2);
      g.fill();
    }
  };
}

/** A dry red world: rust, darker country here and there, and ice at its poles. */
export function redPlanet(w: number, h: number): (g: G) => void {
  return (g) => {
    const rand = seeded(57);
    g.fillStyle = '#b8563b';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = rand() < 0.6 ? 'rgba(110, 45, 30, 0.35)' : 'rgba(225, 150, 105, 0.3)';
      g.beginPath();
      g.ellipse(rand() * w, rand() * h, (0.02 + rand() * 0.09) * w, (0.02 + rand() * 0.06) * h, rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f3ece6';
    g.fillRect(0, 0, w, h * 0.06);
    g.fillRect(0, h * 0.95, w, h * 0.05);
  };
}

/** A giant's rings, from their inner edge (left) to their outer: bright bands, gaps between. */
export function rings(g: G) {
  const { width: w, height: h } = g.canvas;
  const rand = seeded(77);
  g.clearRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const t = x / w;
    // A wide gap two thirds of the way out, and thin ones all the way across.
    const gap = Math.abs(t - 0.62) < 0.035 ? 0.08 : 1;
    const a = Math.max(0, Math.min(1, (0.35 + 0.5 * rand()) * gap * Math.sin(t * Math.PI) ** 0.4));
    const tint = 200 + Math.floor(rand() * 40);
    g.fillStyle = `rgba(${tint + 10}, ${tint - 8}, ${tint - 50}, ${a})`;
    g.fillRect(x, 0, 1, h);
  }
}

/** The sky all round: the Milky Way across it, and a few clouds of glowing gas. */
export function starfield(w: number, h: number): (g: G) => void {
  return (g) => {
    const rand = seeded(99);
    g.fillStyle = '#02030a';
    g.fillRect(0, 0, w, h);
    // Where the Milky Way runs: a great circle, tilted, which on this map is a wave.
    const band = (x: number) => h / 2 + Math.sin((x / w) * Math.PI * 2 + 1.1) * h * 0.24;
    const blob = (x: number, y: number, r: number, color: string) => {
      const glow = g.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = glow;
      // Drawn again off each side, so nothing stops at the seam.
      for (const dx of [-w, 0, w]) g.fillRect(x + dx - r, y - r, 2 * r, 2 * r);
    };
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 150; i++) {
      const x = rand() * w;
      blob(x, band(x) + (rand() + rand() - 1) * h * 0.07, (0.03 + rand() * 0.06) * h, `rgba(${90 + rand() * 50}, ${100 + rand() * 40}, ${150 + rand() * 60}, ${0.035 + rand() * 0.04})`);
    }
    for (const [x, y, r, color] of [
      [0.14, 0.34, 0.2, 'rgba(120, 50, 170, 0.2)'],
      [0.2, 0.42, 0.13, 'rgba(210, 70, 130, 0.14)'],
      [0.47, 0.7, 0.18, 'rgba(30, 130, 150, 0.17)'],
      [0.66, 0.26, 0.16, 'rgba(60, 80, 190, 0.18)'],
      [0.86, 0.6, 0.15, 'rgba(160, 60, 110, 0.13)'],
    ] as const) {
      blob(x * w, y * h, r * h, color);
    }
    g.globalCompositeOperation = 'source-over';
    // Dust lanes down the middle of the Milky Way.
    for (let i = 0; i < 40; i++) {
      const x = rand() * w;
      blob(x, band(x) + (rand() - 0.5) * h * 0.03, (0.012 + rand() * 0.025) * h, 'rgba(2, 3, 10, 0.5)');
    }
    // The Milky Way's own stars, too many and too faint to tell apart: a grain along it. (The ones
    // you can tell apart are drawn sharp, in space.ts.)
    for (let i = 0; i < 4200; i++) {
      const x = rand() * w;
      const b = 120 + rand() * 110;
      g.fillStyle = `rgba(${b}, ${b}, ${Math.min(255, b + 25)}, ${0.1 + rand() * 0.16})`;
      g.beginPath();
      g.arc(x, band(x) + (rand() + rand() + rand() - 1.5) * h * 0.1, 1.1, 0, Math.PI * 2);
      g.fill();
    }
  };
}

/** The Sun's glare: white-hot in the middle, a warm halo round it, and rays across. */
export function sunGlare(g: G) {
  const { width: s } = g.canvas;
  const c = s / 2;
  g.clearRect(0, 0, s, s);
  const halo = g.createRadialGradient(c, c, 0, c, c, c);
  halo.addColorStop(0, 'rgba(255, 255, 255, 1)');
  halo.addColorStop(0.07, 'rgba(255, 252, 235, 1)');
  halo.addColorStop(0.12, 'rgba(255, 236, 180, 0.75)');
  halo.addColorStop(0.3, 'rgba(255, 200, 120, 0.2)');
  halo.addColorStop(0.6, 'rgba(255, 170, 90, 0.05)');
  halo.addColorStop(1, 'rgba(255, 160, 80, 0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    g.save();
    g.translate(c, c);
    g.rotate((i * Math.PI) / 6 + 0.2);
    const ray = g.createLinearGradient(-c, 0, c, 0);
    ray.addColorStop(0, 'rgba(255, 230, 190, 0)');
    ray.addColorStop(0.5, `rgba(255, 240, 210, ${i % 3 ? 0.18 : 0.42})`);
    ray.addColorStop(1, 'rgba(255, 230, 190, 0)');
    g.fillStyle = ray;
    g.fillRect(-c, -s * (i % 3 ? 0.004 : 0.008), s, s * (i % 3 ? 0.008 : 0.016));
    g.restore();
  }
  g.globalCompositeOperation = 'source-over';
}
