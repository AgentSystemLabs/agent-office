import './ui.css';
import { h } from '../../ui/dom';
import type { BannerText } from './logic';

export interface BannerHooks {
  /** To that worker's desk. */
  go(id: string): void;
  /** Put away until someone else needs you. */
  hide(): void;
}

/**
 * The banner under the top bar while a worker needs you: who, what it's asking and for how long, and
 * a click (or N) away from its desk. The edge of the screen flashes red when one starts asking.
 */
export class Banner {
  private readonly el: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly edge: HTMLElement;
  private shown: BannerText | null = null;

  constructor(
    private readonly hud: HTMLElement,
    hooks: BannerHooks,
  ) {
    this.go = h('button.needs-you-go', { type: 'button', onclick: () => this.shown && hooks.go(this.shown.id) });
    const x = h('button.needs-you-x', { type: 'button', 'aria-label': 'Hide', title: 'Hide until another worker needs you', onclick: () => hooks.hide() }, '✕');
    this.el = h('div.needs-you.hidden', { role: 'status', 'aria-live': 'polite' }, this.go, x);
    this.edge = h('div.needs-you-flash', { 'aria-hidden': 'true' });
    this.edge.addEventListener('animationend', () => this.edge.classList.remove('on'));
    hud.append(this.el, this.edge);
    window.addEventListener('resize', () => this.place());
  }

  /** What it says now, or null to put it away. It's only redrawn when it would read differently, so a click never lands on a button that's just been swapped. */
  show(text: BannerText | null) {
    if (text?.key === this.shown?.key) return;
    this.shown = text;
    this.el.classList.toggle('hidden', !text);
    if (!text) return;
    this.go.title = `Go to ${text.title.replace(/ needs you$/, '')}'s desk (N)`;
    this.go.replaceChildren(
      h('span.needs-you-icon', { 'aria-hidden': 'true' }, '🙋'),
      h('span.needs-you-text', {}, h('strong', {}, text.title), text.detail ? h('span.needs-you-ask', {}, text.detail) : null),
      ...(text.more ? [h('span.needs-you-more', {}, text.more)] : []),
      h('span.key', {}, 'N'),
    );
    this.place();
  }

  /** A worker has just started asking: the edge of the screen pulses red a few times. */
  flash() {
    this.edge.classList.remove('on');
    // Read back, so taking the class off and putting it on again starts the animation over.
    void this.edge.offsetWidth;
    this.edge.classList.add('on');
  }

  /** Under the top bar, and under the dock too where it has wrapped down into the banner's way. */
  private place() {
    if (!this.shown) return;
    this.el.style.top = '';
    const dock = this.hud.querySelector('.dock')?.getBoundingClientRect();
    const me = this.el.getBoundingClientRect();
    if (dock && dock.left < me.right && dock.bottom > me.top - 8) this.el.style.top = `${Math.round(dock.bottom + 10)}px`;
  }
}
