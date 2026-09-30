import * as THREE from 'three';
import { FLOOR, SLAB, STREET_Y, WALL_HEIGHT, WALL_T, WING, wingMinZ } from '../../shared/layout';
import type { SkyState, Theme, Weather } from '../../shared/protocol';
import { guessPlace, skyTime, sunPosition } from '../../shared/sun';
import type { NightParts } from './outside';

/*
 * Day, night and the weather outside the windows. The server says where the office is and what the
 * weather is doing (server/sky.ts). From that and the office's clock, sped up so a whole day and
 * night go by every hour (see skyTime), this works out where the sun is, and every frame it sets
 * the sky's color, the fog, the sun (or the moon), the lamps that come on at night, and the rain or snow.
 *
 * The office has no roof, and the sun and the sky light everything, inside and out, so at night the
 * room would go as dark as the street. A few lines added to every lit material (below) give light
 * back where there are lamps: the office and the garage fill with lamplight, and each street lamp,
 * the balcony's string lights and the lamp over the exit throw a pool of light around them. The
 * same lines darken the ground outside when it's wet and lay snow on whatever faces up out there.
 */

const MAX_LAMPS = 24;
const DEG = Math.PI / 180;
/**
 * The furthest off the haze ever is, however high up you are: past that nothing's built (the grass
 * and the road round the office end there, the city round the roof just past it), so it hides that.
 */
export const HAZE_MAX = 300;
/**
 * The haze thins out with height over the street: past HAZE_CLEAR meters up, every HAZE_ABOVE
 * meters more you see as far again as down on the street (from the roof of six floors, 3.4 times).
 */
const HAZE_CLEAR = 6;
const HAZE_ABOVE = 17.5;

/**
 * How far off something's lost in the haze (with the fog's far edge down on the street at `far`),
 * seen from or standing `above` meters over the street, whichever's higher (see HAZE).
 */
export function hazeReach(above: number, far: number): number {
  return Math.min(HAZE_MAX, far * (1 + Math.max(0, above - HAZE_CLEAR) / HAZE_ABOVE));
}
/** The building, walls included: the office upstairs and the garage under it. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;

const uniforms = {
  /** Off while drawing your hands in first person, which live in a scene of their own. */
  skyOn: { value: 1 },
  /** Off up on the roof, where the office and the garage (which are under your feet there) aren't lit. */
  skyInside: { value: 1 },
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
  /** How much further down the garage is than from the bottom floor: a storey for each floor below yours. */
  skyDrop: { value: 0 },
  /** Where the street is, which the haze thins out with height over. */
  skyStreet: { value: STREET_Y },
  /** The back office, when the floor's built out into one (see WING): minX, maxX, minZ, maxZ. Empty without. */
  skyWing: { value: new THREE.Vector4(1, 0, 1, 0) },
};

const v3 = (x: number, y: number, z: number) => `vec3(${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})`;

const PARS = /* glsl */ `
varying vec3 vSkyWorld;
uniform float skyOn;
uniform float skyInside;
uniform vec3 skyOffice;
uniform vec3 skyGarage;
uniform int skyLampCount;
uniform vec4 skyLamps[${MAX_LAMPS}];
uniform vec3 skyLampColors[${MAX_LAMPS}];
uniform vec3 skyLampMin;
uniform vec3 skyLampMax;
uniform float skyWet;
uniform float skySnow;
uniform float skyDrop;
uniform vec4 skyWing;

// Inside the office's walls (and up through its open top), or the back office's, up to its ceiling
// and no further: its roof, and the cornice over where the wall came down, are outdoors.
float skyInOffice( vec3 p ) {
  vec3 d = max( ${v3(FLOOR.minX - 0.02, -0.06, FLOOR.minZ - 0.02)} - p, p - ${v3(FLOOR.maxX + 0.02, 40, FLOOR.maxZ + 0.02)} );
  vec3 w = max( vec3( skyWing.x, -0.06, skyWing.z ) - p, p - vec3( skyWing.y, ${(WALL_HEIGHT + 0.005).toFixed(3)}, skyWing.w ) );
  float wing = length( max( w, 0.0 ) ) + step( ${(WALL_HEIGHT + 0.005).toFixed(3)}, p.y );
  return 1.0 - smoothstep( 0.0, 0.12, min( length( max( d, 0.0 ) ), wing ) );
}

// Under the bottom floor: walled at the back and on the west side, open to the street on the south and east.
float skyInGarage( vec3 p ) {
  if ( p.x < ${(B.minX + 0.05).toFixed(3)} || p.z < ${(B.minZ + 0.05).toFixed(3)} || p.y + skyDrop < ${(STREET_Y - 0.5).toFixed(3)} || p.y + skyDrop > ${(-SLAB + 0.02).toFixed(3)} ) return 0.0;
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
float skyIndoor = skyOn * skyInside * skyInOffice( vSkyWorld );
float skyGar = skyOn * skyInside * skyInGarage( vSkyWorld );
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

/**
 * The haze, over three.js's own fog: it thins out with height over the street (see HAZE_ABOVE), as
 * thin as it is at your eye or at what you're looking at, whichever is higher. So from high up you
 * see further, the street below included, and from down on the street the top of the building is
 * as clear as the view from up there. Past HAZE_MAX there's nothing to see, whatever the height.
 */
const HAZE_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vSkyFogY;
#endif
`;

/** How high the vertex is: the view matrix undone (its rotation's transpose), from the camera. */
const HAZE_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vSkyFogY = dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ) + cameraPosition.y;
#endif
`;

const HAZE_PARS = /* glsl */ `
#ifdef USE_FOG
  varying float vSkyFogY;
  uniform float skyStreet;
#endif
`;

const HAZE = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    // How many times as far off the haze is as down on the street; and past HAZE_MAX, from 45% of
    // the way there, as the haze on the roof always went.
    float skyReach = 1.0 + max( max( cameraPosition.y, vSkyFogY ) - skyStreet - ${HAZE_CLEAR.toFixed(1)}, 0.0 ) / ${HAZE_ABOVE.toFixed(1)};
    float fogFactor = max( smoothstep( fogNear, fogFar, vFogDepth / skyReach ), smoothstep( ${(HAZE_MAX * 0.45).toFixed(1)}, ${HAZE_MAX.toFixed(1)}, vFogDepth ) );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

// Everything with fog gets the haze above; every lit material also gets the lines before that,
// sharing one set of uniforms. Nothing else in the office uses onBeforeCompile, so this is its
// default; unlit ones (glass, signs, outlines) only get the haze.
THREE.Material.prototype.onBeforeCompile = function (shader) {
  if (shader.fragmentShader.includes('#include <fog_fragment>')) {
    shader.uniforms.skyStreet = uniforms.skyStreet;
    shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', `#include <fog_pars_vertex>\n${HAZE_PARS_VERTEX}`).replace('#include <fog_vertex>', `#include <fog_vertex>\n${HAZE_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${HAZE_PARS}`).replace('#include <fog_fragment>', HAZE);
  }
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

/** "🌙 Clear · 9:41 PM outside · Berlin, Germany, 11 °C", for Settings: the time of day in the sky (see skyTime). */
export function describeSky(s: SkyState, now = Date.now()): string {
  const sky = skyTime(now, s.utcOffset);
  const night = sunPosition(sky, s.lat, s.lon).el < -4 * DEG;
  const icon = s.weather === 'clear' && night ? '🌙' : ICON[s.weather];
  const time = new Date(sky + s.utcOffset * 60_000).toLocaleTimeString([], { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
  const where = s.city ? ` · ${s.city}${s.temp !== undefined ? `, ${s.temp} °C` : ''}` : '';
  return `${icon} ${LABEL[s.weather]} · ${time} outside${where}`;
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

/** Halloween's sky: a bruised purple overhead going blood orange at the horizon, and a big harvest moon. */
const SPOOKY = {
  day: new THREE.Color('#6f5b8e'),
  dusk: new THREE.Color('#ff5a1f'),
  night: new THREE.Color('#24102f'),
  greyDay: new THREE.Color('#5b5068'),
  greyNight: new THREE.Color('#150d1f'),
  fogDay: new THREE.Color('#7e7194'),
  fogNight: new THREE.Color('#34223f'),
  zenithDay: new THREE.Color('#3a2358'),
  zenithNight: new THREE.Color('#07020d'),
  glow: new THREE.Color('#ff6a2a'),
  cloud: new THREE.Color('#5a4f6e'),
  hemiSky: new THREE.Color('#c3b0ff'),
  hemiGround: new THREE.Color('#5a3d2b'),
  sun: new THREE.Color('#ff8a45'),
  moon: new THREE.Color('#ffc46b'),
  moonLight: new THREE.Color('#c9b3ff'),
};
/**
 * Where Halloween's harvest moon hangs, whatever the hour: low in the south, just over the roofs across
 * the street from the balcony, and in sight through the south windows.
 */
export const SPOOKY_MOON = { el: 21 * DEG, az: 182 * DEG } as const;

/** The way to (el, az) from the middle of the sky. */
const skyward = (el: number, az: number, out: THREE.Vector3) => out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));

/** A dome behind everything, shading from the horizon up to the zenith, with a glow low down and round the moon: Halloween's. */
function gradientDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      glow: { value: new THREE.Color() },
      glowK: { value: 0 },
      moonDir: { value: new THREE.Vector3(0, 0, 1) },
      moonGlow: { value: new THREE.Color() },
      opacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 glow;
      uniform float glowK;
      uniform vec3 moonDir;
      uniform vec3 moonGlow;
      uniform float opacity;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize( vDir );
        vec3 c = mix( horizon, top, smoothstep( 0.0, 0.6, d.y ) );
        c = mix( c, glow, glowK * exp( -abs( d.y ) * 7.0 ) );
        float m = max( dot( d, moonDir ), 0.0 );
        c += moonGlow * ( pow( m, 60.0 ) * 0.9 + pow( m, 10.0 ) * 0.14 );
        gl_FragColor = vec4( c, opacity );
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  // The outline pass would paint the inside of the dome over in ink.
  mat.userData.outlineParameters = { visible: false };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(185, 32, 16), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.visible = false;
  return dome;
}

/** A pale moon with darker seas on it. */
function moonTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(120, 110, 130, ${0.12 + Math.random() * 0.2})`;
    g.beginPath();
    g.ellipse(Math.random() * 256, 20 + Math.random() * 88, 6 + Math.random() * 18, 5 + Math.random() * 12, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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

/** The back office, walls included, when the floor you're on is built out into one (see Sky.setWing). */
let wingBox: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

/** Is (x, z) under the building, where no rain or snow falls? */
const sheltered = (x: number, z: number) =>
  (x > B.minX - 0.05 && x < B.maxX + 0.05 && z > B.minZ - 0.05 && z < B.maxZ + 0.05) || (!!wingBox && x > wingBox.minX - 0.05 && x < wingBox.maxX + 0.05 && z > wingBox.minZ - 0.05 && z < wingBox.maxZ);

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
  /** Up on the roof: out in the open, over the whole city (see setRoof). */
  private roof = false;
  /** In a hall with a roof and walls all round (a map other than the office's, see setIndoors). */
  private indoors = false;
  /**
   * How far out into the country you are, 0–1 (out on the scenic loop, see shared/scenic.ts): the
   * haze near the ground thins out to more than twice as far, so the mountains and the sea show from the road.
   */
  open = 0;
  /** Where the street is from up there (the roof is at 0), for the haze. */
  private roofStreet = 0;

  private state: SkyState;
  private heard = false;
  private snap = true;
  /** The building's holiday (see setTheme), and how far into Halloween's and Christmas's skies it's eased, 0–1. */
  private theme: Theme | null = null;
  spooky = 0;
  private festive = 0;
  /** Seconds left of hurrying the weather along, after the theme changed. */
  private rush = 0;
  /** When a far-off flash lights the Halloween sky next. */
  private nextSpook = 0;
  private readonly spookyDome = gradientDome();
  private readonly moonAt = new THREE.Vector3();
  private readonly moonTo = new THREE.Vector3();
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
  private readonly tmp2 = new THREE.Color();
  private readonly dir = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();

  private readonly dome = new THREE.Group();
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly sunDisc: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly moonDisc: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly halos: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = [];
  /** The halos down by the street, which go down with it. */
  private readonly groundHalos = new THREE.Group();
  /** Where the street was when the lamps were last put in place (see NightParts.street). */
  private street = NaN;
  private readonly rainLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly drops: Float32Array;
  private readonly flakes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly flakeState: Float32Array;
  private readonly glass: WetGlass;

  constructor(
    private scene: THREE.Scene,
    private lights: SkyLights,
    private night: NightParts,
    /** The office's clock (ms since 1970), which everyone's sky keeps time by. */
    private clock: () => number = Date.now,
  ) {
    const here = guessPlace();
    this.state = { ...here, utcOffset: -new Date().getTimezoneOffset(), weather: 'clear', intensity: 0 };
    scene.fog ??= new THREE.Fog('#bfe3ff', 40, 90);
    if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color('#bfe3ff');

    this.placeLamps();

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
    this.moonDisc.material.map = moonTexture();
    this.dome.add(this.spookyDome, this.stars, this.sunDisc, this.moonDisc);
    scene.add(this.dome);

    // Halos round the bulbs at night, one set of points per size (and per floor or street).
    const halo = blobTexture(0.25);
    const bySize = new Map<string, { size: number; ground: boolean; pos: number[]; col: number[] }>();
    for (const h of night.halos) {
      const key = `${h.size}|${!!h.ground}`;
      let set = bySize.get(key);
      if (!set) bySize.set(key, (set = { size: h.size, ground: !!h.ground, pos: [], col: [] }));
      set.pos.push(h.at.x, h.at.y, h.at.z);
      const c = new THREE.Color(h.color);
      set.col.push(c.r, c.g, c.b);
    }
    for (const { size, ground, pos, col } of bySize.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const p = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: halo, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      p.visible = false;
      this.halos.push(p);
      (ground ? this.groundHalos : scene).add(p);
    }
    scene.add(this.groundHalos);

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

  /**
   * The building's holiday: Halloween's sky is a creepy one, purple and blood orange with a harvest
   * moon hanging low and the odd far-off flash, dim enough that the lamps and the jack-o'-lanterns
   * glow; Christmas brings snow. Either eases in over a few seconds.
   */
  setTheme(theme: Theme | null) {
    if (theme === this.theme) return;
    this.theme = theme;
    if (this.heard) this.rush = 10;
  }

  /** For quick checks from the console: show this hour of the office's day, or this weather, right away. */
  show(preview: { hour?: number; weather?: Weather; intensity?: number }) {
    this.preview = preview;
    this.snap = true;
  }

  /**
   * The lamps' pools of light, and the box around all of them. The ones down by the street are as
   * far down as the street is from the floor you're on.
   */
  private placeLamps() {
    this.street = this.night.street;
    const drop = STREET_Y - this.street;
    uniforms.skyDrop.value = drop;
    this.groundHalos.position.y = -drop;
    const lo = uniforms.skyLampMin.value.set(Infinity, Infinity, Infinity);
    const hi = uniforms.skyLampMax.value.set(-Infinity, -Infinity, -Infinity);
    this.night.lamps.slice(0, MAX_LAMPS).forEach((l, i) => {
      const y = l.ground ? l.y - drop : l.y;
      uniforms.skyLamps.value[i].set(l.x, y, l.z, l.reach);
      lo.min(new THREE.Vector3(l.x - l.reach, y - l.reach, l.z - l.reach));
      hi.max(new THREE.Vector3(l.x + l.reach, y + l.reach, l.z + l.reach));
    });
  }

  /**
   * Up on the roof, `drop` over the street (or back down on a floor). Up there it's all outdoors: no
   * lamplight from the office under your feet, no pools of light from the street lamps far below, and
   * rain everywhere. The haze thins out with height over the street far below (see HAZE).
   */
  setRoof(on: boolean, drop = 0) {
    this.roof = on;
    this.roofStreet = -drop;
    uniforms.skyInside.value = on || this.indoors ? 0 : 1;
  }

  /**
   * Inside a hall of a map of its own (the castle), walled and roofed all round, or back in the
   * office (false): no rain or snow falls where you are, nothing gets wet or snowy, and the office's
   * lamps and the street's don't light it (it lights itself: see World.mood).
   */
  setIndoors(on: boolean) {
    this.indoors = on;
    uniforms.skyInside.value = on || this.roof ? 0 : 1;
  }

  /**
   * The floor you're on is built out `level` rows into the back office (see WING): lit like the
   * office inside, and out of the rain.
   */
  setWing(level: number) {
    const minZ = wingMinZ(level);
    wingBox = level > 0 ? { minX: WING.minX - WALL_T, maxX: WING.maxX + WALL_T, minZ: minZ - WALL_T, maxZ: FLOOR.minZ } : null;
    if (level > 0) uniforms.skyWing.value.set(WING.minX - 0.02, WING.maxX + 0.02, minZ - 0.02, FLOOR.minZ);
    else uniforms.skyWing.value.set(1, 0, 1, 0);
  }

  /** Under a roof, out of the rain: the building, unless you're up on top of it. */
  private sheltered(x: number, z: number): boolean {
    return this.indoors || (!this.roof && sheltered(x, z));
  }

  /** Whether the lamps' light (and wet and snow) apply: off while your hands are drawn. */
  shading(on: boolean) {
    uniforms.skyOn.value = on ? 1 : 0;
  }

  /** How lit it is at `p`, 0–1 (1 is a clear day, or a room with its lights on), for your hands. */
  lightAt(p: THREE.Vector3): number {
    if (this.indoors) return 1;
    const inside = !this.roof && ((p.x > FLOOR.minX && p.x < FLOOR.maxX && p.z > FLOOR.minZ && p.z < FLOOR.maxZ) || (sheltered(p.x, p.z) && (p.y < 0 || p.z < FLOOR.minZ)));
    if (inside) return 1;
    let lamp = 0;
    if (!this.roof) {
      const drop = STREET_Y - this.street;
      for (const l of this.night.lamps) lamp = Math.max(lamp, 1 - Math.hypot(l.x - p.x, (l.ground ? l.y - drop : l.y) - p.y, l.z - p.z) / l.reach);
    }
    return Math.min(1, Math.max(this.level, lamp * this.lampsOn));
  }

  /** The time of day in the sky (see skyTime), or the previewed hour today. */
  private now(): number {
    const h = this.preview.hour;
    if (h === undefined) return skyTime(this.clock(), this.state.utcOffset);
    const off = this.state.utcOffset * 60_000;
    const midnight = Math.floor((this.clock() + off) / 86_400_000) * 86_400_000;
    return midnight - off + h * 3_600_000;
  }

  update(dt: number, t: number, camera: THREE.Camera) {
    if (this.night.street !== this.street) this.placeLamps();
    const s = this.state;
    let weather = this.preview.weather ?? s.weather;
    let k = this.preview.intensity ?? (this.preview.weather ? 0.8 : s.intensity);
    // It snows all through Christmas, whatever the forecast says.
    if (this.theme === 'christmas' && !this.preview.weather) {
      k = weather === 'snow' ? Math.max(k, 0.5) : 0.6;
      weather = 'snow';
    }
    const snap = this.snap;
    this.snap = false;
    // Just after the theme changed, the weather turns in seconds rather than minutes.
    const quick = this.rush > 0 ? 0.2 : 1;
    this.rush = Math.max(0, this.rush - dt);
    const step = (x: number, to: number, secs: number) => (snap ? to : ease(x, to, dt, secs * quick));
    this.spooky = step(this.spooky, this.theme === 'halloween' ? 1 : 0, 12);
    this.festive = step(this.festive, this.theme === 'christmas' ? 1 : 0, 12);
    const sp = this.spooky;

    // The weather, easing from one spell to the next.
    const want = {
      cover: { clear: 0, cloudy: k, rain: 0.8 + 0.2 * k, storm: 1, snow: 0.85, fog: 0.5 }[weather],
      rain: weather === 'rain' ? k : weather === 'storm' ? Math.max(0.8, k) : 0,
      snow: weather === 'snow' ? k : 0,
      fog: weather === 'fog' ? k : weather === 'rain' ? 0.12 * k : weather === 'snow' ? 0.3 * k : 0,
      storm: weather === 'storm' ? 1 : 0,
    };
    // A thin, creepy mist hangs about all Halloween.
    if (this.theme === 'halloween') want.fog = Math.max(want.fog, 0.3);
    this.cover = step(this.cover, want.cover, 20);
    this.rain = step(this.rain, want.rain, 12);
    this.snow = step(this.snow, want.snow, 12);
    this.fog = step(this.fog, want.fog, 20);
    this.storm = step(this.storm, want.storm, 10);
    // Wet ground dries off slowly; snow piles up over a few minutes and takes a while to melt.
    this.wet = snap ? (this.rain > 0.05 ? 1 : 0) : ease(this.wet, this.rain > 0.05 ? 1 : 0, dt, this.rain > 0.05 ? 30 : 400);
    this.lying = snap ? (this.snow > 0.05 ? 1 : 0) : ease(this.lying, this.snow > 0.05 ? 1 : 0, dt, (this.snow > 0.05 ? 120 : 900) * (this.rush > 0 ? 0.04 : 1));
    uniforms.skyWet.value = this.indoors ? 0 : this.wet * (1 - this.lying);
    uniforms.skySnow.value = this.indoors ? 0 : this.lying * 0.9;

    // The sun, and how much light it and the sky give.
    const { el, az } = sunPosition(this.now(), s.lat, s.lon);
    const elD = el / DEG;
    // Halloween's days are a long, gloomy dusk.
    const day = smooth(-8, 4, elD) * (1 - 0.6 * sp);
    const dusk = Math.max(0, 1 - Math.abs(elD + 1) / 9) * (1 - this.cover);
    this.daylight = day;
    if (sp > 0.5 && this.storm < 0.5 && t >= this.nextSpook) {
      if (this.nextSpook > 0) {
        this.flashes.push(t, t + rand(0.12, 0.3));
        this.onThunder?.(rand(1.5, 4), rand(0.25, 0.45));
      }
      this.nextSpook = t + rand(25, 70);
    }
    this.lightning(t, dt);
    const flash = this.flash;
    const sunI = 2.2 * smooth(-3, 10, elD) * (1 - 0.8 * this.cover) * (1 - 0.6 * this.fog) * (1 - 0.65 * sp);
    const moonI = 0.4 * smooth(-4, -12, elD) * (1 - 0.75 * this.cover);
    const hemiI = lerp(0.38, 1.5 * (1 - 0.25 * this.cover) * (1 - 0.35 * this.storm), day);
    const ambI = lerp(0.12, 0.5, day);
    const { sun, hemi, ambient } = this.lights;
    hemi.intensity = hemiI + flash * 3;
    hemi.color.copy(C.hemiSkyNight).lerp(C.hemiSky, day).lerp(SPOOKY.hemiSky, sp * 0.5);
    hemi.groundColor.copy(C.hemiGroundNight).lerp(C.hemiGround, day).lerp(SPOOKY.hemiGround, sp * 0.5);
    ambient.intensity = ambI + flash;
    ambient.color.copy(C.ambientNight).lerp(C.white, day);
    // A cartoon sun: never so low its shadows fill the room. At night the moon lights things, from across the sky.
    const moonlit = elD < -4;
    const lightEl = (moonlit ? 50 : 25 + Math.max(0, elD) * 0.6) * DEG;
    const lightAz = moonlit ? az + Math.PI : az;
    this.dir.set(Math.cos(lightEl) * Math.sin(lightAz), Math.sin(lightEl), -Math.cos(lightEl) * Math.cos(lightAz));
    sun.position.copy(sun.target.position).addScaledVector(this.dir, 45);
    sun.intensity = moonlit ? moonI : sunI;
    if (moonlit) sun.color.copy(C.moon).lerp(SPOOKY.moonLight, sp);
    else sun.color.copy(C.sunLow).lerp(C.sunHigh, smooth(0, 25, elD)).lerp(SPOOKY.sun, sp);
    this.level = clamp01((hemiI + ambI + 0.6 * (sunI + moonI)) / FULL_DAY);

    // Lamps come on as it gets dark: the office's and the garage's, and the ones outside.
    const need = 1 - this.level;
    this.lampsOn = smooth(0.45, 0.62, need);
    uniforms.skyOffice.value.copy(C.office).lerp(C.officeNight, 1 - day).multiplyScalar(need * 3.2);
    uniforms.skyGarage.value.copy(C.garage).multiplyScalar(need * 2);
    const lamps = Math.min(this.night.lamps.length, MAX_LAMPS);
    uniforms.skyLampCount.value = this.lampsOn > 0.005 && !this.roof && !this.indoors ? lamps : 0;
    for (let i = 0; i < lamps; i++) {
      const l = this.night.lamps[i];
      uniforms.skyLampColors.value[i].set(l.color).multiplyScalar(l.power * this.lampsOn);
    }
    for (const b of this.night.bulbs) b.mat.emissiveIntensity = lerp(b.day, 1, this.lampsOn);
    for (const m of this.night.windows) m.emissiveIntensity = this.lampsOn * 1.1;
    for (const h of this.halos) {
      h.material.opacity = this.lampsOn * 0.85;
      h.visible = this.lampsOn > 0.01 && !this.roof && !this.indoors;
    }
    for (const g of this.night.glows) {
      g.mat.opacity = g.max * this.lampsOn;
      g.mat.visible = this.lampsOn > 0.01 && !this.roof && !this.indoors;
    }

    // The sky's color, and the fog, which fades far things into it. Halloween's is its own.
    const pal = (key: 'day' | 'dusk' | 'night' | 'greyDay' | 'greyNight' | 'fogDay' | 'fogNight', out: THREE.Color) => out.copy(C[key]).lerp(SPOOKY[key], sp);
    const a = this.tmp;
    const b = this.tmp2;
    const sky = (this.scene.background as THREE.Color).copy(pal('night', a)).lerp(pal('day', b), day);
    // Halloween's gloomy days glow at the horizon all day; its nights keep only a rim of it (the dome's).
    sky.lerp(pal('dusk', a), Math.max(dusk, sp * THREE.MathUtils.lerp(0.08, 0.35, Math.min(1, day / 0.4))) * 0.55);
    sky.lerp(pal('greyNight', a).lerp(pal('greyDay', b), day), this.cover * 0.85);
    sky.lerp(pal('fogNight', a).lerp(pal('fogDay', b), day), this.fog);
    sky.lerp(C.flash, flash * 0.5);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    const precip = Math.max(this.rain, this.snow);
    // How far off the haze is down on the street; the higher up, the thinner it is (see HAZE), so
    // the street never goes into it from the top floors, and from the roof you see across the city.
    // Out in the country (see open) it's further off again.
    const open = 1 + 1.4 * this.open;
    fog.near = lerp(40, 3, this.fog) * (1 - 0.4 * precip) * open;
    fog.far = lerp(90, 28, this.fog) * (1 - 0.3 * precip) * open;
    uniforms.skyStreet.value = this.roof ? this.roofStreet : this.indoors ? 0 : this.night.street;
    this.night.clouds.color.copy(C.white).lerp(C.cloudGrey, this.cover).lerp(SPOOKY.cloud, sp);
    this.night.clouds.visible = this.fog < 0.6;
    // Halloween's gradient, over the flat sky: dark overhead, the sky's color at the horizon, which the fog fades into.
    const u = this.spookyDome.material.uniforms;
    this.spookyDome.visible = sp > 0.005;
    if (this.spookyDome.visible) {
      u.opacity.value = sp;
      u.horizon.value.copy(sky);
      u.top.value.copy(SPOOKY.zenithNight).lerp(SPOOKY.zenithDay, Math.min(1, day / 0.4)).lerp(sky, this.fog * 0.6 + flash * 0.5);
      u.glow.value.copy(SPOOKY.glow);
      u.glowK.value = 0.55 * (1 - this.fog * 0.6) * (1 - this.cover * 0.5);
      u.moonGlow.value.copy(SPOOKY.moon).multiplyScalar(0.55 * (1 - this.cover * 0.6));
    }

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
    // At Halloween the sun hides, and a big orange harvest moon hangs low over the street all day.
    this.sunDisc.material.opacity *= 1 - sp;
    this.sunDisc.visible = this.sunDisc.material.opacity > 0.01;
    skyward(-el, az + Math.PI, this.moonAt);
    skyward(SPOOKY_MOON.el, SPOOKY_MOON.az, this.moonTo);
    u.moonDir.value.copy(this.moonTo);
    this.moonAt.lerp(this.moonTo, sp);
    this.moonDisc.position.copy(this.moonAt.lengthSq() > 1e-6 ? this.moonAt : this.moonTo).normalize().multiplyScalar(160);
    this.moonDisc.scale.setScalar(1 + 2.2 * sp);
    this.moonDisc.material.color.copy(C.white).lerp(SPOOKY.moon, sp);
    this.moonDisc.material.opacity = Math.max(smooth(2, -2, elD) * clear, sp * (1 - 0.5 * this.cover));
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
    // Down to the street, or to a little below you when that's a long way down.
    const floor = Math.max(this.street, this.camPos.y - 12);
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
        if (y < floor || y > floor + 26) {
          y = y < floor && y > floor - 1 ? y + 26 : floor + rand(0, 26);
          x = cx + rand(-24, 24);
          z = cz + rand(-24, 24);
        }
        this.drops[d] = x;
        this.drops[d + 1] = y;
        this.drops[d + 2] = z;
        const len = this.sheltered(x, z) ? 0 : 0.5;
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
        if (y < floor || y > floor + 22) {
          y = y < floor && y > floor - 1 ? y + 22 : floor + rand(0, 22);
          x = cx + rand(-20, 20);
          z = cz + rand(-20, 20);
        }
        this.flakeState[f] = x;
        this.flakeState[f + 1] = y;
        this.flakeState[f + 2] = z;
        a.set([x, this.sheltered(x, z) ? -1000 : y, z], i * 3);
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
