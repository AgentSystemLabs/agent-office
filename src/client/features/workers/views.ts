/**
 * The workers as you see them: at their desks with their laptops (or up and about in the castle),
 * walking in to a meeting, packing up when they're sent home (or marched down to the dungeon), how
 * worn out they look, and the seats: which are free, the bean bags, the back office built out. Also
 * the building dressed up for a holiday, and what the workers have spent.
 */
import * as THREE from 'three';
import { FLOOR, WING, beanbagsOut, deskBuilt, vacantSeats, wingMinZ, wingRowZ } from '../../../shared/layout';
import { OFFICE_PLAN } from '../../../shared/maps';
import { MEETING_PATTERNS } from '../../../shared/meetings';
import type { WorkerInfo, WorkerTask } from '../../../shared/protocol';
import { workerPr } from '../../../shared/status';
import type { Ctx } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import { pastTheWing, seatBuilt } from '../../core/floors';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { noOutline } from '../../core/outline';
import type { Parts } from '../../core/parts';
import { waitingInOrder } from '../../nextup';
import { waitingOnSomeone } from '../../notify';
import { renderTitle } from '../../shared/title';
import { store } from '../../state';
import { $ } from '../../ui/dom';
import { openExpand } from '../../ui/floorplan';
import { renderWorkers } from '../../ui/workers-panel';
import { renderLimits } from '../../ui/limits';
import { modelBadge, providerLabel } from '../../ui/provider';
import { renderUsage } from '../../ui/usage';
import { Worker } from '../../world/character';
import { Jail } from './jail';
import { Laptop } from './laptop';
import { Arrivals, Departures } from './leaving';
import { Sendoffs } from './sendhome';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    expand: true;
  }
}

export interface WorkerView {
  model: Worker;
  laptop: Laptop;
  deskId: string;
  status: string;
  acked: boolean;
}

/** How close (meters) you stop a worker jumping, and how far you go before it starts again. */
const HOLD_NEAR = 4;
const HOLD_LEAVE = 5;
/** How long a worker sent out from the herald has to turn up before its seat's forgotten. */
const HERALD_WAIT = 30_000;

export type WorkerViewsParts = Pick<Parts, 'stage' | 'worlds' | 'travel' | 'rooftop' | 'cabinet' | 'notifier' | 'waiting' | 'dog' | 'peers'>;

/**
 * Registers what follows the workers, the jail, the floor plan, the meeting, the pull requests and
 * the queue, the theme, and what's been spent (see the order below), and the workers' own tick.
 */
export function installWorkerViews(ctx: Ctx, core: CoreState, parts: WorkerViewsParts) {
  const { scene, sound, player, camera, office, sky, confetti, hands, me, net } = ctx;
  const { holiday } = parts.stage;
  const { plan, groundHere, officeWing, inOffice } = parts.worlds;

  const workerViews = new Map<string, WorkerView>();
  /** Workers a `worker.remove` is taking out of the store right now. They walk out of the building; a worker that's gone because you changed floors just vanishes. */
  const sentHome = new Set<string>();
  // Workers sent home, packing up and walking out with a box of their things.
  const departures = new Departures(
    scene,
    groundHere,
    (x, y, z) => sound.stepAt(x, z, y),
    () => arrangeSeats(),
    () => ctx.world().ways,
  );
  // Workers locked up in the dungeon, on a map that has one, wasting away in their cells.
  const jail = new Jail(
    () => store.jail,
    () => store.officeNow(),
    (model, p) => {
      model.setOutfit(plan().agents.outfit === 'peasant' ? 'peasant' : null);
      model.setAge(agedBy(p.workedMs ?? 0));
    },
  );
  // Workers sent home on a map with a script for it (the castle's Kingsguard marching them down to the dungeon).
  const sendoffs = new Sendoffs(
    scene,
    groundHere,
    { step: (x, y, z) => sound.stepAt(x, z, y), door: (at, open) => sound.cellDoor(at, open), thud: (at) => sound.thud(at) },
    () => arrangeSeats(),
    () => ctx.world(),
    jail,
  );
  // Workers called to a meeting, walking in from the elevator (or the doors) to the meeting table.
  const arrivals = new Arrivals(
    scene,
    groundHere,
    (x, y, z) => sound.stepAt(x, z, y),
    () => ctx.world().ways,
  );
  /** Set while a floor's workers arrive with it (a welcome, an elevator ride): they're in their seats already. */
  let seatedAlready = false;
  /** A floor arriving (a welcome, a floor.enter): nobody's still leaving or coming in, and its workers are seated already. */
  function seatedOnArrival() {
    departures.clear();
    sendoffs.clear();
    arrivals.clear();
    seatedAlready = true;
  }

  function syncWorkers() {
    const world = ctx.world();
    const court = parts.worlds.court();
    for (const w of store.workers.values()) {
      let v = workerViews.get(w.id);
      const desk = world.desks.get(w.deskId);
      if (!desk) continue;
      if (!v) {
        departures.vacate(w.deskId);
        sendoffs.vacate(w.deskId);
        const model = new Worker(w.name, w.color);
        model.setCostume(store.theme.active);
        model.setOutfit(plan().agents.outfit === 'peasant' ? 'peasant' : null);
        model.setAge(ageOf(w));
        desk.seatAnchor.add(model.root);
        // Its globe floats beside the laptop (or the kiosk's counter), out from behind the card over
        // its head and the back of its chair, so it shows from across the room.
        const beside = desk.def.station ? new THREE.Vector3(0.62, 0.9, 0) : new THREE.Vector3(0.64, 0.5, -0.1);
        model.setPropSpot(model.root.worldToLocal(desk.laptopAnchor.localToWorld(beside)));
        // Called to a meeting just now: out of the elevator and over to the table, one after another.
        if (desk.def.room && !seatedAlready) arrivals.add(model, desk);
        // In the castle, a worker at the tables gets up and walks about (see Court): a new one runs in to its seat.
        else if (court && inCourt(w)) court.add(w.id, model, desk, seatedAlready ? undefined : cameFrom(w));
        const laptop = new Laptop(world.device);
        desk.laptopAnchor.add(laptop.root);
        noOutline(desk.group);
        desk.chair.rotation.y = 0;
        v = { model, laptop, deskId: w.deskId, status: '', acked: true };
        workerViews.set(w.id, v);
      }
      if (v.status !== w.status || v.acked !== w.acked) {
        // It just finished or started waiting on you (not already so when this page first saw it): ding, and notify if you're away.
        if (waitingOnSomeone(w) && v.status !== '' && w.status !== v.status) {
          sound.ding(w.status);
          parts.notifier.alert(w);
          // Playing at the arcade: one of yours stops the game.
          if (w.status === 'needs_input' && yours(w)) parts.cabinet.needsYou(w);
        }
        // Finished what it was on: a little spin and a puff of confetti.
        if (w.status === 'done' && (v.status === 'working' || v.status === 'needs_input')) {
          v.model.celebrate();
          burstOver(w.deskId, 40);
        }
        v.status = w.status;
        v.acked = w.acked;
        v.model.setStatus(w.status, waitingOnSomeone(w));
        noOutline(v.model.root);
      }
      v.model.setAction(w.action);
      v.model.setPr(workerPr(w, store.pulls.items, store.queue.tasks));
      v.model.setLost(!!w.lost);
      const engineBadge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort) : undefined;
      v.model.setTask(meetingCard(w) ?? (w.task && w.kind === 'agent' ? { ...w.task, name: `${providerLabel(w.provider, store.project)}${engineBadge ? ` · ${engineBadge}` : ''} · ${w.task.name}` } : w.task));
      const deskDef = plan().byId.get(w.deskId);
      // Keys clack while it types, not while it reads, watches its tests or browses.
      if (deskDef) sound.setTyping(w.id, deskDef.x, deskDef.z, w.status === 'working' && (!w.action || w.action === 'edit'));
      const again = w.kind === 'shell' ? 'restart' : 'resume';
      v.laptop.setPlaceholder(w.lost ? `🌿 ${w.name}'s worktree was deleted — press E to fix it` : w.status === 'offline' ? `💤 ${w.name} is asleep — press R to ${again}` : w.status === 'exited' ? `${w.name} exited` : 'booting…');
    }
    for (const [id, v] of workerViews) {
      if (store.workers.has(id)) continue;
      arrivals.forget(v.model);
      const desk = world.desks.get(v.deskId);
      // Up and about in the castle: it sets off from where it's standing.
      const up = court?.release(id);
      // Sent home: it packs up and walks out, and the seat shows as free once it's up (see departures), or
      // on a map with its own way of seeing workers off, that (the castle's dungeon, for one it locks up).
      const send = plan().sendHome;
      if (desk && sentHome.has(id) && send && (!send.keeps || store.jail.prisoners.some((p) => p.id === id))) sendoffs.add(id, v.model, v.laptop, desk, up);
      else if (desk && sentHome.has(id)) departures.add(v.model, v.laptop, desk, up);
      else {
        v.model.root.removeFromParent();
        v.laptop.root.removeFromParent();
        v.model.dispose();
        v.laptop.dispose();
      }
      sound.removeTypist(id);
      workerViews.delete(id);
    }
    arrangeSeats();
    // Whoever's waiting on someone lines up for the throne, the one who's waited longest first.
    court?.line(waitingInOrder(store.workers.values()).filter(inCourt).map((w) => w.id));
    renderWorkers((id) => parts.waiting.openWorkerTerminal(id));
    parts.waiting.renderWaiting();
    parts.notifier.sync(store.workers);
    renderTitle();
  }

  /** A worker that sits at the tables (not a board agent or at the meeting table): it gets up and lines up for the throne. */
  function inCourt(w: WorkerInfo): boolean {
    const d = plan().byId.get(w.deskId);
    return w.kind === 'agent' && !!d && !d.station && !d.room && !w.meeting;
  }

  /**
   * The seat a worker sent out from the herald goes to: the first free one, not counting one you've
   * just sent someone else to (it isn't taken until the office says so).
   */
  function heraldSeat(): string | undefined {
    const now = performance.now();
    for (const [id, s] of heraldHires) if (now - s.at > HERALD_WAIT) heraldHires.delete(id);
    return [...plan().desks, ...plan().overflow].find((d) => !store.workerAtDesk(d.id) && !heraldHires.has(d.id))?.id;
  }

  /** Seats you've just sent a worker out to from the herald (see hireFromHerald), so a second goes elsewhere. */
  const heraldHires = new Map<string, { floor: string | null; at: number }>();

  /** Where a worker just hired comes in from, running to its seat: the herald, the doors (off the queue), or nowhere (it's just there). */
  function cameFrom(w: WorkerInfo): [number, number] | undefined {
    heraldHires.delete(w.deskId);
    // Sent out by the herald (by anyone: the office says so): from beside him.
    const h = plan().herald;
    if (w.via === 'herald' && h) return [h.x + Math.sin(h.rotY) * 1.1, h.z + Math.cos(h.rotY) * 1.1];
    if (w.createdBy.endsWith('(queue)')) return [plan().door.x, plan().door.z];
    return undefined;
  }

  /** How worn out a worker looks on this map, 0–1: how long it has worked, of the map's ageMinutes. */
  function ageOf(w: WorkerInfo): number {
    return agedBy((w.workedMs ?? 0) + (w.workingSince !== undefined && w.status === 'working' ? Math.max(0, store.officeNow() - w.workingSince) : 0));
  }

  /** How worn out `worked` ms of work makes a worker look on this map, 0–1. */
  function agedBy(worked: number): number {
    const full = plan().agents.ageMinutes;
    return full ? Math.min(1, worked / (full * 60_000)) : 0;
  }

  /** Whoever's locked up in this floor's dungeon, in their cells. */
  function syncJail() {
    jail.sync(ctx.world().dungeon, plan().sendHome);
  }
  store.on('jail', syncJail);

  /** Hired by you (at a desk, or through the queue), or last given something to do by you. */
  function yours(w: WorkerInfo): boolean {
    const name = store.peers.get(store.you)?.name ?? store.profile.name;
    return w.createdBy === name || w.createdBy === `${name} (queue)` || w.lastInput?.by === name;
  }

  /**
   * The card over a worker at the meeting table: its role, the round, and whether it has the floor
   * (working on its part) or is listening while the others work on theirs.
   */
  function meetingCard(w: WorkerInfo): WorkerTask | undefined {
    const m = store.meeting.current;
    if (!w.meeting || !m || m.id !== w.meeting) return undefined;
    const i = m.seats.findIndex((s) => s.workerId === w.id);
    if (i < 0) return undefined;
    const role = m.seats[i].role;
    const p = MEETING_PATTERNS[m.pattern];
    if (m.status !== 'running') return { name: `${role} · ${p.icon} ${p.label}`, summary: m.status === 'done' ? `✅ The meeting wrote ${m.output}` : `⛔ Stopped: ${m.reason ?? 'stopped'}` };
    const t = m.turns.find((x) => x.seat === i);
    if (!t || t.state === 'done') return { name: `👂 ${role} · round ${m.round} of ${m.rounds}`, summary: t ? 'Part written: listening' : 'Listening' };
    return { name: `💬 ${role} · round ${m.round} of ${m.rounds}`, summary: t.state === 'working' ? t.doing : `${t.doing} (up next)` };
  }

  /**
   * A seat or kiosk shows it's free (its '+', or the board agent waiting there) only while nobody's at
   * it, and once every desk is taken, bean bags come out for the workers who don't fit.
   */
  function arrangeSeats() {
    const world = ctx.world();
    // Someone sent home still counts until they get up, so a bean bag stays out under them.
    const free = vacantSeats(store.workers.values(), (id) => departures.seated(id) || sendoffs.seated(id));
    for (const [id, desk] of world.desks) desk.vacancy.visible = free.has(id) && seatBuilt(id);
    const appeared = world.setBeanbags(beanbagsOut((id) => !free.has(id), store.floorPlan.wing));
    // One came out right where you're standing (on the office floor, not down in the garage): you end up on top of it.
    const p = player.pos;
    for (const c of appeared) if (p.y > -0.1 && p.y < c.top && p.x > c.minX - 0.3 && p.x < c.maxX + 0.3 && p.z > c.minZ - 0.3 && p.z < c.maxZ + 0.3) p.y = c.top;
  }
  store.on('workers', syncWorkers);
  const workerPos = new THREE.Vector3();
  /** When (performance.now()) the workers' looks were last brought up to how long they've worked. */
  let agedAt = 0;
  ctx.ticks.add('others', ({ dt, t, now }) => {
    const camPos = camera.position;
    // How worn out each looks, as they work on (every second or so is plenty).
    const aging = !!plan().agents.ageMinutes && now - agedAt > 1000;
    if (aging) agedAt = now;
    for (const [id, v] of workerViews) {
      const desk = plan().byId.get(v.deskId)!;
      if (aging) {
        const w = store.workers.get(id);
        if (w) v.model.setAge(ageOf(w));
      }
      // A jumping worker holds still while you're near enough to read its card, and jumps again once you walk away.
      const d = v.model.root.getWorldPosition(workerPos).distanceTo(player.pos);
      v.model.held = d < (v.model.held ? HOLD_LEAVE : HOLD_NEAR);
      v.model.update(dt, t);
      // A board agent's kiosk has no laptop to paint (see buildKiosk).
      if (!desk.station) v.laptop.update(dt, store.screens.get(id), Math.hypot(desk.x - camPos.x, desk.z - camPos.z));
    }
    for (const a of parts.worlds.idleAgents()) if (a.view.vacancy.visible) a.model.update(dt, t);
    departures.update(dt, t);
    if (!core.upTop) {
      sendoffs.update(dt, t);
      jail.update(dt, t, camera.position);
    }
    arrivals.update(dt);
    parts.worlds.court()?.update(dt);
  });

  /** The floor plan last shown, to tell someone knocking through from arriving on a floor already built out (or back on the office's map). */
  let shownPlan: { floor: string | null; map: string; wing: number } = { floor: null, map: OFFICE_PLAN.id, wing: 0 };
  /**
   * The floor's back office, as far as it's built out, and the signs over its desks. Everything that
   * finds its way round the floor learns how far it goes; a row knocked through goes up in a puff of
   * dust, and anyone standing past where it goes now steps back in first.
   */
  function syncPlan() {
    const fp = store.floorPlan;
    const level = officeWing();
    const was = shownPlan;
    shownPlan = { floor: store.floor, map: plan().id, wing: level };
    const p = player.pos;
    if (inOffice() && pastTheWing(p, level)) {
      // Out to the side aisle of what's left, or back into the room.
      const side = p.x < (WING.minX + WING.maxX) / 2 ? WING.minX + 0.6 : WING.maxX - 0.6;
      p.set(level ? side : p.x, 0, level ? wingMinZ(level) + 0.6 : FLOOR.minZ + 1.6);
    }
    office.setWing(level);
    office.signs.set(fp.labels, (d) => deskBuilt(d, level));
    player.wing = sound.wing = level;
    sky.setWing(level);
    parts.travel.syncStack();
    parts.rooftop.syncRoof();
    arrangeSeats();
    if (was.floor === store.floor && was.map === shownPlan.map && level > was.wing) {
      const at = { x: (WING.minX + WING.maxX) / 2, y: 1.2, z: wingRowZ(level) };
      confetti.burst(at.x, 2.4, at.z, 140, 0.8);
      sound.toss('thunk', at);
    }
  }
  store.on('floorPlan', syncPlan);
  ctx.interactions.define('expand', {
    reach: 8,
    hint: () => {
      const level = store.floorPlan.wing;
      if (level >= WING.rows) return { k: 'full', parts: [hintTitle('🏢 Back office'), aside('built all the way out'), key('E', 'Wall a row up')] };
      return { k: String(level), parts: [hintTitle(level ? '🚧 Room to grow' : '🚧 Room to grow through the wall'), aside(level ? `${level} of ${WING.rows} rows built` : 'the office can get bigger here'), key('E', level ? 'Another row: 2 more desks' : 'Knock through: 2 more desks')] };
    },
    use: onE(() => openExpand(net)),
  });
  // A worker at the meeting table shows its role and round over its head (see meetingCard).
  store.on('meeting', syncWorkers);
  // A worker's bubble shows whether it has a pull request open (green) or merged (purple: send it home).
  const paintPrs = () => {
    for (const [id, v] of workerViews) {
      const w = store.workers.get(id);
      if (w) v.model.setPr(workerPr(w, store.pulls.items, store.queue.tasks));
    }
  };
  store.on('pulls', paintPrs);
  store.on('queue', paintPrs);
  store.on('workers', renderUsage);

  /**
   * Dresses the building up for the holiday it's set to (⚙️ Settings), or takes it all down: the sky and
   * the decorations, the dog, your hands and your character, everyone else, and every worker.
   */
  function dressUp() {
    const theme = store.theme.active;
    holiday.set(theme);
    sky.setTheme(theme);
    parts.dog.setCostume(theme);
    hands.setCostume(theme);
    me.setCostume(theme);
    for (const r of parts.peers.remotes.values()) r.person.setCostume(theme);
    for (const v of workerViews.values()) v.model.setCostume(theme);
    for (const a of parts.worlds.idleAgents()) a.model.setCostume(theme);
    ctx.world().herald?.person.setCostume(theme);
  }
  store.on('theme', dressUp);
  store.on('usage', renderUsage);
  store.on('limits', renderLimits);
  // The reset countdowns tick down between reads.
  setInterval(renderLimits, 30_000);
  $('limits').addEventListener('click', () => net.send({ t: 'limits.refresh' }));

  /** Where confetti comes from over a desk: above the worker's head. */
  function burstOver(deskId: string, n: number) {
    // Up and about in the castle: over wherever it is.
    const w = store.workerAtDesk(deskId);
    const v = w && parts.worlds.court()?.away(w.id) ? workerViews.get(w.id) : undefined;
    if (v) {
      const at = v.model.root.position;
      return confetti.burst(at.x, at.y + 2.1, at.z, n);
    }
    const d = plan().byId.get(deskId);
    if (d) confetti.burst(d.x, 2.3, d.z, n);
  }

  /** Syncs the workers as if they were in their seats already: nobody walks in (see applyMap in core/maps.ts). */
  function syncWorkersSeated() {
    const already = seatedAlready;
    seatedAlready = true;
    syncWorkers();
    seatedAlready = already;
  }

  return {
    /** The workers on this floor, as they're drawn at their desks. */
    workerViews,
    departures,
    jail,
    sendoffs,
    arrivals,
    seatedOnArrival,
    /** A `worker.remove` is taking `id` out of the store: it walks out of the building. */
    sendingHome: (id: string) => void sentHome.add(id),
    /** The store has the message: whoever arrives or goes from now on isn't part of arriving on a floor. */
    settled() {
      seatedAlready = false;
      sentHome.clear();
    },
    syncWorkers,
    syncWorkersSeated,
    syncJail,
    syncPlan,
    dressUp,
    heraldSeat,
    heraldHires,
    burstOver,
  };
}
