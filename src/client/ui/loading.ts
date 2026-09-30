import type { ModelsProgress } from '../world/models';

/**
 * The loading screen: the card in index.html, up from the page's first paint while the code downloads,
 * with the office's name, a bar and a line saying what it's waiting on. It comes down once the office is
 * ready to be seen (main.ts says what that takes for whom), or once CAP_MS go by with nothing happening,
 * and it never comes back: a reconnect or a ride to another floor keeps the office on screen as it is.
 */

/**
 * Longest the loading screen stays up with nothing happening: a slow download that keeps coming in keeps
 * it up (the world isn't built without it), but a stalled one, an office that doesn't answer or a page that
 * broke on the way never keeps you out.
 */
export const CAP_MS = 8000;

/** Something the loading screen waits on, and what it says while it does. */
export interface Step {
  say: string;
  done: Promise<unknown>;
}

/**
 * When the loading screen can come down: once every step it's given has settled (one that fails counts),
 * or once `capMs` go by without a sign of life (see stillGoing), whichever comes first. `release` is called
 * once at most, and nothing after that changes anything.
 */
export class Gate {
  private released = false;
  private timer: ReturnType<typeof setTimeout>;

  constructor(
    private release: (why: 'ready' | 'cap') => void,
    private capMs: number,
  ) {
    this.timer = setTimeout(() => this.open('cap'), capMs);
  }

  /** What to wait for, on top of the cap. Given once. */
  until(steps: readonly Promise<unknown>[]) {
    void Promise.allSettled(steps).then(() => this.open('ready'));
  }

  /** Something's still happening (more of a file came in, a step settled): the cap starts over from now. */
  stillGoing() {
    if (this.released) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open('cap'), this.capMs);
  }

  private open(why: 'ready' | 'cap') {
    if (this.released) return;
    this.released = true;
    clearTimeout(this.timer);
    this.release(why);
  }
}

export interface LoadingScreen {
  /** The office drew a frame. The first one is waited for on every visit; the rest cost a check each. */
  drew(): void;
  /** What else to wait for besides the first frame, said in this order while it's waited for. Given once. */
  until(steps: Step[]): void;
}

/** How long the fade out takes, with some to spare, in case its end is never heard of. */
const FADE_MS = 600;

/**
 * Starts the loading screen's clock and has its bar count the model files that `watchModels` reports,
 * plus the steps it waits on; each report puts the cap back. Call it before anything is loaded.
 */
export function loadingScreen(watchModels: (fn: (p: ModelsProgress) => void) => () => void, capMs = CAP_MS): LoadingScreen {
  const screen = document.getElementById('loading');
  const bar = screen?.querySelector<HTMLElement>('.loading-bar');
  const fill = screen?.querySelector<HTMLElement>('.loading-fill');
  const line = screen?.querySelector<HTMLElement>('.loading-say');

  let files: ModelsProgress = { asked: 0, done: 0 };
  let frameDrawn = () => {};
  const frame: Step = { say: 'Loading the office', done: new Promise<void>((resolve) => (frameDrawn = resolve)) };
  /** Every step and whether it has settled, the first frame's first. */
  const steps = [{ step: frame, settled: false }];
  let drawn = false;
  let given = false;
  let gone = false;
  /** How much of the bar is filled: never less than it was, so it doesn't go back when more is asked for. */
  let shown = 0;

  const fillTo = (part: number) => {
    shown = Math.max(shown, part);
    const percent = Math.round(shown * 100);
    if (fill) fill.style.width = `${percent}%`;
    bar?.setAttribute('aria-valuenow', String(percent));
  };
  const paint = () => {
    if (gone) return;
    fillTo((files.done + steps.filter((s) => s.settled).length) / (files.asked + steps.length));
    // Files still coming in before the office is built, then whichever step is next.
    const unpacking = !given && files.done < files.asked;
    const say = (unpacking ? 'Unpacking the office' : steps.find((s) => !s.settled)?.step.say) ?? 'Opening the doors';
    if (line && line.textContent !== say) line.textContent = say;
  };
  const gate = new Gate((why) => {
    if (why === 'cap') {
      const waiting = steps.filter((s) => !s.settled).map((s) => s.step.say);
      if (files.done < files.asked) waiting.push(`${files.asked - files.done} of ${files.asked} model files`);
      console.warn(`The office went ${capMs / 1000} s with nothing happening, so in you go anyway. Still waiting on: ${waiting.join('; ')}`);
    }
    gone = true;
    stopWatching();
    fillTo(1);
    if (!screen) return;
    // Faded out once whatever it waited for is on screen: the frame after the office's first.
    requestAnimationFrame(() => {
      screen.classList.add('gone');
      const remove = () => screen.remove();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return remove();
      // Its own fade's end, not the bar's filling up.
      screen.addEventListener('transitionend', (e) => e.target === screen && remove());
      setTimeout(remove, FADE_MS);
    });
  }, capMs);

  // Every model file asked for, coming in or done, and every step settled, is a sign of life (see CAP_MS).
  const follow = (s: (typeof steps)[number]) => {
    const settle = () => {
      s.settled = true;
      gate.stillGoing();
      paint();
    };
    void s.step.done.then(settle, settle);
  };
  const stopWatching = watchModels((p) => {
    files = p;
    gate.stillGoing();
    paint();
  });
  follow(steps[0]);

  return {
    drew() {
      if (drawn) return;
      drawn = true;
      frameDrawn();
    },
    until(more) {
      if (given) return;
      given = true;
      for (const step of more) {
        const s = { step, settled: false };
        steps.push(s);
        follow(s);
      }
      paint();
      gate.until(steps.map((s) => s.step.done));
    },
  };
}
