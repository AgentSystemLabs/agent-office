import * as THREE from 'three';
import { FRAMES, FRAME_BORDER, WALLS, frameRect, wallPose, wallTop, type Decoration, type WallId, type WallRect } from '../../../shared/decor';
import { FLOOR, LOFT } from '../../../shared/layout';
import type { Interactable } from '../../world/types';
import { toon } from '../../world/toon';

// ---- Pictures -------------------------------------------------------------------------------------

export interface Picture {
  url: string;
  texture: THREE.CanvasTexture;
  /** The image's width / height. */
  aspect: number;
  /** An object URL of the full-size image, for showing it in the page. */
  src: string;
}

/** A wall picture never needs more pixels than this, and big photos would eat GPU memory. */
const MAX_TEXTURE = 1024;
const pictures = new Map<string, Promise<Picture>>();
const holds = new Map<string, number>();

/** The office fetches images for us, so a picture shows up whatever its host allows. */
export function imageUrl(url: string): string {
  return `/api/image?url=${encodeURIComponent(url)}`;
}

async function fetchPicture(url: string): Promise<Picture> {
  let res: Response;
  try {
    res = await fetch(imageUrl(url));
  } catch {
    throw new Error("Couldn't reach the office to load that image");
  }
  if (!res.ok) {
    let error = `The office couldn't load that image (${res.status})`;
    try {
      error = (await res.json()).error ?? error;
    } catch {
      // not JSON
    }
    throw new Error(error);
  }
  const src = URL.createObjectURL(await res.blob());
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    // An SVG without a size reports 0×0.
    const iw = img.naturalWidth || MAX_TEXTURE;
    const ih = img.naturalHeight || MAX_TEXTURE;
    const k = Math.min(1, MAX_TEXTURE / Math.max(iw, ih));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(iw * k));
    canvas.height = Math.max(1, Math.round(ih * k));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return { url, texture, aspect: iw / ih, src };
  } catch {
    URL.revokeObjectURL(src);
    throw new Error("Your browser can't show that image");
  }
}

/** Loads an image once for everything that shows it. Failures aren't kept, so asking again retries. */
export function loadPicture(url: string): Promise<Picture> {
  let p = pictures.get(url);
  if (!p) {
    const fresh = fetchPicture(url);
    fresh.catch(() => {
      if (pictures.get(url) === fresh) pictures.delete(url);
    });
    pictures.set(url, fresh);
    p = fresh;
  }
  return p;
}

/** Keeps a picture loaded while something besides the walls shows it. Call the result to let go. */
export function holdPicture(url: string): () => void {
  holds.set(url, (holds.get(url) ?? 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const n = (holds.get(url) ?? 1) - 1;
    if (n > 0) holds.set(url, n);
    else holds.delete(url);
  };
}

/** Frees the pictures nothing shows anymore. */
function prunePictures(onWalls: Set<string>) {
  for (const [url, p] of pictures) {
    if (onWalls.has(url) || holds.has(url)) continue;
    pictures.delete(url);
    p.then(
      (pic) => {
        pic.texture.dispose();
        URL.revokeObjectURL(pic.src);
      },
      () => {},
    );
  }
}

function notice(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 384;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 44px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let loadingTex: THREE.CanvasTexture | null = null;
let brokenTex: THREE.CanvasTexture | null = null;
const loadingTexture = () => (loadingTex ??= notice('🖼️ Loading…', '#e9ecef', '#7a6f65'));
export const brokenTexture = () => (brokenTex ??= notice('⚠️ Image unavailable', '#ffd6e0', '#2b2d42'));

// ---- Frames ---------------------------------------------------------------------------------------

/** How far the frame stands off the wall; the picture sits recessed inside it. */
const FRAME_DEPTH = 0.06;

type PictureMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

/** A flat material the cartoon outline pass leaves alone. */
function flat(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial(params);
  m.userData.outlineParameters = { visible: false };
  return m;
}

function frameGeometry(w: number, h: number): THREE.ExtrudeGeometry {
  const ow = w / 2 + FRAME_BORDER;
  const oh = h / 2 + FRAME_BORDER;
  const shape = new THREE.Shape().moveTo(-ow, -oh).lineTo(ow, -oh).lineTo(ow, oh).lineTo(-ow, oh).lineTo(-ow, -oh);
  const iw = w / 2;
  const ih = h / 2;
  shape.holes.push(new THREE.Path().moveTo(-iw, -ih).lineTo(-iw, ih).lineTo(iw, ih).lineTo(iw, -ih).lineTo(-iw, -ih));
  return new THREE.ExtrudeGeometry(shape, { depth: FRAME_DEPTH, bevelEnabled: false });
}

/** A framed w×h picture facing +z, its back against z = 0. It shows "Loading…" until given a texture. */
function buildFrame(w: number, h: number, frame: number): { group: THREE.Group; picture: PictureMesh } {
  const group = new THREE.Group();
  const border = new THREE.Mesh(frameGeometry(w, h), toon((FRAMES[frame] ?? FRAMES[0]).color));
  border.receiveShadow = true;
  group.add(border);
  const picture: PictureMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat({ map: loadingTexture() }));
  picture.position.z = FRAME_DEPTH * 0.35;
  group.add(picture);
  return { group, picture };
}

/** Shows an image of `aspect` on a picture, cropped to fill it (like CSS object-fit: cover). */
function showTexture(picture: PictureMesh, texture: THREE.Texture, aspect: number) {
  const { width, height } = picture.geometry.parameters;
  const shape = width / height;
  const fx = aspect > shape ? shape / aspect : 1;
  const fy = aspect > shape ? 1 : aspect / shape;
  const uv = picture.geometry.attributes.uv;
  // A one-segment plane's corners, in order: top left, top right, bottom left, bottom right.
  [
    [0, 1],
    [1, 1],
    [0, 0],
    [1, 0],
  ].forEach(([u, v], i) => uv.setXY(i, 0.5 + (u - 0.5) * fx, 0.5 + (v - 0.5) * fy));
  uv.needsUpdate = true;
  picture.material.map = texture;
  picture.material.needsUpdate = true;
}

function disposeFrame(group: THREE.Group) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    // Frame borders use shared toon materials; only the picture's material is its own.
    if (m.material instanceof THREE.MeshBasicMaterial) m.material.dispose();
  });
}

function placeOnWall(group: THREE.Object3D, wall: WallId, u: number, y: number, out = 0.005) {
  const p = wallPose(wall, u, y, out);
  group.position.set(p.x, p.y, p.z);
  group.rotation.y = p.rotY;
}

interface FrameView {
  d: Decoration;
  /** What the frame was built for; a change means building it again. */
  key: string;
  group: THREE.Group;
  picture: PictureMesh;
  it: Interactable;
}

/** The pictures on the walls. Put `group` in the office so looking at a picture targets it. */
export class Gallery {
  readonly group = new THREE.Group();
  /** For walking up to a picture in third person. */
  readonly interactables: Interactable[] = [];
  private frames = new Map<string, FrameView>();
  private hidden: string | null = null;

  sync(items: Decoration[]) {
    const seen = new Set<string>();
    for (const d of items) {
      seen.add(d.id);
      const key = `${d.url}|${d.w}|${d.h}|${d.frame}`;
      let v = this.frames.get(d.id);
      if (v && v.key !== key) {
        this.drop(v);
        v = undefined;
      }
      if (!v) {
        v = this.build(d, key);
        this.frames.set(d.id, v);
      }
      v.d = d;
      placeOnWall(v.group, d.wall, d.u, d.y);
      const front = wallPose(d.wall, d.u, 0, 1.4);
      v.it.x = front.x;
      v.it.z = front.z;
    }
    for (const [id, v] of this.frames) {
      if (seen.has(id)) continue;
      this.drop(v);
      this.frames.delete(id);
    }
    this.refresh();
    prunePictures(new Set(items.map((d) => d.url)));
  }

  /** Hides a picture while it's being moved; null puts it back. */
  hide(id: string | null) {
    this.hidden = id;
    this.refresh();
  }

  /** The frames' outlines, except the one with id `except`. */
  rects(except?: string): WallRect[] {
    const out: WallRect[] = [];
    for (const v of this.frames.values()) if (v.d.id !== except) out.push(frameRect(v.d));
    return out;
  }

  private refresh() {
    this.interactables.length = 0;
    for (const v of this.frames.values()) {
      v.group.visible = v.d.id !== this.hidden;
      if (v.group.visible) this.interactables.push(v.it);
    }
  }

  private build(d: Decoration, key: string): FrameView {
    const { group, picture } = buildFrame(d.w, d.h, d.frame);
    const it: Interactable = { kind: 'decor', decorId: d.id, x: 0, z: 0, radius: Math.max(1.6, d.w / 2 + 0.8) };
    group.userData.interact = it;
    this.group.add(group);
    const current = () => this.frames.get(d.id)?.picture === picture;
    loadPicture(d.url).then(
      (pic) => current() && showTexture(picture, pic.texture, pic.aspect),
      () => current() && showTexture(picture, brokenTexture(), 4 / 3),
    );
    return { d, key, group, picture, it };
  }

  private drop(v: FrameView) {
    this.group.remove(v.group);
    disposeFrame(v.group);
  }
}

// ---- Hanging one ------------------------------------------------------------------------------------

/** The picture you're about to hang, following your aim, with a green (fits) or red (blocked) glow. */
export class Ghost {
  readonly group = new THREE.Group();
  private halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private body: THREE.Group | null = null;
  private key = '';

  constructor() {
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flat({ color: '#06d6a0', transparent: true, opacity: 0.5, depthWrite: false }));
    this.halo.position.z = -0.002;
    this.group.add(this.halo);
    this.group.visible = false;
  }

  show(at: { wall: WallId; u: number; y: number; w: number; h: number; ok: boolean }, frame: number, texture: THREE.Texture, aspect: number) {
    const key = `${at.w}|${at.h}|${frame}|${texture.uuid}|${aspect}`;
    if (key !== this.key) {
      this.clearBody();
      const { group, picture } = buildFrame(at.w, at.h, frame);
      showTexture(picture, texture, aspect);
      this.body = group;
      this.group.add(group);
      this.key = key;
    }
    this.halo.scale.set(at.w + 2 * FRAME_BORDER + 0.16, at.h + 2 * FRAME_BORDER + 0.16, 1);
    this.halo.material.color.set(at.ok ? '#06d6a0' : '#ef476f');
    // Where it can't hang it floats out in front, so a board or the TV doesn't hide it.
    placeOnWall(this.group, at.wall, at.u, at.y, at.ok ? 0.005 : 0.32);
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  /** Lets go of the picture it showed. */
  clear() {
    this.hide();
    this.clearBody();
  }

  private clearBody() {
    if (!this.body) return;
    this.group.remove(this.body);
    disposeFrame(this.body);
    this.body = null;
    this.key = '';
  }
}

/** Where a ray from inside the room first meets a wall, within `maxDist` meters (the whole room by default). */
export function aimAtWall(ray: THREE.Ray, maxDist = 60): { wall: WallId; u: number; y: number } | null {
  const o = ray.origin;
  const d = ray.direction;
  // Only from inside: out on the balcony or down on the street, the walls face the other way.
  if (o.x < FLOOR.minX || o.x > FLOOR.maxX || o.z < FLOOR.minZ || o.z > FLOOR.maxZ || o.y < 0) return null;
  // The loft's floor hides whatever is past it, from above or below.
  if (d.y !== 0) {
    const t = (LOFT.y - 0.12 - o.y) / d.y;
    const x = o.x + d.x * t;
    const z = o.z + d.z * t;
    if (t > 0 && x > LOFT.minX && x < LOFT.maxX && z > LOFT.minZ && z < LOFT.maxZ) maxDist = Math.min(maxDist, t);
  }
  const hits: [WallId, number][] = [];
  if (d.z < 0) hits.push(['north', (FLOOR.minZ - o.z) / d.z]);
  if (d.z > 0) hits.push(['south', (FLOOR.maxZ - o.z) / d.z]);
  if (d.x < 0) hits.push(['west', (FLOOR.minX - o.x) / d.x]);
  if (d.x > 0) hits.push(['east', (FLOOR.maxX - o.x) / d.x]);
  let best: { wall: WallId; u: number; y: number } | null = null;
  let bestT = maxDist;
  for (const [wall, t] of hits) {
    if (!(t > 0 && t < bestT)) continue;
    const y = o.y + d.y * t;
    const u = wall === 'north' || wall === 'south' ? o.x + d.x * t : o.z + d.z * t;
    if (y < 0 || u < WALLS[wall].min || u > WALLS[wall].max || y > wallTop(wall, u)) continue;
    best = { wall, u, y };
    bestT = t;
  }
  return best;
}
