import { FPS, idleInput, moveFps, traceShot, validInput, type FpsInput, type FpsPlayer, type FpsShot, type FpsState } from '../shared/fps.js';

/** One two-seat duel per office, driven by a server clock, never by client-reported hits or positions. */
export class FpsDuel {
  private players: FpsPlayer[] = [];
  private inputs = new Map<string, { input: FpsInput; at: number }>();
  private lastShot = new Map<string, number>();
  private phase: FpsState['phase'] = 'waiting';
  private round = 0;
  private until = 0;
  private winner: string | null = null;
  private reason = '';
  private lastTick = 0;

  state(now: number): FpsState {
    return { players: this.players.map(p => ({ ...p })), phase: this.phase, round: this.round, until: this.until, now, winner: this.winner, reason: this.reason };
  }

  join(id: string, name: string, now: number): boolean {
    if (this.players.some(p => p.id === id)) return true;
    if (this.players.length === 2) return false;
    this.players.push({ id, name, x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, hp: 100, ammo: FPS.magazine, reserve: FPS.reserve, score: 0, reloadUntil: 0, ready: false });
    this.reset(now);
    return true;
  }

  leave(id: string, now: number): boolean {
    if (!this.players.some(p => p.id === id)) return false;
    this.players = this.players.filter(p => p.id !== id);
    this.inputs.delete(id); this.lastShot.delete(id);
    this.reset(now);
    this.reason = this.players.length ? '对手已离开 · 等待新对手' : '';
    return true;
  }

  input(id: string, input: FpsInput, now: number): void {
    if (this.players.some(p => p.id === id) && validInput(input)) this.inputs.set(id, { input: { ...input }, at: now });
  }

  reload(id: string, now: number): void {
    const p = this.players.find(p => p.id === id);
    if (this.phase === 'live' && p?.hp && p.ammo < FPS.magazine && p.reserve && !p.reloadUntil) p.reloadUntil = now + FPS.reload;
  }

  rematch(id: string, now: number): void {
    if (this.phase !== 'finished') return;
    const p = this.players.find(p => p.id === id);
    if (p) p.ready = true;
    if (this.players.length === 2 && this.players.every(p => p.ready)) this.reset(now);
  }

  tick(now: number): FpsShot[] {
    const dt = this.lastTick ? Math.max(0, Math.min(.1, (now - this.lastTick) / 1000)) : .05;
    this.lastTick = now;
    if (this.phase === 'countdown' && now >= this.until) { this.phase = 'live'; this.until = now + FPS.round; }
    if (this.phase === 'intermission' && now >= this.until) this.startRound(now);
    if (this.phase !== 'live') return [];
    if (now >= this.until) { this.endRound(null, '时间到 · 平局', now); return []; }
    // Both players move before either shoots. A stale input releases all held controls.
    for (const p of this.players) {
      const sample = this.inputs.get(p.id);
      if (sample && now - sample.at < 250) moveFps(p, sample.input, dt);
      else moveFps(p, { ...idleInput(), yaw: p.yaw, pitch: p.pitch }, dt);
      if (p.reloadUntil && now >= p.reloadUntil) {
        const rounds = Math.min(FPS.magazine - p.ammo, p.reserve);
        p.ammo += rounds; p.reserve -= rounds; p.reloadUntil = 0;
      }
    }
    const shots: FpsShot[] = [];
    for (const p of this.players) {
      const sample = this.inputs.get(p.id);
      if (!p.hp || !sample || now - sample.at >= 250 || !sample.input.fire || !p.ammo || p.reloadUntil || now - (this.lastShot.get(p.id) ?? -Infinity) < FPS.shot) continue;
      p.ammo--; this.lastShot.set(p.id, now);
      const opponent = this.players.find(o => o.id !== p.id);
      const shot = traceShot(p, opponent); shots.push(shot);
      if (shot.hit && opponent) {
        opponent.hp = Math.max(0, opponent.hp - (shot.headshot ? 100 : 34));
        if (!opponent.hp) { this.endRound(p.id, shot.headshot ? '爆头' : '击杀', now); break; }
      }
    }
    return shots;
  }

  private reset(now: number) {
    this.round = 0; this.winner = null; this.reason = ''; this.lastTick = now;
    for (const p of this.players) { p.score = 0; p.ready = false; }
    this.startRound(now);
  }

  private startRound(now: number) {
    this.round++; this.winner = null; this.reason = ''; this.inputs.clear(); this.lastShot.clear();
    const reverse = this.round % 2 === 0;
    this.players.forEach((p, i) => {
      const north = (i === 0) !== reverse;
      Object.assign(p, { x: north ? -11 : 11, z: north ? 9 : -9, y: 0, vy: 0, yaw: north ? 0 : Math.PI, pitch: 0, hp: 100, ammo: FPS.magazine, reserve: FPS.reserve, reloadUntil: 0 });
    });
    this.phase = this.players.length === 2 ? 'countdown' : 'waiting';
    this.until = this.phase === 'countdown' ? now + 3000 : 0;
    if (this.phase === 'waiting') this.round = 0;
  }

  private endRound(winner: string | null, reason: string, now: number) {
    this.winner = winner; this.reason = reason; this.inputs.clear();
    const p = this.players.find(p => p.id === winner);
    if (p) p.score++;
    this.phase = p && p.score >= FPS.wins ? 'finished' : 'intermission';
    this.until = this.phase === 'finished' ? 0 : now + 3500;
  }
}
