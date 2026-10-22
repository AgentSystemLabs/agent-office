import type { Ctx, Trip } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import type { Parts } from '../../core/parts';
import { ROOF, ROOF_NAME } from '../../../shared/rooftop';
import { store } from '../../state';
import { modalOpen } from '../../ui/dom';
import { onModelsProgress } from '../../world/models';
import { RideGate } from './gate';
import { adaptiveGraphics } from './quality';
import { ElevatorMusic } from './sound';
import { elevatorWait } from './ui';

type Deps = Pick<Parts, 'travel' | 'stage'>;
type Waiting = { gate: RideGate; ui: ReturnType<typeof elevatorWait>; music: ElevatorMusic; trip: Trip; origin: string | null; entered: boolean };

export function installFloorLoading(ctx: Ctx, core: CoreState, parts: Deps) {
  adaptiveGraphics(ctx, core, parts);
  let active: Waiting | null = null;

  function release(cancel = false) {
    const ride = active;
    if (!ride) return;
    active = null;
    ride.gate.close(); ride.music.stop(); ride.ui.close();
    if (cancel && core.trip === ride.trip) {
      parts.travel.cancel();
      // Ordered after the destination request, this also defeats a delayed server reply.
      if (ride.origin && !ride.entered) ctx.net.send({ t: 'floor.go', floor: ride.origin });
    }
    document.getElementById('fade')?.classList.remove('on');
    parts.travel.lift()?.setOpen(!!store.floor);
    ctx.player.enabled = !modalOpen();
  }

  function begin(trip: Trip) {
    if (active || (trip.how !== 'elevator' && trip.how !== 'switch')) return;
    // The emergency control replaces the old ten-second automatic trip timeout.
    clearTimeout(trip.timer);
    const ui = elevatorWait(trip.floor === ROOF ? ROOF_NAME : store.floors.find(f => f.id === trip.floor)?.name ?? 'Your floor', () => release(true));
    const music = new ElevatorMusic();
    const gate = new RideGate(() => release(), error => ui.emergency(error));
    active = { gate, ui, music, trip, origin: store.floor, entered: false };
    music.start(() => ctx.settings);
  }

  function arrived() {
    const ride = active;
    if (!ride || ride.entered || store.floor !== ride.trip.floor) return;
    ride.entered = true;
    if (store.floor !== ROOF) ride.ui.destination(store.currentFloor()?.name ?? ctx.world().plan.name);
    ride.gate.wait(prepare(ride));
  }

  async function prepare(ride: Waiting) {
    const signal = ride.gate.abort.signal;
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    ride.ui.status('Unpacking the floor…');
    await frame();
    if (signal.aborted) return;
    await new Promise<void>(resolve => {
      let settle = 0, off = () => {};
      const finish = () => { clearTimeout(settle); off(); signal.removeEventListener('abort', finish); resolve(); };
      signal.addEventListener('abort', finish, { once: true });
      off = onModelsProgress(p => { clearTimeout(settle); if (p.done >= p.asked) settle = window.setTimeout(finish, 100); });
    });
    if (signal.aborted) return;
    ride.ui.status('Warming up graphics…');
    await ctx.renderer.compileAsync(ctx.scene, ctx.camera);
    if (signal.aborted) return;
    // Let texture uploads and the first outlined frames run behind the cabin.
    ride.ui.status('Checking the doors…');
    await frame(); await frame();
  }

  ctx.ticks.add('pre', () => {
    if (!active && core.trip) begin(core.trip);
    // The garage is a ride on the same floor; no floor.enter message is sent.
    if (active && !core.trip && store.floor === active.trip.floor) arrived();
  });
  ctx.messages.on('floor.enter', () => { if (core.trip) begin(core.trip); }, 'before');
  ctx.messages.on('floor.enter', arrived);
  ctx.ticks.add('hud', () => {
    if (!active) return;
    ctx.player.enabled = false;
    parts.travel.lift()?.setOpen(false);
  });
  window.addEventListener('pagehide', () => release(true));
}
