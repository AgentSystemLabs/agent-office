import type { Ctx } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import type { Parts } from '../../core/parts';
import { modalOpen } from '../../ui/dom';

/** Decisions use sustained frame time, never one expensive first frame or a background tab. */
export class FrameBudget {
  private total = 0;
  private count = 0;
  sample(ms: number): number | null {
    if (ms <= 0 || ms > 250) { this.reset(); return null; }
    this.total += ms;
    if (++this.count < 60 || this.total < 2000) return null;
    const mean = this.total / this.count;
    this.reset();
    return mean;
  }
  reset() { this.total = this.count = 0; }
}

export function adaptiveGraphics(ctx: Ctx, core: CoreState, parts: Pick<Parts, 'stage'>) {
  const budget = new FrameBudget();
  const ceiling = Math.min(window.devicePixelRatio || 1, 1.25);
  ctx.renderer.setPixelRatio(ceiling);
  ctx.canvas.dataset.renderScale = ceiling.toFixed(2);
  ctx.ticks.add('pre', ({ delta }) => {
    if (document.hidden || modalOpen() || core.trip) { budget.reset(); return; }
    const mean = budget.sample(delta * 1000);
    if (mean === null || mean <= 30) return;
    const scale = Math.max(0.65, ctx.renderer.getPixelRatio() * 0.8);
    ctx.renderer.setPixelRatio(scale);
    ctx.canvas.dataset.renderScale = scale.toFixed(2);
    if (mean > 40) {
      ctx.renderer.shadowMap.enabled = false;
      parts.stage.effect.enabled = false;
      ctx.canvas.dataset.graphics = 'reduced';
    }
  });
}
