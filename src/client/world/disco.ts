import * as THREE from 'three';
import { TV, WALL_HEIGHT } from '../../shared/layout';
import { mesh, toon, toonUnique } from './toon';

/**
 * The dance floor with disco lights in the lounge, on the open floor in front of the big TV.
 *
 * It's each person's own: every browser builds its own office, so whether it's out is a setting
 * kept in that browser (see the Dance floor switch in the TV window, ui/tv.ts, and under ⚙️
 * Settings). A grid of tiles lights up and cycles through colors, under a little rig of sweeping
 * beams and a mirror ball, and it comes out or goes away with `setOn`, so a floor that doesn't
 * want it never builds it into the room.
 *
 * It's placed off `TV` rather than a spot of its own, so it sits square in front of whatever the TV
 * is: between the coffee table and the wall, clear of the couch, the poufs and the floor lamp. It's
 * flush with the floor (0.04 up), so it needs no collider and you walk over it as usual.
 */
export interface DanceFloorView {
  group: THREE.Group;
  /** Whether it's out right now. */
  showing(): boolean;
  /** Bring it out, or put it away with its lights. */
  setOn(on: boolean): void;
  /** Animates the tiles, the beams and the mirror ball. Call it every frame. */
  update(t: number): void;
}

/** The floor is set back from the wall this far, and is this wide and this deep. */
const SETBACK = 0.4;
const WIDTH = 3.5;
const DEPTH = 3;
/** How many tiles across and along, at about this size. */
const TILE = 0.8;
/** The rig hangs this far under the ceiling, and its beams reach the floor. */
const RIG_Y = 4.5;
const BEAM_LEN = RIG_Y + 0.2;
/** The tiles' beat, in beats a minute: a steady four-on-the-floor. */
const BPM = 124;

/** A color round the wheel (0–1) at full saturation, as an sRGB color. */
function hue(c: THREE.Color, h: number, l = 0.55): THREE.Color {
  return c.setHSL(((h % 1) + 1) % 1, 1, l, THREE.SRGBColorSpace);
}

/** The colors the floor and its lights take turns through. */
const COLORS = ['#ff2bd6', '#39ff14', '#4cc9f0', '#ffe14d', '#ff5b3a', '#b96bff'].map((c) => new THREE.Color(c));

/**
 * A beam of light: a cone that fades along its length and toward its edges, added onto what's
 * behind. The same trick the rooftop rig's beams use (world/rooftop.ts).
 */
function beamMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0 } },
    vertexShader: `
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vAlong = uv.y;
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vN = normalize( normalMatrix * normal );
        vView = normalize( -mv.xyz );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float edge = pow( abs( dot( normalize( vN ), normalize( vView ) ) ), 1.6 );
        float a = opacity * vAlong * vAlong * edge;
        gl_FragColor = vec4( color * a, a );
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** Light leaves looking and clicking alone, so the crosshair goes through a beam. */
function unpickable<T extends THREE.Object3D>(obj: T): T {
  obj.raycast = () => {};
  return obj;
}

interface Head {
  pan: THREE.Group;
  tilt: THREE.Group;
  beam: THREE.ShaderMaterial;
  lens: THREE.MeshBasicMaterial;
  i: number;
}

export function buildDanceFloor(): DanceFloorView {
  const group = new THREE.Group();
  const maxX = TV.x - SETBACK;
  const minX = maxX - WIDTH;
  const minZ = TV.z - DEPTH;
  const maxZ = TV.z + DEPTH;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const cols = Math.max(1, Math.round((maxX - minX) / TILE));
  const rows = Math.max(1, Math.round((maxZ - minZ) / TILE));
  const tw = (maxX - minX) / cols;
  const td = (maxZ - minZ) / rows;

  // A dark base under the tiles and a bright strip round the edge, so it reads as a stage.
  group.add(mesh(new THREE.BoxGeometry(maxX - minX + 0.16, 0.04, maxZ - minZ + 0.16), toon('#14131c'), cx, 0.02, cz, false));
  const edgeMat = new THREE.MeshBasicMaterial({ color: '#4cc9f0' });
  edgeMat.toneMapped = false;
  for (const [x, z, w, d] of [
    [cx, minZ - 0.04, maxX - minX + 0.22, 0.07],
    [cx, maxZ + 0.04, maxX - minX + 0.22, 0.07],
    [minX - 0.04, cz, 0.07, maxZ - minZ + 0.22],
    [maxX + 0.04, cz, 0.07, maxZ - minZ + 0.22],
  ] as const) {
    group.add(mesh(new THREE.BoxGeometry(w, 0.03, d), edgeMat, x, 0.055, z, false));
  }

  // The tiles: one instanced quad each, colored afresh every frame.
  const tileMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  tileMat.toneMapped = false;
  const tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(tw * 0.92, td * 0.92).rotateX(-Math.PI / 2), tileMat, cols * rows);
  tiles.frustumCulled = false;
  const at = new THREE.Matrix4();
  const dark = new THREE.Color('#1b1b28');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      at.makeTranslation(minX + (c + 0.5) * tw, 0.05, minZ + (r + 0.5) * td);
      tiles.setMatrixAt(r * cols + c, at);
      tiles.setColorAt(r * cols + c, dark);
    }
  }
  group.add(tiles);

  // The rig: a bar hung from the ceiling with three little moving heads and a mirror ball.
  const truss = toon('#c9d1d9');
  const rig = new THREE.Group();
  const bar = mesh(new THREE.CylinderGeometry(0.04, 0.04, maxZ - minZ + 0.5, 8), truss, cx, RIG_Y, cz, false);
  bar.rotation.x = Math.PI / 2;
  rig.add(bar);
  for (const z of [minZ + 0.5, cz, maxZ - 0.5]) {
    rig.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, WALL_HEIGHT - RIG_Y, 6), truss, cx, (WALL_HEIGHT + RIG_Y) / 2, z, false));
  }
  const beamGeo = new THREE.CylinderGeometry(0.08, 1.5, BEAM_LEN, 20, 1, true).translate(0, -BEAM_LEN / 2, 0);
  const heads: Head[] = [];
  for (let i = 0; i < 3; i++) {
    const pan = new THREE.Group();
    pan.position.set(cx, RIG_Y - 0.12, minZ + 0.5 + i * ((maxZ - minZ - 1) / 2));
    pan.add(mesh(new THREE.BoxGeometry(0.3, 0.06, 0.12), toon('#1d1d1d'), 0, 0.16, 0, false));
    const tilt = new THREE.Group();
    tilt.add(mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.34, 12), toon('#1d1d1d'), 0, 0, 0, false));
    const lens = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    lens.toneMapped = false;
    tilt.add(mesh(new THREE.CircleGeometry(0.1, 16).rotateX(Math.PI / 2), lens, 0, -0.22, 0, false));
    const beam = beamMaterial();
    const cone = unpickable(new THREE.Mesh(beamGeo, beam));
    cone.position.y = -0.22;
    cone.frustumCulled = false;
    tilt.add(cone);
    pan.add(tilt);
    rig.add(pan);
    heads.push({ pan, tilt, beam, lens, i });
  }
  // The mirror ball, on its own little motor with a rod up to the ceiling.
  const ball = new THREE.Group();
  ball.position.set(cx, RIG_Y - 0.62, cz);
  const ballMat = toonUnique('#eef2fb');
  ballMat.emissive = new THREE.Color('#68789c');
  const sphere = mesh(new THREE.IcosahedronGeometry(0.32, 1), ballMat, 0, 0, 0, false);
  sphere.userData.outlineParameters = { visible: false };
  ball.add(sphere);
  ball.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), truss, 0, 0.55, 0, false));
  ball.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), toon('#1d1d1d'), 0, 0.3, 0, false));
  rig.add(ball);
  group.add(rig);

  // Two colored washes over the floor, so it throws some light on the lounge around it.
  const washes = [-1, 1].map((s) => {
    const l = new THREE.PointLight('#ff4fd8', 0, 12, 1.4);
    l.position.set(cx, 3.1, cz + s * 1.7);
    group.add(l);
    return l;
  });

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const tmp = new THREE.Color();
  const paint = (t: number) => {
    const motion = !reduced.matches;
    const beat = t * (BPM / 60);
    const step = Math.floor(beat);
    const flash = motion ? 0.4 + 0.6 * Math.max(0, 1 - (beat - step) * 2.2) : 0.55;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // A checkerboard that flips on each beat, a slow wave through it, and a color that walks.
        const checker = (r + c + step) % 2 === 0;
        const wave = 0.5 + 0.5 * Math.sin((r + c) * 0.85 - t * 2.1);
        const level = 0.08 + (checker ? flash : wave * 0.7) * 0.85;
        tiles.setColorAt(r * cols + c, hue(tmp, t * 0.06 + (r + c) * 0.05 + (checker ? 0 : 0.5), 0.15 + level * 0.35));
      }
    }
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;

    const color = COLORS[step % COLORS.length];
    edgeMat.color.copy(color);
    heads.forEach((h) => {
      const swing = motion ? 1 : 0.15;
      h.pan.rotation.y = Math.sin(t * 0.7 + h.i * 1.7) * 0.6 * swing;
      h.tilt.rotation.x = Math.cos(t * 0.5 + h.i * 1.1) * 0.45 * swing;
      h.tilt.rotation.z = Math.sin(t * 0.9 + h.i * 0.7) * 0.4 * swing;
      const c = COLORS[(step + h.i) % COLORS.length];
      h.beam.uniforms.color.value.copy(c);
      h.beam.uniforms.opacity.value = (motion ? 0.35 + 0.35 * flash : 0.35);
      h.lens.color.copy(c).multiplyScalar(0.7 + flash);
    });
    ball.rotation.y = t * 0.6;
    washes.forEach((w, i) => {
      w.color.copy(COLORS[(step + i * 3) % COLORS.length]);
      w.intensity = 0.5 + 1.1 * flash;
    });
  };

  const setOn = (on: boolean) => {
    group.visible = on;
    if (on) paint(performance.now() / 1000);
  };
  paint(0);

  return {
    group,
    showing: () => group.visible,
    setOn,
    update(t) {
      if (!group.visible) return;
      paint(t);
    },
  };
}
