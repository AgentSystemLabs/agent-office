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
import { L } from '../../i18n.js';
import { matchLocale } from '../../../shared/i18n.js';

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
  const why = now === OFFICE_MAP ? L.srv.mapWontLoad(was) : L.srv.mapLoadsAgain;
  ctx.toastAll(who ? L.srv.mapChanged(who, `${plan.icon} ${plan.name}`) : L.srv.mapIsNow(`${plan.icon} ${plan.name}`, why));
};

export const settingsHandlers = {
  'notify.webhook'(ctx, c, msg) {
    const who = c.peer.name;
    const url = str(msg.url, 4096).trim();
    const err = ctx.webhook.set(url, who);
    ctx.warn(c, err);
    if (!err) ctx.toastAll(url ? L.srv.notifyOn(who) : L.srv.notifyOff(who));
  },
  'notify.test'(ctx, c) {
    const who = c.peer.name;
    void ctx.webhook.test(who).then((err) => ctx.sendTo(c, { t: 'toast', text: err ?? L.srv.testSent, level: err ? 'warn' : 'info' }));
  },
  'machine.limit'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, L.srv.adminsLimit);
    const limit = msg.limit === null ? undefined : parseWorkerLimit(msg.limit);
    if (msg.limit !== null && limit === undefined) return ctx.warn(c, L.srv.limitRange(MAX_WORKER_LIMIT));
    const err = ctx.machine.setLimit(limit, who);
    if (err) return ctx.warn(c, err);
    const now = ctx.machine.limit;
    ctx.toastAll(limit !== undefined ? L.srv.limitSet(who, now) : now === undefined ? L.srv.limitOff(who) : L.srv.limitBack(who, now));
    ctx.pumpQueues();
  },
  'upgrade.check'(ctx) {
    void ctx.upgrader.check();
  },
  'upgrade.start'(ctx, c) {
    const who = c.peer.name;
    void ctx.upgrader.start(who).then((err) => {
      if (err) ctx.warn(c, err);
      else ctx.toastAll(L.srv.upgrading(who));
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
        ? L.srv.halloween(who)
        : msg.pick === 'christmas'
          ? L.srv.christmas(who)
          : msg.pick === 'off'
            ? L.srv.decorDown(who)
            : L.srv.decorCalendar(who, now === 'halloween' ? L.srv.seasonHalloween : now ? L.srv.seasonChristmas : undefined),
    );
  },
  'map.set'(ctx, c, msg) {
    const who = c.peer.name;
    // Someone opened the list, or picked a map: either way the folder of maps of your own is read again first.
    const was = ctx.maps.pick();
    const reloaded = ctx.maps.reload();
    if (msg.map === undefined || !ctx.maps.set(str(msg.map, 64), who)) {
      if (reloaded) mapNews(ctx, was);
      if (msg.map !== undefined) ctx.warn(c, L.srv.noMap);
      return;
    }
    mapNews(ctx, was, who);
  },
  'language.set'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, L.srv.adminsLanguage);
    const lang = matchLocale(typeof msg.lang === 'string' ? msg.lang : undefined);
    if (!lang || lang === ctx.language.state().lang) return;
    ctx.language.set(lang, who);
    ctx.toastAll(L.srv.languageSet(who));
  },
  'leaveOnMerge.set'(ctx, c, msg) {
    const who = c.peer.name;
    const on = msg.on === true;
    if (on === ctx.leaveOnMerge.on) return;
    ctx.leaveOnMerge.set(on, who);
    ctx.toastAll(on ? L.srv.leaveOn(who) : L.srv.leaveOff(who));
    // The ones already merged go now.
    if (on) for (const f of ctx.floors.values()) f.sendLandedHome();
  },
  'prompts.set'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, L.srv.adminsPrompts);
    if (!isPromptId(msg.id) || (msg.text !== null && typeof msg.text !== 'string')) return;
    const custom = !!ctx.prompts.state().custom[msg.id];
    const err = ctx.prompts.setPrompt(msg.id, msg.text === null ? null : str(msg.text, PROMPT_MAX + 1), who);
    if (err) return ctx.warn(c, err);
    const now = !!ctx.prompts.state().custom[msg.id];
    const label = L.promptMeta.prompts[msg.id]?.label ?? PROMPTS[msg.id].label;
    if (now) ctx.toastAll(L.srv.rewrote(who, label));
    else if (custom) ctx.toastAll(L.srv.promptBack(who, label));
  },
  'prompts.agent'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, L.srv.adminsWorker);
    const ch = msg.choice;
    if (ch !== null && (!ch || typeof ch !== 'object')) return;
    const choice = ch && {
      provider: ch.provider,
      model: ch.model === undefined || ch.model === '' ? undefined : str(ch.model, OPEN_CODE_MODEL_MAX + 1),
      effort: ch.effort === undefined ? undefined : ch.effort,
    };
    const err = ctx.prompts.setAgent(choice, who);
    if (err) return ctx.warn(c, err);
    ctx.toastAll(choice ? L.srv.setDefaultWorker(who) : L.srv.defaultWorkerBack(who, path.basename(ctx.cfg.agentCmd)));
  },
} satisfies HandlerMap<SettingsClientMsg>;
