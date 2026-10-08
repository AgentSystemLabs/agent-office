/** Circuit Racer's local driving simulation. Distances are metres, time is seconds. */
export const TRACK = { x: 160, y: 100, width: 22 };
export const LAPS = 3;
export interface Controls { throttle: boolean; brake: boolean; left: boolean; right: boolean }
export const emptyControls = (): Controls => ({ throttle: false, brake: false, left: false, right: false });

export class Race {
  x = 0;
  y = -TRACK.y;
  yaw = 0;
  vx = 0;
  vy = 0;
  elapsed = 0;
  lap = 1;
  lapStarted = 0;
  lastLap = 0;
  bestLap = Infinity;
  finished = false;
  paused = false;
  offroad = false;
  private gate = 0;
  private lastAngle = -Math.PI / 2;
  private progress = 0;

  get speed() { return Math.hypot(this.vx, this.vy); }

  /** Fixed substeps keep steering and checkpoints stable on slower displays. */
  update(dt: number, input: Controls) {
    if (this.paused || this.finished || !Number.isFinite(dt) || dt <= 0) return;
    let remaining = Math.min(dt, .1);
    while (remaining > 0) {
      const step = Math.min(remaining, 1 / 120);
      this.step(step, input);
      remaining -= step;
      if (this.finished) break;
    }
  }

  private step(dt: number, input: Controls) {
    this.elapsed += dt;
    const radius = Math.hypot(this.x / TRACK.x, this.y / TRACK.y);
    // Approximate distance to the ellipse; sufficient for a generous arcade road shoulder.
    const distance = Math.abs(radius - 1) * Math.min(TRACK.x, TRACK.y);
    this.offroad = distance > TRACK.width;
    const speed = this.speed;
    const steer = Number(input.right) - Number(input.left);
    this.yaw += steer * Math.min(speed / 16, 1) * (1.65 / (1 + speed / 65)) * dt;
    const forward = this.vx * Math.cos(this.yaw) + this.vy * Math.sin(this.yaw);
    const acceleration = (input.throttle ? 24 : 0) - (input.brake ? 42 : 0);
    const next = Math.max(0, forward + (acceleration - forward * (this.offroad ? 1.8 : .22)) * dt);
    const grip = Math.min(1, dt * (this.offroad ? 3 : 9));
    this.vx += (Math.cos(this.yaw) * next - this.vx) * grip;
    this.vy += (Math.sin(this.yaw) * next - this.vy) * grip;
    // Acceleration acts immediately along the car, while lateral velocity decays with grip.
    this.vx += Math.cos(this.yaw) * (next - forward) * (1 - grip);
    this.vy += Math.sin(this.yaw) * (next - forward) * (1 - grip);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const angle = Math.atan2(this.y / TRACK.y, this.x / TRACK.x);
    const delta = Math.atan2(Math.sin(angle - this.lastAngle), Math.cos(angle - this.lastAngle));
    this.lastAngle = angle;
    // Crossing checkpoints in order on the road prevents cutting across the infield for laps.
    if (distance <= TRACK.width && Math.abs(delta) < .1) this.progress += delta;
    if (this.progress >= (this.gate + 1) * Math.PI / 2) {
      this.gate++;
      if (this.gate === 4) {
        this.lastLap = this.elapsed - this.lapStarted;
        this.bestLap = Math.min(this.bestLap, this.lastLap);
        this.lapStarted = this.elapsed;
        this.progress -= 2 * Math.PI;
        this.gate = 0;
        if (this.lap === LAPS) this.finished = true;
        else this.lap++;
      }
    }
  }
}

export function raceTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}
