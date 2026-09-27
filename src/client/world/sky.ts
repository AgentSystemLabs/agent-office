import * as THREE from 'three';
import { FLOOR, SLAB, STREET_Y, WALL_T } from '../../shared/layout';
import type { SkyState, Weather } from '../../shared/protocol';
import { guessPlace, sunPosition } from '../../shared/sun';
import type { NightParts } from './outside';

/*
 * Day, night and the weather outside the windows. The server says where the office is and what the
 * weather is doing (server/sky.ts). From that and the clock, this works out where the sun is, and
 * every frame it sets the sky's color, the fog, the sun (or the moon), the lamps that come on at
 * night, and the rain or snow.
 *
 * The office has no roof, and the sun and the sky light everything, inside and out, so at night the
 * room would go as dark as the street. A few lines added to every lit material (below) give light
 * back where there are lamps: the office and the garage fill with lamplight, and each street lamp,
 * the balcony's string lights and the lamp over the exit throw a pool of light around them. The
 * same lines darken the ground outside when it's wet and lay snow on whatever faces up out there.
 */

const MAX_LAMPS = 24;
const DEG = Math.PI / 180;
/** The building, walls included: the office upstairs and the garage under it. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;

const uniforms = {
  /** Off while drawing your hands in first person, which live in a scene of their own. */
  skyOn: { value: 1 },
  /** Lamplight filling the office, and the garage: color × strength, in the units of three.js lights. */
  skyOffice: { value: new THREE.Color(0, 0, 0) },
  skyGarage: { value: new THREE.Color(0, 0, 0) },
  skyLampCount: { value: 0 },
  /** Each lamp's position and reach, and its color × strength. */
  skyLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },
  skyLampColors: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Color()) },
  /** Around all the lamps' pools, so everywhere else skips them. */
  skyLampMin: { value: new THREE.Vector3() },
  skyLampMax: { value: new THREE.Vector3() },
  /** How wet the ground is, and how much snow lies on it: 0–1. */
  skyWet: { value: 0 },
  skySnow: { value: 0 },
};

const v3 = (x: number, y: number, z: number) => `vec3(${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})`;

const PARS = /* glsl */ `
varying vec3 vSkyWorld;
uniform float skyOn;
uniform vec3 skyOffice;
uniform vec3 skyGarage;
uniform int skyLampCount;
uniform vec4 skyLamps[${MAX_LAMPS}];
uniform vec3 skyLampColors[${MAX_LAMPS}];
uniform vec3 skyLampMin;
uniform vec3 skyLampMax;
uniform float skyWet;
uniform float skySnow;

// Inside the office's walls (and up through its open top).
float skyInOffice( vec3 p ) {
  vec3 d = max( ${v3(FLOOR.minX - 0.02, -0.06, FLOOR.minZ - 0.02)} - p, p - ${v3(FLOOR.maxX + 0.02, 40, FLOOR.maxZ + 0.02)} );
  return 1.0 - smoothstep( 0.0, 0.12, length( max( d, 0.0 ) ) );
}

// Under the office: walled at the back and on the west side, open to the street on the south and east.
float skyInGarage( vec3 p ) {
  if ( p.x < ${(B.minX + 0.05).toFixed(3)} || p.z < ${(B.minZ + 0.05).toFixed(3)} || p.y < ${(STREET_Y - 0.5).toFixed(3)} || p.y > ${(-SLAB + 0.02).toFixed(3)} ) return 0.0;
  return 1.0 - smoothstep( 0.0, 3.0, length( max( p.xz - vec2( ${B.maxX.toFixed(3)}, ${B.maxZ.toFixed(3)} ), 0.0 ) ) );
}

vec3 skyLampsAt( vec3 p, vec3 n ) {
  vec3 sum = vec3( 0.0 );
  if ( any( lessThan( p, skyLampMin ) ) || any( greaterThan( p, skyLampMax ) ) ) return sum;
  for ( int i = 0; i < ${MAX_LAMPS}; i ++ ) {
    if ( i >= skyLampCount ) break;
    vec3 d = skyLamps[ i ].xyz - p;
    float r = length( d );
    float k = 1.0 - clamp( r / skyLamps[ i ].w, 0.0, 1.0 );
    sum += skyLampColors[ i ] * k * k * ( 0.3 + 0.7 * max( dot( n, d / max( r, 0.001 ) ), 0.0 ) );
  }
  return sum;
}
`;

/** Wet ground is darker; snow covers what faces up. Only outdoors. Runs before the lights. */
const SURFACE = /* glsl */ `
vec3 skyN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
float skyIndoor = skyOn * skyInOffice( vSkyWorld );
float skyGar = skyOn * skyInGarage( vSkyWorld );
float skyUp = skyOn * ( 1.0 - max( skyIndoor, skyGar ) ) * smoothstep( 0.45, 0.85, skyN.y );
material.diffuseColor *= 1.0 - 0.38 * skyWet * skyUp;
material.diffuseColor = mix( material.diffuseColor, vec3( 0.93, 0.96, 1.0 ), skySnow * skyUp );
`;

/** The lamps' light, added to what the sun and the sky give. */
const LIGHT = /* glsl */ `
if ( skyOn > 0.0 ) {
  vec3 skyLight = skyIndoor * skyOffice * ( 0.65 + 0.35 * skyN.y ) + ( 1.0 - skyIndoor ) * ( skyGar * skyGarage + skyLampsAt( vSkyWorld, skyN ) );
  reflectedLight.indirectDiffuse += skyLight * BRDF_Lambert( material.diffuseColor );
}
`;

const WORLD = /* glsl */ `
{
  vec4 skyW = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    skyW = batchingMatrix * skyW;
  #endif
  #ifdef USE_INSTANCING
    skyW = instanceMatrix * skyW;
  #endif
  vSkyWorld = ( modelMatrix * skyW ).xyz;
}
`;

// Every lit material gets the lines above, sharing one set of uniforms. Nothing else in the office
// uses onBeforeCompile, so this is its default; unlit ones (glass, signs, outlines) are left alone.
THREE.Material.prototype.onBeforeCompile = function (shader) {
  if (!shader.fragmentShader.includes('#include <lights_fragment_end>')) return;
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSkyWorld;').replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${PARS}`)
    .replace('#include <lights_fragment_begin>', `${SURFACE}\n#include <lights_fragment_begin>`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${LIGHT}`);
};

// ---- The sky ------------------------------------------------------------------------------------

const LABEL: Record<Weather, string> = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm', snow: 'Snow', fog: 'Fog' };
const ICON: Record<Weather, string> = { clear: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', snow: '🌨️', fog: '🌫️' };

/** "🌙 Clear · 9:41 PM office time · Berlin, Germany, 11 °C", for Settings. */
export function describeSky(s: SkyState, now = Date.now()): string {
  const night = sunPosition(now, s.lat, s.lon).el < -4 * DEG;
  const icon = s.weather === 'clear' && night ? '🌙' : ICON[s.weather];
  const time = new Date(now + s.utcOffset * 60_000).toLocaleTimeString([], { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
  const where = s.city ? ` · ${s.city}${s.temp !== undefined ? `, ${s.temp} °C` : ''}` : '';
  return `${icon} ${LABEL[s.weather]} · ${time} office time${where}`;
}

const lerp = THREE.MathUtils.lerp;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** Eases `x` toward `to`, most of the way in `secs`. */
const ease = (x: number, to: number, dt: number, secs: number) => x + (to - x) * (1 - Math.exp(-dt / secs));

const C = {
  day: new THREE.Color('#bfe3ff'),
  dusk: new THREE.Color('#ffb48c'),
  night: new THREE.Color('#0b1431'),
  greyDay: new THREE.Color('#aab3bf'),
  greyNight: new THREE.Color('#11151d'),
  fogDay: new THREE.Color('#d7dce2'),
  // Lit from below by the town, so it still reads as fog at night.
  fogNight: new THREE.Color('#3a414d'),
  flash: new THREE.Color('#e4e9ff'),
  sunHigh: new THREE.Color('#fff1d6'),
  sunLow: new THREE.Color('#ffa566'),
  moon: new THREE.Color('#a9bcff'),
  hemiSky: new THREE.Color('#fff5e6'),
  hemiGround: new THREE.Color('#c9a27a'),
  hemiSkyNight: new THREE.Color('#4b5b90'),
  hemiGroundNight: new THREE.Color('#1d1b29'),
  ambientNight: new THREE.Color('#8797cc'),
  white: new THREE.Color('#ffffff'),
  office: new THREE.Color('#fff2de'),
  officeNight: new THREE.Color('#ffd49c'),
  garage: new THREE.Color('#f6f2e4'),
  cloudGrey: new THREE.Color('#a3abb6'),
};

/** How strong the sun and the sky's light are on a clear day, which is what the lamps make up for. */
const FULL_DAY = 1.5 + 0.5 + 0.6 * 2.2;

export interface SkyLights {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
}

/** Soft round blob, for halos and snowflakes. */
function blobTexture(inner: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(inner, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Is (x, z) under the building, where no rain or snow falls? */
const sheltered = (x: number, z: number) => x > B.minX - 0.05 && x < B.maxX + 0.05 && z > B.minZ - 0.05 && z < B.maxZ + 0.05;

export class Sky {
  private preview: { hour?: number; weather?: Weather; intensity?: number } = {};
  /** Lightning struck; its thunder should follow `delay` seconds later. */
  onThunder: ((delay: number, loud: number) => void) | null = null;

  /** 1 in daylight, 0 at night. */
  daylight = 1;
  /** How hard it's raining (storms too) and snowing right now, 0–1, easing from one spell to the next. */
  rain = 0;
  snow = 0;
  /** How far the lamps are on, 0–1: at night, and on the darkest of days. */
  lampsOn = 0;

  private state: SkyState;
  private heard = false;
  private snap = true;
  private cover = 0;
  private fog = 0;
  private storm = 0;
  private wet = 0;
  private lying = 0;
  private flash = 0;
  private flashes: number[] = [];
  private nextFlash = 0;
  /** How much light the sun and the sky give (1 on a clear day), for your hands. */
  private level = 1;
  private readonly tmp = new THREE.Color();
  private readonly dir = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();

  private readonly dome = new THREE.Group();
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly sunDisc: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly moonDisc: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly halos: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = [];
  private readonly rainLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly drops: Float32Array;
  private readonly flakes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly flakeState: Float32Array;
  private readonly glass: WetGlass;

  constructor(
    private scene: THREE.Scene,
    private lights: SkyLights,
    private night: NightParts,
  ) {
    const here = guessPlace();
    this.state = { ...here, utcOffset: -new Date().getTimezoneOffset(), weather: 'clear', intensity: 0 };
    scene.fog ??= new THREE.Fog('#bfe3ff', 40, 90);
    if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color('#bfe3ff');

    // The lamps' pools of light, and the box around all of them.
    const lamps = night.lamps.slice(0, MAX_LAMPS);
    const lo = uniforms.skyLampMin.value.set(Infinity, Infinity, Infinity);
    const hi = uniforms.skyLampMax.value.set(-Infinity, -Infinity, -Infinity);
    lamps.forEach((l, i) => {
      uniforms.skyLamps.value[i].set(l.x, l.y, l.z, l.reach);
      lo.min(new THREE.Vector3(l.x - l.reach, l.y - l.reach, l.z - l.reach));
      hi.max(new THREE.Vector3(l.x + l.reach, l.y + l.reach, l.z + l.reach));
    });

    // Stars, the sun and the moon, far off, always around you.
    const starPos: number[] = [];
    for (let i = 0; i < 700; i++) {
      const y = rand(0.08, 1);
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(1 - y * y);
      starPos.push(Math.cos(a) * r * 170, y * 170, Math.sin(a) * r * 170);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    const disc = (r: number, color: string) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color, transparent: true, fog: false, depthWrite: false }));
      m.material.userData.outlineParameters = { visible: false };
      return m;
    };
    this.sunDisc = disc(5, '#fff4c8');
    this.moonDisc = disc(3.2, '#f2f1ea');
    this.dome.add(this.stars, this.sunDisc, this.moonDisc);
    scene.add(this.dome);

    // Halos round the bulbs at night, one set of points per size.
    const halo = blobTexture(0.25);
    const bySize = new Map<number, { pos: number[]; col: number[] }>();
    for (const h of night.halos) {
      let set = bySize.get(h.size);
      if (!set) bySize.set(h.size, (set = { pos: [], col: [] }));
      set.pos.push(h.at.x, h.at.y, h.at.z);
      const c = new THREE.Color(h.color);
      set.col.push(c.r, c.g, c.b);
    }
    for (const [size, { pos, col }] of bySize) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const p = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: halo, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      p.visible = false;
      this.halos.push(p);
      scene.add(p);
    }

    // Rain: streaks falling around you (x, y, z, speed per drop).
    const RAIN = 3000;
    this.drops = new Float32Array(RAIN * 4);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rainLines = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#bcd0e6', transparent: true, opacity: 0.5, depthWrite: false }));
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    for (let i = 0; i < RAIN; i++) this.drops.set([rand(-24, 24), rand(0, 26), rand(-24, 24), rand(14, 20)], i * 4);
    scene.add(this.rainLines);

    // Snow: flakes drifting down around you (x, y, z, speed per flake).
    const SNOW = 3500;
    this.flakeState = new Float32Array(SNOW * 4);
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.flakes = new THREE.Points(snowGeo, new THREE.PointsMaterial({ size: 0.14, map: blobTexture(0.5), transparent: true, depthWrite: false, color: '#ffffff' }));
    this.flakes.frustumCulled = false;
    this.flakes.visible = false;
    for (let i = 0; i < SNOW; i++) this.flakeState.set([rand(-20, 20), rand(0, 22), rand(-20, 20), rand(0.7, 1.3)], i * 4);
    scene.add(this.flakes);

    this.glass = new WetGlass(night.wetGlass);
  }

  /** The server's word on the sky. The weather eases from one spell to the next; a new place lands at once. */
  set(state: SkyState) {
    if (!this.heard || state.lat !== this.state.lat || state.lon !== this.state.lon) this.snap = true;
    this.state = state;
    this.heard = true;
  }

  /** For quick checks from the console: show this hour of the office's day, or this weather, right away. */
  show(preview: { hour?: number; weather?: Weather; intensity?: number }) {
    this.preview = preview;
    this.snap = true;
  }

  /** Whether the lamps' light (and wet and snow) apply: off while your hands are drawn. */
  shading(on: boolean) {
    uniforms.skyOn.value = on ? 1 : 0;
  }

  /** How lit it is at `p`, 0–1 (1 is a clear day, or a room with its lights on), for your hands. */
  lightAt(p: THREE.Vector3): number {
    const inside = (p.x > FLOOR.minX && p.x < FLOOR.maxX && p.z > FLOOR.minZ && p.z < FLOOR.maxZ) || (sheltered(p.x, p.z) && p.y < 0);
    if (inside) return 1;
    let lamp = 0;
    for (const l of this.night.lamps) lamp = Math.max(lamp, 1 - Math.hypot(l.x - p.x, l.y - p.y, l.z - p.z) / l.reach);
    return Math.min(1, Math.max(this.level, lamp * this.lampsOn));
  }

  /** The office's clock (ms), or the previewed hour today. */
  private now(): number {
    const h = this.preview.hour;
    if (h === undefined) return Date.now();
    const off = this.state.utcOffset * 60_000;
    const midnight = Math.floor((Date.now() + off) / 86_400_000) * 86_400_000;
    return midnight - off + h * 3_600_000;
  }

  update(dt: number, t: number, camera: THREE.Camera) {
    const s = this.state;
    const weather = this.preview.weather ?? s.weather;
    const k = this.preview.intensity ?? (this.preview.weather ? 0.8 : s.intensity);
    const snap = this.snap;
    this.snap = false;
    const step = (x: number, to: number, secs: number) => (snap ? to : ease(x, to, dt, secs));

    // The weather, easing from one spell to the next.
    const want = {
      cover: { clear: 0, cloudy: k, rain: 0.8 + 0.2 * k, storm: 1, snow: 0.85, fog: 0.5 }[weather],
      rain: weather === 'rain' ? k : weather === 'storm' ? Math.max(0.8, k) : 0,
      snow: weather === 'snow' ? k : 0,
      fog: weather === 'fog' ? k : weather === 'rain' ? 0.12 * k : weather === 'snow' ? 0.3 * k : 0,
      storm: weather === 'storm' ? 1 : 0,
    };
    this.cover = step(this.cover, want.cover, 20);
    this.rain = step(this.rain, want.rain, 12);
    this.snow = step(this.snow, want.snow, 12);
    this.fog = step(this.fog, want.fog, 20);
    this.storm = step(this.storm, want.storm, 10);
    // Wet ground dries off slowly; snow piles up over a few minutes and takes a while to melt.
    this.wet = snap ? (this.rain > 0.05 ? 1 : 0) : ease(this.wet, this.rain > 0.05 ? 1 : 0, dt, this.rain > 0.05 ? 30 : 400);
    this.lying = snap ? (this.snow > 0.05 ? 1 : 0) : ease(this.lying, this.snow > 0.05 ? 1 : 0, dt, this.snow > 0.05 ? 120 : 900);
    uniforms.skyWet.value = this.wet * (1 - this.lying);
    uniforms.skySnow.value = this.lying * 0.9;

    // The sun, and how much light it and the sky give.
    const { el, az } = sunPosition(this.now(), s.lat, s.lon);
    const elD = el / DEG;
    const day = smooth(-8, 4, elD);
    const dusk = Math.max(0, 1 - Math.abs(elD + 1) / 9) * (1 - this.cover);
    this.daylight = day;
    this.lightning(t, dt);
    const flash = this.flash;
    const sunI = 2.2 * smooth(-3, 10, elD) * (1 - 0.8 * this.cover) * (1 - 0.6 * this.fog);
    const moonI = 0.4 * smooth(-4, -12, elD) * (1 - 0.75 * this.cover);
    const hemiI = lerp(0.38, 1.5 * (1 - 0.25 * this.cover) * (1 - 0.35 * this.storm), day);
    const ambI = lerp(0.12, 0.5, day);
    const { sun, hemi, ambient } = this.lights;
    hemi.intensity = hemiI + flash * 3;
    hemi.color.copy(C.hemiSkyNight).lerp(C.hemiSky, day);
    hemi.groundColor.copy(C.hemiGroundNight).lerp(C.hemiGround, day);
    ambient.intensity = ambI + flash;
    ambient.color.copy(C.ambientNight).lerp(C.white, day);
    // A cartoon sun: never so low its shadows fill the room. At night the moon lights things, from across the sky.
    const moonlit = elD < -4;
    const lightEl = (moonlit ? 50 : 25 + Math.max(0, elD) * 0.6) * DEG;
    const lightAz = moonlit ? az + Math.PI : az;
    this.dir.set(Math.cos(lightEl) * Math.sin(lightAz), Math.sin(lightEl), -Math.cos(lightEl) * Math.cos(lightAz));
    sun.position.copy(sun.target.position).addScaledVector(this.dir, 45);
    sun.intensity = moonlit ? moonI : sunI;
    if (moonlit) sun.color.copy(C.moon);
    else sun.color.copy(C.sunLow).lerp(C.sunHigh, smooth(0, 25, elD));
    this.level = clamp01((hemiI + ambI + 0.6 * (sunI + moonI)) / FULL_DAY);

    // Lamps come on as it gets dark: the office's and the garage's, and the ones outside.
    const need = 1 - this.level;
    this.lampsOn = smooth(0.45, 0.62, need);
    uniforms.skyOffice.value.copy(C.office).lerp(C.officeNight, 1 - day).multiplyScalar(need * 3.2);
    uniforms.skyGarage.value.copy(C.garage).multiplyScalar(need * 2);
    const lamps = Math.min(this.night.lamps.length, MAX_LAMPS);
    uniforms.skyLampCount.value = this.lampsOn > 0.005 ? lamps : 0;
    for (let i = 0; i < lamps; i++) {
      const l = this.night.lamps[i];
      uniforms.skyLampColors.value[i].set(l.color).multiplyScalar(l.power * this.lampsOn);
    }
    for (const b of this.night.bulbs) b.mat.emissiveIntensity = lerp(b.day, 1, this.lampsOn);
    for (const m of this.night.windows) m.emissiveIntensity = this.lampsOn * 1.1;
    for (const h of this.halos) {
      h.material.opacity = this.lampsOn * 0.85;
      h.visible = this.lampsOn > 0.01;
    }

    // The sky's color, and the fog, which fades far things into it.
    const sky = (this.scene.background as THREE.Color).copy(C.night).lerp(C.day, day);
    sky.lerp(C.dusk, dusk * 0.55);
    sky.lerp(this.tmp.copy(C.greyNight).lerp(C.greyDay, day), this.cover * 0.85);
    sky.lerp(this.tmp.copy(C.fogNight).lerp(C.fogDay, day), this.fog);
    sky.lerp(C.flash, flash * 0.5);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    const precip = Math.max(this.rain, this.snow);
    fog.near = lerp(40, 3, this.fog) * (1 - 0.4 * precip);
    fog.far = lerp(90, 28, this.fog) * (1 - 0.3 * precip);
    this.night.clouds.color.copy(C.white).lerp(C.cloudGrey, this.cover);
    this.night.clouds.visible = this.fog < 0.6;

    // Stars, the sun and the moon ride along with you, so they look infinitely far off.
    camera.getWorldPosition(this.camPos);
    this.dome.position.copy(this.camPos);
    const clear = (1 - this.cover) * (1 - this.fog);
    this.stars.material.opacity = (1 - day) ** 2 * clear;
    this.stars.visible = this.stars.material.opacity > 0.01;
    const up = (e: number, a: number, m: THREE.Mesh) => m.position.set(Math.cos(e) * Math.sin(a) * 160, Math.sin(e) * 160, -Math.cos(e) * Math.cos(a) * 160);
    up(el, az, this.sunDisc);
    this.sunDisc.material.color.copy(C.sunLow).lerp(C.white, smooth(0, 20, elD));
    this.sunDisc.material.opacity = smooth(-3, 0, elD) * clear;
    this.sunDisc.visible = this.sunDisc.material.opacity > 0.01;
    up(-el, az + Math.PI, this.moonDisc);
    this.moonDisc.material.opacity = smooth(2, -2, elD) * clear;
    this.moonDisc.visible = this.moonDisc.material.opacity > 0.01;

    // Rain and snow fall outside, lit about as much as everything else is.
    const lit = 0.3 + 0.7 * Math.max(this.level, this.lampsOn * 0.5);
    this.rainLines.material.color.set('#bcd0e6').multiplyScalar(lit);
    this.flakes.material.color.setScalar(lit);
    this.fall(dt, t);
    this.glass.update(dt, this.rain, lit);
  }

  /** In a storm, now and then the sky flashes (twice, quickly) and thunder rolls in after. */
  private lightning(t: number, dt: number) {
    if (this.storm > 0.5 && t >= this.nextFlash) {
      if (this.nextFlash > 0) {
        this.flashes.push(t, t + rand(0.1, 0.25));
        if (Math.random() < 0.5) this.flashes.push(t + rand(0.35, 0.6));
        this.onThunder?.(rand(0.3, 3), rand(0.5, 1));
      }
      this.nextFlash = t + rand(6, 20);
    }
    this.flash *= Math.exp(-dt * 10);
    while (this.flashes.length && this.flashes[0] <= t) {
      this.flashes.shift();
      this.flash = Math.max(this.flash, rand(0.7, 1));
    }
  }

  private fall(dt: number, t: number) {
    const cx = this.camPos.x;
    const cz = this.camPos.z;
    const wrap = (v: number, c: number, half: number) => (v - c > half ? v - 2 * half : v - c < -half ? v + 2 * half : v);

    const rainN = Math.round((this.drops.length / 4) * this.rain);
    this.rainLines.visible = rainN > 0;
    if (rainN > 0) {
      const pos = this.rainLines.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      const slant = 0.1 + 0.3 * this.storm;
      for (let i = 0; i < rainN; i++) {
        const d = i * 4;
        const speed = this.drops[d + 3];
        let x = wrap(this.drops[d] + slant * speed * dt, cx, 24);
        let y = this.drops[d + 1] - speed * dt;
        let z = wrap(this.drops[d + 2], cz, 24);
        if (y < STREET_Y) {
          y += 26;
          x = cx + rand(-24, 24);
          z = cz + rand(-24, 24);
        }
        this.drops[d] = x;
        this.drops[d + 1] = y;
        this.drops[d + 2] = z;
        const len = sheltered(x, z) ? 0 : 0.5;
        a.set([x, y, z, x - slant * len, y + len, z], i * 6);
      }
      pos.needsUpdate = true;
      this.rainLines.geometry.setDrawRange(0, rainN * 2);
    }

    const snowN = Math.round((this.flakeState.length / 4) * this.snow);
    this.flakes.visible = snowN > 0;
    if (snowN > 0) {
      const pos = this.flakes.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < snowN; i++) {
        const f = i * 4;
        const speed = this.flakeState[f + 3];
        let x = wrap(this.flakeState[f] + Math.sin(t * 0.9 + i) * 0.3 * dt + 0.15 * dt, cx, 20);
        let y = this.flakeState[f + 1] - speed * dt;
        let z = wrap(this.flakeState[f + 2] + Math.cos(t * 0.7 + i * 1.3) * 0.3 * dt, cz, 20);
        if (y < STREET_Y) {
          y += 22;
          x = cx + rand(-20, 20);
          z = cz + rand(-20, 20);
        }
        this.flakeState[f] = x;
        this.flakeState[f + 1] = y;
        this.flakeState[f + 2] = z;
        a.set([x, sheltered(x, z) ? -1000 : y, z], i * 3);
      }
      pos.needsUpdate = true;
      this.flakes.geometry.setDrawRange(0, snowN);
    }
  }
}

interface Drop {
  x: number;
  y: number;
  r: number;
  /** Running down the glass this fast (px/s), or 0 while it clings. */
  vy: number;
  trail: number;
  age: number;
  life: number;
}

/** Raindrops on the windows: they land, cling, now and then run down, and dry off after the rain. */
class WetGlass {
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private drops: Drop[] = [];
  private since = 0;
  private spawn = 0;

  constructor(private mat: THREE.MeshBasicMaterial) {
    // 90 cm of glass square (see wetPane in office.ts).
    this.canvas.width = this.canvas.height = 256;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
    mat.map = this.tex;
    mat.needsUpdate = true;
  }

  update(dt: number, rain: number, lit: number) {
    this.since += dt;
    this.spawn += rain * 70 * dt;
    for (; this.spawn >= 1; this.spawn--) {
      if (this.drops.length < 220) this.drops.push({ x: rand(0, 256), y: rand(0, 256), r: rand(1.6, 4.4), vy: 0, trail: 0, age: 0, life: rand(4, 12) });
    }
    for (const d of this.drops) {
      d.age += dt;
      if (!d.vy && d.r > 3.4 && Math.random() < dt * 0.4) d.vy = rand(50, 140);
      if (d.vy) {
        d.y += d.vy * dt;
        d.trail = Math.min(d.trail + d.vy * dt, 70);
      }
    }
    this.drops = this.drops.filter((d) => d.age < d.life && d.y < 256 + 80);
    this.mat.visible = this.drops.length > 0;
    // A dozen redraws a second is plenty for drops.
    if (!this.mat.visible || this.since < 0.08) return;
    this.since = 0;
    this.mat.color.setScalar(lit);
    const g = this.g;
    g.clearRect(0, 0, 256, 256);
    for (const d of this.drops) {
      const fade = Math.min(1, (d.life - d.age) / 1.5);
      // Near an edge, draw it on the other side too, so the glass tiles without seams.
      for (const ox of d.x < 8 ? [0, 256] : d.x > 248 ? [0, -256] : [0]) {
        for (const oy of [0, -256]) {
          const x = d.x + ox;
          const y = d.y + oy;
          if (y + d.r < -80 || y - d.r - d.trail > 256) continue;
          if (d.trail > 0) {
            g.fillStyle = `rgba(225, 238, 255, ${0.22 * fade})`;
            g.fillRect(x - d.r * 0.35, y - d.trail, d.r * 0.7, d.trail);
          }
          g.fillStyle = `rgba(214, 230, 250, ${0.5 * fade})`;
          g.beginPath();
          g.ellipse(x, y, d.r, d.r * 1.15, 0, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = `rgba(30, 50, 80, ${0.5 * fade})`;
          g.lineWidth = 1;
          g.stroke();
          g.fillStyle = `rgba(255, 255, 255, ${0.85 * fade})`;
          g.beginPath();
          g.arc(x - d.r * 0.35, y - d.r * 0.4, d.r * 0.32, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    this.tex.needsUpdate = true;
  }
}
