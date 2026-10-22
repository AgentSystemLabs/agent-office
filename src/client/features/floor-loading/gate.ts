export const EMERGENCY_MS = 15_000;

export interface Clock {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

const clock: Clock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: id => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** One ride owns its timer and readiness; late work from a cancelled ride cannot open doors. */
export class RideGate {
  readonly abort = new AbortController();
  private timer: unknown;
  private closed = false;
  private waiting = false;

  constructor(private ready: () => void, private emergency: (error?: unknown) => void, private time = clock) {
    this.timer = time.set(() => { if (!this.closed) this.emergency(); }, EMERGENCY_MS);
  }

  wait(work: Promise<unknown>) {
    if (this.waiting || this.closed) return;
    this.waiting = true;
    void work.then(() => {
      if (this.closed) return;
      this.close();
      this.ready();
    }, error => { if (!this.closed) this.emergency(error); });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.time.clear(this.timer);
    this.abort.abort();
  }
}
