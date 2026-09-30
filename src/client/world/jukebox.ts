import * as THREE from 'three';
import { JUKEBOX } from '../../shared/layout';
import { JUKEBOX_HOME, jukeboxBox, jukeboxSpot, sameSpot, type JukeboxSpot } from '../../shared/jukebox';
import { WALLS, wallFacing, type WallId, type WallRect } from '../../shared/decor';
import { mesh, roundedBox, textSprite, toon, toonUnique } from './toon';
import type { Collider, Interactable } from './office';

// The lounge jukebox: a cherry-red cabinet with a rounded top, a neon tube round its face that
// glows to the beat while it plays, a little display saying what's on, and notes floating up.
// People can move it to another wall (see moving.ts), so it takes its spot rather than a fixed one.

export interface JukeboxView {
  group: THREE.Group;
  collider: Collider;
  interactable: Interactable;
  /** The bit of wall it stands against, so a picture won't be hung over it (see Office.fixtures). */
  fixture: WallRect;
  /** Stands it somewhere: the corner of the lounge until somebody moves it. */
  at(spot: JukeboxSpot): void;
  /** What the display says, and whether the lights are on. */
  show(on: boolean, title: string): void;
  /** `beat` runs 1 → 0 after each beat while music plays (see OfficeSound.beat). */
  update(t: number, dt: number, beat: number): void;
}

const NOTES = ['♪', '♫', '♪', '♬', '♫'];

export function buildJukebox(spot: JukeboxSpot = JUKEBOX_HOME): JukeboxView {
  const { width: W, depth: D, height: H } = JUKEBOX;
  const r = W / 2;
  const group = new THREE.Group();

  // The cabinet: a tombstone shape, straight sides under a half-round top.
  const shape = new THREE.Shape();
  shape.moveTo(-r, 0);
  shape.lineTo(r, 0);
  shape.lineTo(r, H - r);
  shape.absarc(0, H - r, r, 0, Math.PI, false);
  shape.lineTo(-r, 0);
  const body = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 24 });
  body.translate(0, 0, -D / 2);
  group.add(mesh(body, toon('#d64545')));
  group.add(mesh(new THREE.BoxGeometry(W + 0.12, 0.1, D + 0.12), toon('#2b2d42'), 0, 0.05, 0));

  const front = D / 2 + 0.035;
  // The neon tube: up one side, over the arch and down the other.
  const neon = toonUnique('#ffd166');
  neon.emissive = new THREE.Color('#ffd166');
  const tubeR = r - 0.1;
  const legLen = H - r - 0.3;
  group.add(mesh(new THREE.TorusGeometry(tubeR, 0.045, 8, 36, Math.PI), neon, 0, H - r, front, false));
  for (const sx of [-1, 1]) group.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, legLen, 8), neon, sx * tubeR, 0.3 + legLen / 2, front, false));

  // The display in the arch: what's playing.
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.41), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.set(0, H - r + 0.02, front + 0.005);
  group.add(screen);

  // Selector buttons, and the speaker grille below them.
  ['#ef476f', '#ffd166', '#06d6a0', '#4cc9f0', '#9d4edd'].forEach((c, i) => group.add(mesh(roundedBox(0.1, 0.05, 0.05, 0.02), toon(c), (i - 2) * 0.14, 0.98, front, false)));
  group.add(mesh(new THREE.BoxGeometry(0.82, 0.52, 0.03), toon('#2b2d42'), 0, 0.58, front - 0.01, false));
  for (let i = 0; i < 5; i++) group.add(mesh(new THREE.BoxGeometry(0.78, 0.035, 0.03), toon('#dfe6ee'), 0, 0.38 + i * 0.1, front + 0.01, false));

  // Notes drift up out of the top while it plays.
  const notes = NOTES.map((n, i) => {
    const s = textSprite(n, { color: ['#ef476f', '#4f86f7', '#06d6a0', '#9d4edd', '#ff8a5b'][i], size: 96 });
    s.scale.multiplyScalar(0.55);
    s.visible = false;
    group.add(s);
    return s;
  });

  let on = false;
  let shown = '';
  const paint = (title: string) => {
    const g = canvas.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, on ? '#3a0ca3' : '#2b2d42');
    grad.addColorStop(1, on ? '#1b1d2e' : '#1b1d2e');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = on ? '#ffd166' : '#8d99ae';
    g.font = '900 44px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(on ? '♪ NOW PLAYING ♪' : 'JUKEBOX', 256, 70);
    g.fillStyle = on ? '#ffffff' : '#8d99ae';
    let size = 58;
    const text = on ? title : 'press E to play';
    do g.font = `800 ${size--}px Nunito, ui-rounded, system-ui, sans-serif`;
    while (g.measureText(text).width > 470 && size > 26);
    g.fillText(text, 256, 160);
    tex.needsUpdate = true;
  };

  const show = (playing: boolean, title: string) => {
    const k = `${playing}|${title}`;
    if (k === shown) return;
    shown = k;
    on = playing;
    paint(title);
    // Lit, the glow is the color; dark, it's dull glass.
    neon.color.set(on ? '#1b1d2e' : '#b8b2a7');
    if (!on) {
      neon.emissive.set('#000000');
      for (const n of notes) n.visible = false;
    }
  };
  show(false, '');

  const update = (t: number, _dt: number, beat: number) => {
    if (!on) return;
    // The tube slowly runs through the colors and flares on every beat.
    neon.emissive.setHSL((t * 0.05) % 1, 0.85, 0.55);
    neon.emissiveIntensity = 0.55 + 0.9 * beat;
    notes.forEach((n, i) => {
      const k = (t * 0.35 + i / notes.length) % 1;
      n.visible = true;
      n.position.set(Math.sin(t * 1.3 + i * 2.1) * 0.35, H + 0.1 + k * 1.3, 0.1);
      n.material.opacity = Math.min(1, k * 5) * (1 - k);
    });
  };

  // Built facing +z; its spot turns that to face whichever wall its back is against.
  const collider: Collider = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, top: H };
  const interactable: Interactable = { kind: 'jukebox', x: 0, z: 0, radius: 1.6 };
  group.userData.interact = interactable;
  let stood: JukeboxSpot | null = null;
  const view: JukeboxView = {
    group,
    collider,
    interactable,
    // Its stretch of wall, moved with it: nothing else on that wall may be where it stands.
    fixture: { wall: 'east', u0: JUKEBOX.z - JUKEBOX.width / 2 - 0.05, u1: JUKEBOX.z + JUKEBOX.width / 2 + 0.05, y0: 0, y1: JUKEBOX.height },
    /** Stands it at a spot, moving the cabinet, its collider and where you use it from with it. */
    at(here: JukeboxSpot) {
      if (stood && sameSpot(stood, here)) return;
      stood = here;
      group.position.set(here.x, 0, here.z);
      group.rotation.y = here.rotY;
      // Its cabinet is JUKEBOX.width along the wall behind it and JUKEBOX.depth out into the room.
      const b = jukeboxBox(here, 0.05);
      collider.minX = b.minX;
      collider.maxX = b.maxX;
      collider.minZ = b.minZ;
      collider.maxZ = b.maxZ;
      // You use it standing in front of it, out the side its face turns to.
      interactable.x = here.x + Math.sin(here.rotY) * 1.3;
      interactable.z = here.z + Math.cos(here.rotY) * 1.3;
      const wall = wallFacing(here.rotY);
      const u = (wall === 'north' || wall === 'south' ? here.x : here.z) - JUKEBOX.width / 2 - 0.05;
      Object.assign(view.fixture, { wall, u0: u, u1: u + JUKEBOX.width + 0.1 });
    },
    show,
    update,
  };
  view.at(spot);
  return view;
}

// ---- Moving one ------------------------------------------------------------------------------------

/** How far along a wall from its ends the cabinet's back has to stay. */
const END_GAP = 0.2;

/** A flat material the cartoon outline pass leaves alone. */
function flat(color: THREE.ColorRepresentation, opacity: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  m.userData.outlineParameters = { visible: false };
  return m;
}

/**
 * The jukebox you're about to move, following your aim: a see-through cabinet with a green glow
 * where it fits against the wall and a red one where something is in the way.
 */
export class JukeboxGhost {
  readonly group = new THREE.Group();
  private body: THREE.Group;
  private glow: THREE.MeshBasicMaterial;
  private spot: JukeboxSpot | null = null;

  constructor() {
    const { width: W, depth: D, height: H } = JUKEBOX;
    const r = W / 2;
    // The same tombstone shape as the cabinet, in one translucent color it shares.
    const shape = new THREE.Shape();
    shape.moveTo(-r, 0);
    shape.lineTo(r, 0);
    shape.lineTo(r, H - r);
    shape.absarc(0, H - r, r, 0, Math.PI, false);
    shape.lineTo(-r, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 24 });
    geo.translate(0, 0, -D / 2);
    this.glow = flat('#06d6a0', 0.45);
    this.body = new THREE.Group();
    const cabinet = new THREE.Mesh(geo, this.glow);
    cabinet.renderOrder = 2;
    this.body.add(cabinet);
    // A brighter patch of floor under it, so where its feet land is plain to see.
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.3, D + 0.3), flat('#06d6a0', 0.25));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.01;
    pad.renderOrder = 1;
    this.body.add(pad);
    this.group.add(this.body);
    this.group.visible = false;
  }

  /** Stands it against (wall, u), glowing green where it fits and red where it doesn't. */
  show(at: { wall: WallId; u: number }, ok: boolean) {
    const spot = jukeboxSpot(at.wall, at.u);
    if (!this.spot || !sameSpot(spot, this.spot)) {
      this.spot = spot;
      this.group.position.set(spot.x, 0, spot.z);
      this.group.rotation.y = spot.rotY;
    }
    this.glow.color.set(ok ? '#06d6a0' : '#ef476f');
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  /** Lets go of the jukebox it was showing. */
  clear() {
    this.hide();
    this.spot = null;
  }
}

/** The stretch of wall the jukebox's back can go against, [u0, u1] along it. */
export function jukeboxRun(wall: WallId): [number, number] {
  const { min, max } = WALLS[wall];
  const half = JUKEBOX.width / 2 + END_GAP;
  return [min + half, max - half];
}
