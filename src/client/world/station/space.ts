import * as THREE from 'three';
import { canvasTexture } from '../texture';
import { bands, earthClouds, earthDay, earthNight, moonFace, redPlanet, rings, starfield, sunGlare } from './planets';
import { seeded } from './textures';

/*
 * What's outside the station's windows: the stars and the Milky Way, the Sun, the Earth turning
 * below, the Moon, a ringed giant and a red planet. It all rides along with your eye, so it looks
 * as far off as it is however you walk about, and it's drawn first, behind everything, without
 * touching the depth buffer: whatever's really out there (the hull, someone blown out of the
 * airlock) is always in front of it. A curtain round it all hides the office's own sky, its sun,
 * moon and stars, which are further off still.
 */

/** Where something is in the sky: `az` degrees round from forward (north, -z) toward starboard (east, +x), `el` degrees up. */
function skyward(az: number, el: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(az);
  const e = THREE.MathUtils.degToRad(el);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

/** The way to the Sun: high off the port bow, so the Earth off to starboard is in daylight but for its far edge. */
export const SUNWARD = skyward(-62, 36);
/** The Earth: off the starboard bow and below, filling that side of the sky. */
const EARTH = { at: skyward(56, -27), far: 160, radius: 98 };
/** How far off (in the backdrop's own space) the rest is drawn, and how far off the curtain that hides the office's sky is. */
const FAR = 120;
const CURTAIN = 145;

/** Behind everything, in this order: the sky, the stars, the Sun, the far planets, the Earth's air and the Earth, then the curtain. */
const ORDER = { sky: -1000, stars: -999, sun: -998, ringBack: -997, planet: -996, ringFront: -995, air: -994, earth: -993, curtain: -900 } as const;

/** Drawn behind everything: no depth, no fog, no outline. */
function backdrop<T extends THREE.Material & { fog: boolean }>(m: T): T {
  m.depthTest = false;
  m.depthWrite = false;
  m.fog = false;
  m.userData.outlineParameters = { visible: false };
  return m;
}

const PLANET_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4( position, 1.0 );
    vNormal = normalize( mat3( modelMatrix ) * normal );
    vView = normalize( cameraPosition - world.xyz );
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** A world lit by the Sun from one side: its day, its night lights where it's dark, its clouds drifting over, and the air glowing round its edge. */
const PLANET_FRAG = /* glsl */ `
  uniform sampler2D day;
  uniform sampler2D night;
  uniform sampler2D clouds;
  uniform vec3 sun;
  uniform vec3 air;
  uniform float cloudy;
  uniform float drift;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize( vNormal );
    float light = dot( n, sun );
    float lit = smoothstep( -0.1, 0.22, light );
    // A cartoon's two tones of daylight, rather than a smooth fall-off.
    float tone = mix( 0.62, 1.0, smoothstep( 0.32, 0.4, light ) );
    vec3 ground = texture2D( day, vUv ).rgb;
    float cloud = cloudy * texture2D( clouds, vec2( vUv.x + drift, vUv.y ) ).r;
    float shadow = cloudy * texture2D( clouds, vec2( vUv.x + drift + 0.004, vUv.y + 0.003 ) ).r;
    vec3 surface = mix( ground * ( 1.0 - 0.3 * shadow ), vec3( 1.0 ), cloud * 0.92 );
    vec3 color = surface * lit * tone * 1.08;
    // The cities, where it's night and the sky's clear, and a little earthshine so the dark side isn't a hole.
    color += texture2D( night, vUv ).rgb * ( 1.0 - lit ) * ( 1.0 - cloud ) * 1.7;
    color += ground * 0.03 * ( 1.0 - lit );
    // The air, glowing toward the edge, brightest where the Sun's on it.
    float rim = pow( 1.0 - max( dot( n, normalize( vView ) ), 0.0 ), 2.6 );
    color += air * rim * ( 0.12 + 0.95 * lit );
    gl_FragColor = vec4( color, 1.0 );
    #include <colorspace_fragment>
  }
`;

/** The glow of a world's air past its edge: a shell round it, seen from inside out, bright at the planet's edge and gone by its own. */
const AIR_FRAG = /* glsl */ `
  uniform vec3 sun;
  uniform vec3 air;
  uniform float edge;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize( vNormal );
    vec3 ray = -normalize( vView );
    // 0 at the shell's own edge, 1 where the ray just grazes the planet inside it.
    float f = clamp( dot( n, ray ) / edge, 0.0, 1.0 );
    // Whether the Sun's on the air there: where the ray passes closest to the planet.
    float lit = smoothstep( -0.2, 0.3, dot( normalize( n - ray * dot( n, ray ) ), sun ) );
    gl_FragColor = vec4( air * pow( f, 2.4 ) * ( 0.1 + 0.9 * lit ), 1.0 );
    #include <colorspace_fragment>
  }
`;

/**
 * The stars: a little diamond each, facing you, all in one mesh. (Not points: the toon outline
 * draws whatever isn't a mesh a second time, and these, drawn without depth, would land on top of the room.)
 */
function stars(): THREE.BufferGeometry {
  const rand = seeded(3);
  const pos: number[] = [];
  const col: number[] = [];
  const at = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const R = FAR * 0.95;
  for (let i = 0; i < 4200; i++) {
    const y = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    at.set(Math.cos(a) * r, y, Math.sin(a) * r);
    // Across the line of sight, two ways.
    u.set(-at.z, 0, at.x).normalize();
    if (!u.lengthSq()) u.set(1, 0, 0);
    v.crossVectors(at, u);
    // Most are faint and small; one in six is bright, and bigger.
    const bright = i % 6 === 0;
    const h = (bright ? 0.1 : 0.05) * (0.7 + rand() * 0.6);
    const corners = [
      [h, 0],
      [0, h],
      [-h, 0],
      [0, -h],
    ].map(([du, dv]) => [at.x * R + u.x * du + v.x * dv, at.y * R + u.y * du + v.y * dv, at.z * R + u.z * du + v.z * dv]);
    for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...corners[k]);
    // Most are white; a few are blue, and a few amber.
    const tint = rand();
    const b = bright ? 0.75 + rand() * 0.25 : 0.25 + rand() * 0.45;
    for (let k = 0; k < 6; k++) col.push(b * (tint > 0.85 ? 0.75 : 1), b * (tint > 0.85 ? 0.85 : tint < 0.12 ? 0.85 : 1), b * (tint < 0.12 ? 0.6 : 1));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

let black: THREE.DataTexture | null = null;
/** Nothing: for a world with no clouds or no lights. */
function nothing(): THREE.DataTexture {
  if (!black) {
    black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    black.needsUpdate = true;
  }
  return black;
}

/** A world's material: its `day` map, lit from the Sun, with what `more` adds (its night side, its clouds, its air). */
function worldMaterial(day: THREE.Texture, more: { night?: THREE.Texture; clouds?: THREE.Texture; air?: string } = {}): THREE.ShaderMaterial {
  return backdrop(
    new THREE.ShaderMaterial({
      uniforms: {
        day: { value: day },
        night: { value: more.night ?? nothing() },
        clouds: { value: more.clouds ?? nothing() },
        sun: { value: SUNWARD },
        air: { value: new THREE.Color(more.air ?? '#000000') },
        cloudy: { value: more.clouds ? 1 : 0 },
        drift: { value: 0 },
      },
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
    }),
  );
}

export interface Space {
  group: THREE.Group;
  /** Rides along with `eye`, and turns the worlds. */
  update(t: number, eye: THREE.Vector3): void;
  dispose(): void;
}

export function buildSpace(): Space {
  const group = new THREE.Group();
  const textures: THREE.Texture[] = [];
  const picture = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
    const t = canvasTexture(w, h, draw);
    t.wrapS = THREE.RepeatWrapping;
    textures.push(t);
    return t;
  };
  const add = <T extends THREE.Object3D>(o: T, order: number): T => {
    o.renderOrder = order;
    o.frustumCulled = false;
    group.add(o);
    return o;
  };

  // The sky itself: the Milky Way painted on it, and the stars drawn over it one by one, so they stay sharp.
  add(new THREE.Mesh(new THREE.SphereGeometry(FAR, 48, 32), backdrop(new THREE.MeshBasicMaterial({ map: picture(2048, 1024, starfield(2048, 1024)), side: THREE.BackSide }))), ORDER.sky);
  add(new THREE.Mesh(stars(), backdrop(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))), ORDER.stars);

  /** Turned to face the middle of it all, where you are. */
  const facing = (o: THREE.Object3D) => {
    const aim = new THREE.Object3D();
    aim.position.copy(o.position);
    aim.lookAt(0, 0, 0);
    o.quaternion.copy(aim.quaternion);
  };

  // The Sun: all glare.
  const glare = backdrop(new THREE.MeshBasicMaterial({ map: picture(512, 512, sunGlare), blending: THREE.AdditiveBlending }));
  const sun = add(new THREE.Mesh(new THREE.PlaneGeometry(74, 74), glare), ORDER.sun);
  sun.position.copy(SUNWARD).multiplyScalar(FAR * 0.9);
  facing(sun);

  /** A world `radius` across (half of it), `far` off along `at`, tipped over by `tilt`. */
  const world = (at: THREE.Vector3, far: number, radius: number, mat: THREE.Material, order: number, tilt = 0) => {
    const m = add(new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 40), mat), order);
    m.position.copy(at).multiplyScalar(far);
    // Turning about its own axis, which is tipped over: the spin first, then the tilt.
    m.rotation.order = 'ZYX';
    m.rotation.z = tilt;
    return m;
  };

  // The Moon, over the bow; a red planet, small and far, off to starboard.
  const moon = world(skyward(-14, 21), FAR * 0.9, 4.2, worldMaterial(picture(512, 256, moonFace(512, 256))), ORDER.planet, 0.2);
  world(skyward(104, 24), FAR * 0.9, 1.9, worldMaterial(picture(256, 128, redPlanet(256, 128)), { air: '#ff9a7a' }), ORDER.planet, 0.4);

  // A ringed giant off to port: the far half of its rings, then the planet, then the near half over it.
  const giantAt = skyward(-104, 13);
  const giant = world(giantAt, FAR * 0.9, 7.4, worldMaterial(picture(256, 256, bands(['#e6cf9c', '#d9b77a', '#f0e2bd', '#c79a5e', '#e9d7a8', '#b98a55'], 61)), { air: '#ffe6b0' }), ORDER.planet, 0.38);
  const ringTex = picture(256, 4, rings);
  ringTex.wrapS = THREE.ClampToEdgeWrapping;
  // Blended over what's behind them, but still drawn with the rest of the backdrop (not with the see-through things in the room).
  const ringMat = backdrop(new THREE.MeshBasicMaterial({ map: ringTex, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
  const ringTilt = new THREE.Euler(Math.PI / 2 - 0.42, 0, 0.38);
  for (const half of [0, 1]) {
    const geo = new THREE.RingGeometry(9.4, 16.5, 96, 1, half * Math.PI, Math.PI);
    // Across the rings, not round them.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - 9.4) / (16.5 - 9.4), 0.5);
    const ring = new THREE.Mesh(geo, ringMat);
    ring.position.copy(giant.position);
    ring.rotation.copy(ringTilt);
    ring.updateMatrixWorld(true);
    // Whichever half is on the far side of the planet from you goes behind it.
    const mid = new THREE.Vector3(Math.cos((half + 0.5) * Math.PI) * 13, Math.sin((half + 0.5) * Math.PI) * 13, 0).applyMatrix4(ring.matrixWorld);
    add(ring, mid.length() > giant.position.length() ? ORDER.ringBack : ORDER.ringFront);
  }

  // The Earth, and the glow of its air round its edge.
  const clouds = picture(768, 384, earthClouds(768, 384));
  // How much cloud, not a color.
  clouds.colorSpace = THREE.NoColorSpace;
  const earthMat = worldMaterial(picture(2048, 1024, earthDay(2048, 1024)), { night: picture(1024, 512, earthNight(1024, 512)), clouds, air: '#4d9dff' });
  const earth = world(EARTH.at, EARTH.far, EARTH.radius, earthMat, ORDER.earth, 0.41);
  const shell = 1.045;
  const airMat = backdrop(
    new THREE.ShaderMaterial({
      uniforms: { sun: { value: SUNWARD }, air: { value: new THREE.Color('#5fb0ff') }, edge: { value: Math.sqrt(1 - 1 / (shell * shell)) } },
      vertexShader: PLANET_VERT,
      fragmentShader: AIR_FRAG,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  const air = add(new THREE.Mesh(new THREE.SphereGeometry(EARTH.radius * shell, 64, 40), airMat), ORDER.air);
  air.position.copy(earth.position);

  // The curtain: nothing to see, but it's in the way of the office's own sun, moon and stars.
  const curtain = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.BackSide, fog: false });
  curtain.userData.outlineParameters = { visible: false };
  add(new THREE.Mesh(new THREE.SphereGeometry(CURTAIN, 24, 16), curtain), ORDER.curtain);

  return {
    group,
    update(t, eye) {
      group.position.copy(eye);
      // The Earth turns under you (it's you going round it), its weather a little faster; the Moon and the giant, slowly.
      earth.rotation.y = t * 0.012;
      earthMat.uniforms.drift.value = (t * 0.0016) % 1;
      moon.rotation.y = t * 0.004;
      giant.rotation.y = t * 0.02;
    },
    dispose() {
      for (const t of textures) t.dispose();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
    },
  };
}
