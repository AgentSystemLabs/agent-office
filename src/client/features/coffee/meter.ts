import { BUZZ_SECONDS, type Caffeine } from './caffeine';
import { $ } from '../../ui/dom';

let caffeineKey = '';
/** The caffeine meter: a cup per coffee in a row, and a bar that drains over the buzz's minute. */
export function renderCaffeine(caffeine: Caffeine, now: number) {
  const left = caffeine.left(now);
  const jittery = caffeine.jitter(now) > 0;
  const k = `${Math.ceil(left)}|${caffeine.cups}|${jittery}`;
  if (k === caffeineKey) return;
  caffeineKey = k;
  const el = $('caffeine');
  el.classList.toggle('hidden', !left);
  el.classList.toggle('jittery', jittery);
  if (!left) return;
  $('caffeine-cups').textContent = '☕'.repeat(Math.min(caffeine.cups, 3));
  // The bar eases down a second at a time (see its CSS transition), so aim for where it will be in one.
  $('caffeine-fill').style.width = `${(Math.max(0, left - 1) / BUZZ_SECONDS) * 100}%`;
  $('caffeine-left').textContent = `${Math.ceil(left)}s`;
}
