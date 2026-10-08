import { h, openModal, type Modal } from '../../ui/dom';
import { emptyControls, LAPS, Race, raceTime, type Controls } from './model';
import { paintRace } from './paint';
import './ui.css';

const RECORD = 'agent-office.circuit-racer.best-v1';
const KEYS: Record<string, keyof Controls> = { ArrowUp: 'throttle', KeyW: 'throttle', ArrowDown: 'brake', KeyS: 'brake', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };

export class Racing {
  private modal: Modal | null = null;
  private race = new Race();
  private input = emptyControls();
  private canvas: HTMLCanvasElement | null = null;
  private stats: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private best = Infinity;
  private recorded = false;

  constructor() {
    try {
      const saved = Number(localStorage.getItem(RECORD));
      if (saved > 0 && Number.isFinite(saved)) this.best = saved;
    } catch { /* Storage may be disabled; racing still works. */ }
  }

  get active() { return !!this.modal; }
  stop() { this.modal?.close(); }

  open() {
    if (this.modal) return;
    this.race = new Race();
    this.input = emptyControls();
    this.recorded = false;
    const canvas = h('canvas', { 'aria-label': 'Circuit Racer track' });
    const stats = h('div.racing-stats', { 'aria-label': 'Race telemetry' });
    const status = h('p.racing-status', { role: 'status' });
    const pause = h('button.btn', { type: 'button', onclick: () => this.togglePause() }, 'Pause');
    const restart = h('button.btn', { type: 'button', onclick: () => this.restart() }, 'Restart');
    const panel = h('section.racing-panel', { role: 'dialog', 'aria-label': 'Circuit Racer' },
      h('header', {}, h('h2', {}, '🏎️ Circuit Racer')),
      stats, canvas, status,
      h('div.racing-actions', {}, h('span.tip', {}, '↑ / W accelerate · ↓ / S brake · ← → / A D steer · P pause · R restart · Esc exit'), pause, restart));
    this.canvas = canvas; this.stats = stats; this.status = status; this.pauseButton = pause;
    const fit = () => {
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.round(box.width * Math.min(devicePixelRatio, 2));
      canvas.height = Math.round(box.height * Math.min(devicePixelRatio, 2));
      this.render();
    };
    const down = (e: KeyboardEvent) => this.key(e, true);
    const up = (e: KeyboardEvent) => this.key(e, false);
    const blur = () => { this.race.paused = true; this.input = emptyControls(); this.render(); };
    this.modal = openModal(panel, { backdropCloses: false, doing: 'playing Circuit Racer', onClose: () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', fit);
      this.input = emptyControls();
      this.modal = null; this.canvas = null; this.stats = null; this.status = null; this.pauseButton = null;
    } });
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', fit);
    fit();
  }

  update(dt: number) {
    if (!this.modal) return;
    this.race.update(dt, this.input);
    if (this.race.finished && !this.recorded) {
      this.recorded = true;
      if (this.race.elapsed < this.best) {
        this.best = this.race.elapsed;
        try { localStorage.setItem(RECORD, String(this.best)); } catch { /* Session-only best. */ }
      }
    }
    this.render();
  }

  private restart() { this.race = new Race(); this.input = emptyControls(); this.recorded = false; this.render(); }
  private togglePause() { this.race.paused = !this.race.paused; this.input = emptyControls(); this.render(); }
  private key(e: KeyboardEvent, down: boolean) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const control = KEYS[e.code];
    if (!control && e.code !== 'KeyP' && e.code !== 'KeyR') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (control) this.input[control] = down && !this.race.paused;
    else if (down && !e.repeat) {
      if (e.code === 'KeyP') this.togglePause();
      else this.restart();
    }
  }

  private render() {
    if (!this.canvas || !this.stats || !this.status) return;
    const r = this.race;
    paintRace(this.canvas, r);
    this.stats.textContent = `LAP ${r.lap}/${LAPS}   ·   ${Math.round(r.speed * 3.6)} km/h   ·   TIME ${raceTime(r.elapsed)}   ·   BEST RACE ${raceTime(this.best)}`;
    this.status.textContent = r.finished ? `Finish! ${raceTime(r.elapsed)} · Best lap ${raceTime(r.bestLap)}. Press R to race again.`
      : r.paused ? 'Paused · Press P or Resume to continue.'
      : r.offroad ? 'Off track — return to the asphalt for grip and speed.'
      : r.elapsed < 2 ? 'Three laps clockwise. Accelerate and steer right into the first bend.'
      : r.lastLap ? `Last lap ${raceTime(r.lastLap)} · Best lap ${raceTime(r.bestLap)}` : 'Follow the circuit clockwise. Brake before the corners.';
    if (this.pauseButton) { this.pauseButton.textContent = r.paused ? 'Resume' : 'Pause'; this.pauseButton.disabled = r.finished; }
  }
}
