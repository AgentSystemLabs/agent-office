// ⚙️ Settings: team notifications, the worker limit, upgrades, the holiday theme, the building's map,
// the office's prompts and default worker, and whether merged workers go home by themselves.
import path from 'node:path';
import { OPEN_CODE_MODEL_MAX } from '../../../shared/providers.js';
import { MAX_WORKER_LIMIT, parseWorkerLimit } from '../../machine.js';
import { OFFICE_MAP } from '../../../shared/maps/index.js';
import { isThemePick } from '../../../shared/theme.js';
import { PROMPTS, PROMPT_MAX, isPromptId } from '../../../shared/prompts.js';
import type { SettingsClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import type { HandlerMap, ViewPieces } from './types.js';

/** The floor's Services board: its own workers' web servers. */
export const servicesView: ViewPieces['services'] = (ctx, floor) => ctx.servicesState(floor);

/**
 * Tells everyone about the maps, after a pick or a read of the folder. When the map everyone's on
 * changed (`was` before), everyone's off their seats (each browser forgets them too, see the
 * client's 'map'), and hears what it is now: `who` picked it, or a map of your own broke or came back.
 */
export const mapNews = (ctx: Ctx, was: string, who?: string) => {
  const { maps } = ctx;
  const now = maps.pick();
  if (now !== was) for (const other of ctx.clients.values()) delete other.peer.seat;
  ctx.broadcast({ t: 'map', state: maps.state() });
  if (now === was) return;
  const plan = maps.plan();
  // Without a pick, a map of your own broke (back to the office) or was fixed (back to it).
  const why = now === OFFICE_MAP ? `: the map "${was}" won't load (see ⚙️ Settings)` : ': it loads again';
  ctx.toastAll(who ? `${who} changed the building's map to ${plan.icon} ${plan.name}` : `The building's map is ${plan.icon} ${plan.name} now${why}`);
};

export const settingsHandlers = {
  'notify.webhook'(ctx, c, msg) {
    const who = c.peer.name;
    const url = str(msg.url, 4096).trim();
    const err = ctx.webhook.set(url, who);
    ctx.warn(c, err);
    if (!err) ctx.toastAll(url ? `📣 ${who} set up team notifications` : `${who} turned off team notifications`);
  },
  'notify.test'(ctx, c) {
    const who = c.peer.name;
    void ctx.webhook.test(who).then((err) => ctx.sendTo(c, { t: 'toast', text: err ?? '📣 Sent a test message', level: err ? 'warn' : 'info' }));
  },
  'machine.limit'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the worker limit');
    const limit = msg.limit === null ? undefined : parseWorkerLimit(msg.limit);
    if (msg.limit !== null && limit === undefined) return ctx.warn(c, `The worker limit is a whole number from 1 to ${MAX_WORKER_LIMIT}`);
    const err = ctx.machine.setLimit(limit, who);
    if (err) return ctx.warn(c, err);
    const now = ctx.machine.limit;
    ctx.toastAll(limit !== undefined ? `⚙️ ${who} set the worker limit to ${now}` : now === undefined ? `⚙️ ${who} took the worker limit off` : `⚙️ ${who} put the worker limit back to ${now} (--max-workers)`);
    ctx.pumpQueues();
  },
  'upgrade.check'(ctx) {
    void ctx.upgrader.check();
  },
  'upgrade.start'(ctx, c) {
    const who = c.peer.name;
    void ctx.upgrader.start(who).then((err) => {
      if (err) ctx.warn(c, err);
      else ctx.toastAll(`${who} is upgrading the office — it restarts when the new version is built`);
    });
  },
  'theme.set'(ctx, c, msg) {
    const who = c.peer.name;
    if (!isThemePick(msg.pick)) return;
    if (msg.pick === ctx.themes.state().pick) return;
    ctx.themes.set(msg.pick, who);
    const now = ctx.themes.state().active;
    ctx.toastAll(
      msg.pick === 'halloween'
        ? `🎃 ${who} dressed the office up for Halloween`
        : msg.pick === 'christmas'
          ? `🎄 ${who} dressed the office up for Christmas`
          : msg.pick === 'off'
            ? `${who} took the holiday decorations down`
            : `📅 ${who} set the decorations to follow the calendar${now ? ` (it's ${now === 'halloween' ? 'Halloween 🎃' : 'Christmas 🎄'} season)` : ''}`,
    );
  },
  'sky.clock'(ctx, c, msg) {
    const real = msg.real === true;
    if (real === !!ctx.sky.state.realTime) return;
    ctx.sky.setClock(real);
    ctx.toastAll(real ? `🕰️ ${c.peer.name} put the sky on the real time of day` : `⏩ ${c.peer.name} set the sky to a whole day every hour`);
  },
  'map.set'(ctx, c, msg) {
    const who = c.peer.name;
    // Someone opened the list, or picked a map: either way the folder of maps of your own is read again first.
    const was = ctx.maps.pick();
    const reloaded = ctx.maps.reload();
    if (msg.map === undefined || !ctx.maps.set(str(msg.map, 64), who)) {
      if (reloaded) mapNews(ctx, was);
      if (msg.map !== undefined) ctx.warn(c, 'There’s no map by that name, or it won’t load: see ⚙️ Settings');
      return;
    }
    mapNews(ctx, was, who);
  },
  'leaveOnMerge.set'(ctx, c, msg) {
    const who = c.peer.name;
    const on = msg.on === true;
    if (on === ctx.leaveOnMerge.on) return;
    ctx.leaveOnMerge.set(on, who);
    ctx.toastAll(on ? `🏠 ${who} set workers to go home by themselves once their pull request merges` : `🪑 ${who} set workers whose pull request merged to stay until they're sent home`);
    // The ones already merged go now.
    if (on) for (const f of ctx.floors.values()) f.sendLandedHome();
  },
  'prompts.set'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the office’s prompts');
    if (!isPromptId(msg.id) || (msg.text !== null && typeof msg.text !== 'string')) return;
    const custom = !!ctx.prompts.state().custom[msg.id];
    const err = ctx.prompts.setPrompt(msg.id, msg.text === null ? null : str(msg.text, PROMPT_MAX + 1), who);
    if (err) return ctx.warn(c, err);
    const now = !!ctx.prompts.state().custom[msg.id];
    const { label } = PROMPTS[msg.id];
    if (now) ctx.toastAll(`📝 ${who} rewrote the “${label}” prompt`);
    else if (custom) ctx.toastAll(`📝 ${who} put the default “${label}” prompt back`);
  },
  'prompts.agent'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can pick the office’s default worker');
    const ch = msg.choice;
    if (ch !== null && (!ch || typeof ch !== 'object')) return;
    const choice = ch && {
      provider: ch.provider,
      model: ch.model === undefined || ch.model === '' ? undefined : str(ch.model, OPEN_CODE_MODEL_MAX + 1),
      effort: ch.effort === undefined ? undefined : ch.effort,
    };
    const err = ctx.prompts.setAgent(choice, who);
    if (err) return ctx.warn(c, err);
    ctx.toastAll(choice ? `🤖 ${who} set the office’s default worker` : `🤖 ${who} put the office’s default worker back to ${path.basename(ctx.cfg.agentCmd)}`);
  },
} satisfies HandlerMap<SettingsClientMsg>;
