type Processes = Map<number, { ppid: number; args: string }>;

/** Share costly WMI reads across floors; port discovery remains independent and current. */
export class WindowsProcessCache {
  private value?: Processes;
  private pending?: Promise<Processes>;
  private attempted = -Infinity;
  private refreshed = -Infinity;
  private failure?: unknown;

  constructor(private load: () => Promise<Processes>, private now = Date.now) {}

  async get(listenerPids: number[]): Promise<Processes> {
    if (this.pending) return this.pending;
    const now = this.now();
    const missing = !this.value || listenerPids.some((pid) => !this.value!.has(pid));
    if (this.value && now - this.refreshed < 60_000 && !missing) return this.value;
    // New/short-lived listeners and failed queries must not trigger WMI on every floor tick.
    if (now - this.attempted < 10_000) {
      if (this.value) return this.value;
      throw this.failure ?? new Error('Windows process discovery is cooling down');
    }
    this.attempted = now;
    this.pending = this.load().then((value) => {
      this.value = value;
      this.refreshed = this.now();
      this.failure = undefined;
      return value;
    }).catch((error: unknown) => {
      this.failure = error;
      throw error;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }
}
