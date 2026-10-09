// /party in the chat: the floor's own party (see the client's features/party). Kept per floor, so
// whoever arrives (or reloads) mid-party joins in; /party stop ends it; a new one can't start again
// within COOLDOWN_MS of the last, so it isn't a way to spam the floor.
import type { PartyState } from '../../../shared/protocol.js';
import type { Client } from '../../office/client.js';
import type { Ctx } from '../../office/context.js';
import type { ViewPieces } from './types.js';

/** How long a party goes on for, and how soon after one starts another can. */
const PARTY_MS = 60_000;
const COOLDOWN_MS = 15_000;

/** Each floor's party, by floor id, and when it started. */
const parties = new Map<string, PartyState & { startedAt: number }>();

/** The floor's party, for someone arriving on it: null with none on. */
export const partyView: ViewPieces['party'] = (_ctx, floor) => {
  const p = floor && parties.get(floor.id);
  return p && p.until > Date.now() ? { until: p.until, by: p.by } : null;
};

/** `text` said in the chat: if it's /party (or /party stop), starts (or ends) the floor's party, and says so. */
export function partyCommand(ctx: Ctx, c: Client, text: string): boolean {
  const m = /^\/party\b\s*(.*)$/i.exec(text.trim());
  if (!m) return false;
  const floor = ctx.floorOf(c);
  if (!floor) return true;
  const now = Date.now();
  const was = parties.get(floor.id);
  const on = !!was && was.until > now;
  // Only "/party stop" (or off) on its own ends it: "/party for the offsite" starts one.
  if (/^(stop|off)$/i.test(m[1].trim())) {
    if (!on) return true;
    parties.delete(floor.id);
    ctx.toFloor(floor, { t: 'party', until: 0, by: c.peer.name });
    return true;
  }
  if (was && now - was.startedAt < COOLDOWN_MS) return true;
  const party = { until: now + PARTY_MS, by: c.peer.name, startedAt: now };
  parties.set(floor.id, party);
  ctx.toFloor(floor, { t: 'party', until: party.until, by: party.by });
  return true;
}
