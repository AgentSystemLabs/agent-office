import { ARENA, FPS, idleInput, traceShot, type FpsInput, type FpsPlayer } from '../shared/fps.js';
import type { BotOptions } from '../shared/fps-bots.js';
import { NavGrid, type Pt } from '../shared/nav.js';

export const BOT_SKILL = {
  easy: { reaction: 900, error: .07, turn: 2, interval: 450 },
  normal: { reaction: 550, error: .035, turn: 3, interval: 300 },
  hard: { reaction: 280, error: .014, turn: 5, interval: 180 },
  expert: { reaction: 160, error: .005, turn: 7, interval: 120 },
} as const;
const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
const approach = (from: number, to: number, step: number) => from + Math.max(-step, Math.min(step, to - from));
// A clear outer circuit around all cover. Each spawn connects directly to its nearest corner.
const PATROL = [{ x: -14, z: -9.5 }, { x: -14, z: 9.5 }, { x: 14, z: 9.5 }, { x: 14, z: -9.5 }];
// Reuse the office's existing route finder, adapting only the arena's cover rectangles.
const navigation = new NavGrid({ minX: -15.5, maxX: 15.5, minZ: -11.5, maxZ: 11.5 }, {
  rects: ARENA.filter(b => b.kind !== 'wall').map(b => [b.x - b.w / 2 - .05, b.x + b.w / 2 + .05, b.z - b.d / 2 - .05, b.z + b.d / 2 + .05]), circles: [],
});

/** Generates ordinary held controls: collision, ammo, reload, damage and scoring stay in FpsDuel. */
export class FpsBot {
  private visibleAt: number | null = null;
  private nextShot = 0;
  private route = -1;
  private aimError = { yaw: 0, pitch: 0 };
  private lastPosition: { x: number; z: number } | null = null;
  private strafe = 1;
  private path: Pt[] = [];

  constructor(readonly options: BotOptions, private random = Math.random) {}
  reset() { this.visibleAt = null; this.nextShot = 0; this.route = -1; this.lastPosition = null; this.path = []; this.aimError = { yaw: 0, pitch: 0 }; }

  step(bot: FpsPlayer, target: FpsPlayer, now: number, dt: number): { input: FpsInput; reload: boolean } {
    const skill = BOT_SKILL[this.options.difficulty], profile = this.options.profile;
    const distance = Math.hypot(target.x - bot.x, target.z - bot.z);
    const yaw = Math.atan2(-(target.x - bot.x), -(target.z - bot.z));
    const targetHeight = profile === 'marksman' ? 1.57 : 1.0;
    const pitch = Math.atan2(target.y + targetHeight - bot.y - FPS.eye, distance);
    const visible = target.hp > 0 && Math.abs(angle(yaw - bot.yaw)) < Math.PI * .65
      && traceShot({ ...bot, yaw, pitch }, target).hit === target.id;
    const input = { ...idleInput(), yaw: bot.yaw, pitch: bot.pitch };
    if (visible) {
      this.path = [];
      if (this.visibleAt === null) { this.visibleAt = now; this.sampleError(); }
      input.yaw = angle(bot.yaw + Math.max(-skill.turn * dt, Math.min(skill.turn * dt, angle(yaw + this.aimError.yaw - bot.yaw))));
      input.pitch = Math.max(-1.45, Math.min(1.45, approach(bot.pitch, pitch + this.aimError.pitch, skill.turn * dt)));
      if (this.lastPosition && Math.hypot(bot.x - this.lastPosition.x, bot.z - this.lastPosition.z) < .01) this.strafe *= -1;
      else if (Math.floor(now / 900) % 2 === 0) this.strafe = 1; else this.strafe = -1;
      input.side = profile === 'marksman' ? 0 : this.strafe;
      input.forward = distance > (profile === 'assault' ? 6 : 12) ? 1 : 0;
      input.walk = profile === 'marksman';
      const reaction = skill.reaction * (profile === 'marksman' ? .8 : 1);
      if (now - this.visibleAt >= reaction && now >= this.nextShot && Math.abs(angle(yaw - input.yaw)) < .13) {
        input.fire = true; this.nextShot = now + skill.interval; this.sampleError();
      }
    } else {
      // No target tracking or firing through cover: resume a patrol independent of hidden player position.
      this.visibleAt = null;
      if (this.route < 0) this.route = PATROL.reduce((best, p, i) => Math.hypot(p.x - bot.x, p.z - bot.z)
        < Math.hypot(PATROL[best].x - bot.x, PATROL[best].z - bot.z) ? i : best, 0);
      const waypoint = PATROL[this.route];
      if (Math.hypot(waypoint.x - bot.x, waypoint.z - bot.z) < .4) { this.route = (this.route + (profile === 'flanker' ? 3 : 1)) % PATROL.length; this.path = []; }
      if (!this.path.length || (this.lastPosition && Math.hypot(bot.x - this.lastPosition.x, bot.z - this.lastPosition.z) < .01)) {
        const destination = PATROL[this.route]; this.path = navigation.route([bot.x, bot.z], [destination.x, destination.z]).slice(1);
      }
      while (this.path.length > 1 && Math.hypot(this.path[0][0] - bot.x, this.path[0][1] - bot.z) < .25) this.path.shift();
      const goal = this.path[0] ?? [PATROL[this.route].x, PATROL[this.route].z];
      const routeYaw = Math.atan2(-(goal[0] - bot.x), -(goal[1] - bot.z));
      input.yaw = routeYaw; input.pitch = approach(bot.pitch, 0, dt * 3); input.forward = 1;
    }
    this.lastPosition = { x: bot.x, z: bot.z };
    return { input, reload: !bot.reloadUntil && bot.reserve > 0 && (bot.ammo === 0 || (!visible && bot.ammo < 8)) };
  }

  private sampleError() {
    const error = BOT_SKILL[this.options.difficulty].error * (this.options.profile === 'marksman' ? .65 : 1);
    this.aimError = { yaw: (this.random() * 2 - 1) * error, pitch: (this.random() * 2 - 1) * error };
  }
}
