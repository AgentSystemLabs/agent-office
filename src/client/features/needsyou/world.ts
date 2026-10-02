import * as THREE from 'three';

// The beacon over a worker that needs you: a red pin with a "!" above its card, a pillar of light
// going up from its desk, and rings spreading out over the floor around it. It's there to be seen
// from the far side of the office, so it thins out as you walk up to read what the worker's asking.

const RED = '#ef476f';
const INK = '#2b2d42';
/** The light is a stronger red than the pin: it's see-through, and the walls behind it are warm. */
const LIGHT = '#ff2d5f';
/** How high the pillar of light goes (m): past the top of any card, short of the office's ceiling. */
const BEAM_HEIGHT = 5.6;
/**
 * The pin: how wide and tall it is (m), how far over the worker's card its point floats, and how it
 * grows with distance so it's never a speck: its full size up to `full` m away, then as big as it
 * looked there, up to `most` times over.
 */
const PIN = { w: 0.5, h: 0.645, gap: 0.12, full: 6, most: 3 };
/** The rings on the floor: how many, how far each spreads (m), and how many seconds it takes. */
const RINGS = { n: 2, from: 0.6, to: 2.3, every: 2 };

let pinTexture: THREE.CanvasTexture | undefined;
let beamTexture: THREE.CanvasTexture | undefined;
let beamShape: THREE.CylinderGeometry | undefined;
let ringShape: THREE.RingGeometry | undefined;

/** The pin's picture: a red drop with its point down, inked round, and a white "!" in it. */
function pinPicture(): THREE.CanvasTexture {
  if (pinTexture) return pinTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 248;
  canvas.height = 320;
  const c = canvas.getContext('2d')!;
  const cx = 124;
  const cy = 112;
  const r = 100;
  c.beginPath();
  c.arc(cx, cy, r, Math.PI * 0.82, Math.PI * 0.18);
  c.lineTo(cx, 308);
  c.closePath();
  c.fillStyle = RED;
  c.fill();
  c.lineWidth = 14;
  c.lineJoin = 'round';
  c.strokeStyle = INK;
  c.stroke();
  c.fillStyle = '#ffffff';
  c.font = '900 150px Nunito, ui-rounded, system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('!', cx, cy + 8);
  pinTexture = new THREE.CanvasTexture(canvas);
  pinTexture.colorSpace = THREE.SRGBColorSpace;
  pinTexture.anisotropy = 4;
  return pinTexture;
}

/**
 * The pillar's light, from the floor up: thin where the worker and its laptop are, so they still show
 * through it, strongest over its head where there's only air, and gone by the top.
 */
function beamPicture(): THREE.CanvasTexture {
  if (beamTexture) return beamTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const c = canvas.getContext('2d')!;
  const fade = c.createLinearGradient(0, 128, 0, 0);
  fade.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
  fade.addColorStop(0.3, 'rgba(255, 255, 255, 0.42)');
  fade.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
  fade.addColorStop(1, 'rgba(255, 255, 255, 0)');
  c.fillStyle = fade;
  c.fillRect(0, 0, 4, 128);
  beamTexture = new THREE.CanvasTexture(canvas);
  beamTexture.colorSpace = THREE.SRGBColorSpace;
  return beamTexture;
}

/** A see-through red that's drawn over the room without hiding what's behind it, and never inked round. */
function glow(map?: THREE.Texture): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color: LIGHT, map, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  mat.userData.outlineParameters = { visible: false };
  return mat;
}

export class Beacon {
  /** Goes in the scene, not on the worker: it stays upright and the same size whatever the worker's doing. */
  readonly root = new THREE.Group();
  private readonly pin: THREE.Sprite;
  private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];

  constructor() {
    this.pin = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinPicture(), transparent: true, depthWrite: false }));
    // Its point is where it's put.
    this.pin.center.set(0.5, 0);
    // Drawn in with the cards and bubbles (see textSprite and cardSprite in world/toon.ts), so a nearer worker's card covers it.
    this.pin.renderOrder = 10;
    beamShape ??= new THREE.CylinderGeometry(0.4, 0.55, 1, 24, 1, true).translate(0, 0.5, 0);
    this.beam = new THREE.Mesh(beamShape, glow(beamPicture()));
    ringShape ??= new THREE.RingGeometry(0.88, 1, 56).rotateX(-Math.PI / 2);
    for (let i = 0; i < RINGS.n; i++) this.rings.push(new THREE.Mesh(ringShape, glow()));
    this.root.add(this.beam, ...this.rings, this.pin);
  }

  /**
   * Where the worker is this frame and how it looks from where you are. `at` is the worker (its feet,
   * more or less), `floor` the floor under it and `top` the top of its card, both as heights in the
   * world, and `away` how far the camera is (m). `near` is 0 from across the room up to 1 with you
   * right beside it, and `calm` is for someone who has asked for less motion: nothing pulses or spreads.
   */
  update(at: THREE.Vector3, floor: number, top: number, away: number, t: number, near: number, calm: boolean) {
    this.root.position.set(at.x, floor, at.z);
    const beat = calm ? 0 : Math.sin(t * 6.4);
    const size = (1 + beat * 0.09) * Math.min(PIN.most, Math.max(1, away / PIN.full));
    this.pin.scale.set(PIN.w * size, PIN.h * size, 1);
    this.pin.position.y = top - floor + PIN.gap + (calm ? 0 : Math.sin(t * 3.2) * 0.06);
    // Up close the light would only get between you and the laptop.
    const far = 1 - near;
    this.beam.scale.y = BEAM_HEIGHT;
    this.beam.material.opacity = (0.64 + beat * 0.14) * far;
    this.beam.visible = far > 0.02;
    this.rings.forEach((ring, i) => {
      const p = calm ? 0.4 : (t / RINGS.every + i / RINGS.n) % 1;
      ring.scale.setScalar(RINGS.from + (RINGS.to - RINGS.from) * p);
      ring.position.y = 0.03 + i * 0.004;
      ring.material.opacity = (calm ? 0.7 : (1 - p) ** 1.4 * 0.9) * (1 - near * 0.6);
      ring.visible = !calm || i === 0;
    });
  }

  /** Its own materials go; the shapes and pictures are every beacon's. */
  dispose() {
    this.root.removeFromParent();
    this.pin.material.dispose();
    this.beam.material.dispose();
    for (const ring of this.rings) ring.material.dispose();
  }
}
