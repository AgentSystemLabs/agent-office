import * as THREE from 'three';
import type { Ctx } from './context';
import { FrameCadence } from './frame-cadence';
import { modalOpen, onModalChange } from '../ui/dom';

/**
 * The frame loop: each frame, every phase's ticks, in order (see TICK_PHASES, and installLoop). Its
 * clock starts now; hand what it returns to requestAnimationFrame to start it.
 */
export function frameLoop(ctx: Ctx, loading: { drew(): void }): (ts?: number) => void {
  const simulation = new FrameCadence();
  const drawing = new FrameCadence();
  const previousPosition = new THREE.Vector3();
  const previousRotation = new THREE.Quaternion();
  let activeUntil = 0;
  let elapsed = 0;
  // Input wakes drawing before movement or a camera update has had a frame to run.
  const wake = () => { activeUntil = performance.now() + 750; };
  window.addEventListener('keydown', wake);
  window.addEventListener('pointermove', wake);
  window.addEventListener('pointerdown', wake);
  window.addEventListener('wheel', wake, { passive: true });
  onModalChange(wake);
  document.addEventListener('visibilitychange', () => {
    ctx.player.clearKeys();
    simulation.reset();
    drawing.reset();
    wake();
  });
  function frame(ts = performance.now()) {
    requestAnimationFrame(frame);
    const visible = !document.hidden;
    const options = ctx.settings.performance;
    const delta = simulation.admit(ts, options.fps, visible);
    if (!visible) drawing.reset();
    if (delta === null) return;
    const changed = !previousPosition.equals(ctx.camera.position) || !previousRotation.equals(ctx.camera.quaternion);
    if (changed || ctx.player.moving || !ctx.player.grounded || ctx.activities.busy() || ctx.trip()) activeUntil = ts + 750;
    const idle = modalOpen() || ts > activeUntil;
    // Steps remain small even on a low-Hz display: Player.update caps each step at .05.
    const advance = Math.min(delta, 0.1);
    const steps = Math.max(1, Math.ceil(advance / 0.05));
    const render = drawing.admit(ts, idle ? options.idleFps : options.fps) !== null;
    for (let step = 0; step < steps; step++) {
      elapsed += advance / steps;
      ctx.ticks.run({ delta: delta / steps, dt: advance / steps, t: elapsed, now: ts, idle, render: render && step === steps - 1 });
    }
    previousPosition.copy(ctx.camera.position);
    previousRotation.copy(ctx.camera.quaternion);
    if (render) loading.drew();
  }
  return frame;
}
