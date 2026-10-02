/** Frame admission independent of display Hz. Simulation and drawing use separate instances. */
export class FrameCadence {
  private last: number | null = null;
  private due = 0;
  private fps: number | 'display' | null = null;

  reset() {
    this.last = null;
    this.fps = null;
  }

  /** Seconds since the last admitted frame, or null. Hidden time never advances simulation. */
  admit(now: number, fps: number | 'display', visible = true): number | null {
    if (!visible) {
      this.reset();
      return null;
    }
    if (this.last === null) {
      this.last = now;
      this.due = fps === 'display' ? now : now + 1000 / fps;
      this.fps = fps;
      return 0;
    }
    // Apply live changes immediately; don't inherit a previous, slower deadline.
    if (this.fps !== fps) {
      this.fps = fps;
      this.due = now;
    }
    if (fps !== 'display' && now + 0.01 < this.due) return null;
    const delta = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    if (fps !== 'display') {
      const interval = 1000 / fps;
      this.due += interval;
      // A stall should not cause a burst of catch-up draws.
      if (this.due <= now) this.due = now + interval;
    }
    return delta;
  }
}
