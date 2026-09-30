/**
 * Where you are, and putting you somewhere: in the elevator car, on your feet at a spot, where a map
 * has you come in, up on its throne; and where you're standing, to come back to.
 */
import { ELEVATOR, ELEVATOR_CAR, FLOOR, POLE, SLAB, STOREY, WALL_HEIGHT, inElevator, inWing } from '../../shared/layout';
import { ROOF, ROOF_NAME } from '../../shared/rooftop';
import type { Arrival } from '../features/climbing/controller';
import { rememberSpot, store, type Spot } from '../state';
import type { Ctx } from './context';
import type { CoreState } from './ctx';
import { builtFloors } from './floors';
import type { Parts } from './parts';

export function installPlace(ctx: Ctx, core: CoreState, parts: Pick<Parts, 'worlds' | 'seating' | 'climbing' | 'cars'>) {
  const { player, me, net } = ctx;
  const { inOffice, plan } = parts.worlds;

  /** In the car, facing out through the doors: where you are when you arrive on a floor, or down in the `garage`. */
  function placeInCar(at?: { x: number; z: number }, garage = false) {
    if (!inOffice()) return placeAtSpawn();
    const spot = at && inElevator(at.x, at.z) ? at : { x: ELEVATOR.x, z: (ELEVATOR_CAR.minZ + ELEVATOR_CAR.maxZ) / 2 };
    placeAt({ x: spot.x, y: garage ? player.street : 0, z: spot.z, rotY: 0 });
  }

  /** Down in the garage (or out on the street) under the floor you're on. */
  function downstairs(): boolean {
    return !core.upTop && player.pos.y < -SLAB - 1;
  }

  /**
   * Inside the office on your floor, its back office as far as it's built out too: not out on the
   * balcony, the fire escape, the street or the golf course across it, nor down in the garage.
   */
  function indoors(): boolean {
    const p = player.pos;
    if (core.upTop || !inOffice() || p.y < -1 || p.y > WALL_HEIGHT) return false;
    return (p.x > FLOOR.minX && p.x < FLOOR.maxX && p.z > FLOOR.minZ && p.z < FLOOR.maxZ) || inWing(p.x, p.z, parts.worlds.officeWing());
  }

  /** On your feet at `at`, facing `rotY` and looking straight ahead. */
  function placeAt(at: { x: number; y: number; z: number; rotY: number }) {
    if (player.seat) parts.seating.standUp();
    // Out of the car, wherever you are (none before the cars are there: nobody's in one yet).
    ctx.activities.stop('driver', 'desk');
    player.pos.set(at.x, at.y, at.z);
    player.vy = 0;
    player.facing = at.rotY;
    player.camYaw = player.facing - Math.PI;
    player.lookPitch = -0.08;
  }

  /** Where you're standing, to come back to (see lastSpot): nowhere while you're between floors, or climbing between them. */
  function spotHere(): Spot | null {
    if (!store.floor || core.trip || parts.climbing.climber.active) return null;
    // Sitting, it's where you'd get up to; in a car, where you'd get out.
    const { driver } = parts.cars;
    const at = (driver.active ? driver.wayOut() : player.standingSpot()) ?? player.pos;
    const name = store.floor === ROOF ? ROOF_NAME : (store.currentFloor()?.name ?? '');
    return { floor: store.floor, name, map: plan().id, x: at.x, y: at.y, z: at.z, facing: player.facing, ...(onThrone() ? { throne: true } : {}) };
  }

  function saveSpot() {
    const s = spotHere();
    if (s) rememberSpot(s);
  }

  /**
   * Where you are, to arrive at the same spot on floor `to`. Down on the street (or the steps to it),
   * that's the street there too. On a map of its own every floor's the same hall on the ground, so down
   * in its dungeon is down in the other one's.
   */
  function standingAt(to: string): Arrival {
    const floors = builtFloors();
    const from = floors.findIndex((f) => f.id === store.floor);
    const there = floors.findIndex((f) => f.id === to);
    const below = inOffice() && player.pos.y < -SLAB - 0.05 && from >= 0 && there >= 0;
    return { x: player.pos.x, y: below ? player.pos.y + (from - there) * STOREY : player.pos.y, z: player.pos.z, rotY: player.facing };
  }

  /** Arrived in a spot that's a pole's hole on this floor: step out of it, the way in. */
  function unstick() {
    const { office } = ctx;
    if (!inOffice() || !office.stack.polesGoDown()) return;
    const p = player.pos;
    const spot = office.stack.poles().find((s) => Math.max(Math.abs(p.x - s.x), Math.abs(p.z - s.z)) <= POLE.rail + 0.35);
    if (!spot) return;
    const out = POLE.rail + 0.7;
    p.set(spot.x + Math.sin(spot.open) * out, Math.max(0, p.y), spot.z + Math.cos(spot.open) * out);
  }

  /** Where you come in on a map of its own: on the throne if nobody's on it, else on your feet where the map says. */
  function placeAtSpawn() {
    const p = plan();
    const at = p.spawn;
    placeAt({ x: at.x, y: parts.worlds.groundHere(at.x, at.z, 1.5), z: at.z, rotY: at.rotY });
    // Not on the way to another floor: the throne's this one's.
    if (!core.trip) sitOnThrone();
  }

  /** Up onto the map's throne, if it has one and nobody's on it. */
  function sitOnThrone() {
    const seat = plan().throne && parts.seating.freePlace(plan().throne!);
    if (!seat || core.upTop) return;
    if (player.seat) player.stand();
    player.sit(seat);
    me.sit(seat.hips);
    if (store.floor) net.send({ t: 'sit', seat: seat.key });
  }

  /** Sitting on the map's throne. */
  function onThrone(): boolean {
    const id = plan().throne?.id;
    return !!id && player.seat?.seatId === id;
  }

  return { placeInCar, downstairs, indoors, placeAt, spotHere, saveSpot, standingAt, unstick, placeAtSpawn, sitOnThrone, onThrone };
}
