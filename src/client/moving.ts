import * as THREE from 'three';
import { FLOOR, JUKEBOX, MEETING_ROOM } from '../shared/layout';
import { blocksOpening, jukeboxBox, jukeboxSpot } from '../shared/jukebox';
import { overlaps, type WallId, type WallRect } from '../shared/decor';
import type { Net } from './net';
import type { PlayerController } from './player';
import { toast } from './ui/dom';
import { aimAtWall } from './world/gallery';
import type { Office } from './world/office';
import { JukeboxGhost, jukeboxRun } from './world/jukebox';

// Moving the jukebox, the way you hang a picture: pick it up, aim at a wall and click to stand it
// there, with Esc to put it back where it was. There's one jukebox a floor and it's the floor's, so
// unlike a picture there is nothing to choose first: the whole move is picking a wall.

export interface Spot {
  wall: WallId;
  /** Its middle along that wall: x on the north and south walls, z on the east and west ones. */
  u: number;
  /** False when something is in the way of its standing there. */
  ok: boolean;
}

/** How much clear floor its cabinet needs round itself, so you can walk up to it. */
const CLEAR = 0.25;

/** Whether it would stand there clear: inside the room, off the windows, doors and wall fittings, out of the furniture's way. */
export function spotFits(office: Office, wall: WallId, u: number): boolean {
  if (blocksOpening(wall, u, JUKEBOX.width)) return false;
  const spot = jukeboxSpot(wall, u);
  const box = jukeboxBox(spot);
  // Inside the walls, and in neither of the rooms that are for something else.
  if (box.minX < FLOOR.minX || box.maxX > FLOOR.maxX || box.minZ < FLOOR.minZ || box.maxZ > FLOOR.maxZ) return false;
  if (spot.x > MEETING_ROOM.minX && spot.x < MEETING_ROOM.maxX && spot.z > MEETING_ROOM.minZ && spot.z < MEETING_ROOM.maxZ) return false;
  // The bit of wall it takes: nothing already hung there (the TV, a board, its own old spot).
  const rect: WallRect = { wall, u0: u - JUKEBOX.width / 2 - 0.05, u1: u + JUKEBOX.width / 2 + 0.05, y0: 0, y1: JUKEBOX.height };
  if (office.fixtures().some((f) => f !== office.jukebox.fixture && overlaps(rect, f))) return false;
  // And nothing standing on the floor there. Its own collider moves with it, so putting it back
  // where it came from isn't in its way.
  const clear = jukeboxBox(spot, CLEAR);
  for (const c of office.colliders) {
    if (c === office.jukebox.collider) continue;
    // The walls are what it stands against, anything you could walk over is no obstacle, and
    // anything up past its head (the ceiling, the loft) it fits under.
    if (office.wallColliders.has(c) || c.top <= CLEAR || (c.bottom ?? 0) >= JUKEBOX.height) continue;
    if (clear.minX < c.maxX && c.minX < clear.maxX && clear.minZ < c.maxZ && c.minZ < clear.maxZ) return false;
  }
  return true;
}

/** Takes the jukebox in hand: aim at a wall and click to stand it there, or Esc to leave it be. */
export class Mover {
  readonly ghost = new JukeboxGhost();
  /** Called when moving starts or stops. */
  onChange: () => void = () => {};
  private cur = false;
  private at: Spot | null = null;
  private mouse = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();

  constructor(
    private net: Net,
    private camera: THREE.PerspectiveCamera,
    canvas: HTMLElement,
    private player: PlayerController,
    private office: Office,
  ) {
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    // Esc frees the mouse before the page ever sees the key; treat that as putting it back too.
    // The move begins in a window, which is where the mouse was let go of, so the loss of a lock
    // that was never taken is that window closing rather than an Esc: only take it as an Esc once
    // a lock has been here to lose (as hanging a picture does, see hanging.ts).
    let locked = false;
    document.addEventListener('pointerlockchange', () => {
      const had = locked;
      locked = this.player.locked;
      if (this.cur && had && !locked && this.player.view === 'first') this.cancel();
    });
  }

  get active(): boolean {
    return this.cur;
  }

  /** Where it would stand right now, if you're aiming at a wall. */
  get spot(): Spot | null {
    return this.at;
  }

  /** Pick the jukebox up. */
  start() {
    if (this.cur) return;
    this.cur = true;
    this.onChange();
  }

  /** Stands it where you aim. `ndc` is where you clicked, in third person. */
  place(ndc?: THREE.Vector2) {
    if (!this.cur) return;
    if (ndc && this.player.view === 'third') this.mouse.copy(ndc);
    this.update();
    const at = this.at;
    if (!at) return toast('Aim at a wall to stand it against it');
    if (!at.ok) return toast("Something's in the way there", 'warn');
    this.net.send({ t: 'jukebox.place', spot: jukeboxSpot(at.wall, at.u) });
    this.stop();
  }

  cancel() {
    if (!this.cur) return;
    this.stop();
  }

  /** Every frame: move the ghost to where you aim. */
  update() {
    if (!this.cur) return;
    this.raycaster.setFromCamera(this.player.view === 'first' ? new THREE.Vector2(0, 0) : this.mouse, this.camera);
    const hit = aimAtWall(this.raycaster.ray);
    if (!hit) {
      this.at = null;
      this.ghost.hide();
      return;
    }
    const [lo, hi] = jukeboxRun(hit.wall);
    const u = Math.min(Math.max(hit.u, lo), hi);
    const ok = spotFits(this.office, hit.wall, u);
    this.at = { wall: hit.wall, u, ok };
    this.ghost.show(this.at, ok);
  }

  private stop() {
    if (!this.cur) return;
    this.cur = false;
    this.at = null;
    this.ghost.clear();
    this.onChange();
  }
}

