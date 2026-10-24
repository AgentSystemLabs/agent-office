// Hiring the reels crew onto a floor: a worker for each role a series has nobody in, each with its
// brief. Asked for by an agent (endpoint.ts) or a person on the studio's page (http/routes/reels.ts).

import { nextFreeSeat } from '../../shared/layout.js';
import { isAgentEffort, isAgentProvider } from '../../shared/protocol.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { str } from '../office/input.js';
import { crewBrief } from './crew.js';
import { studioOf } from './index.js';
import { CREW_ROLES, type CrewRole } from './types.js';

export interface HireResult {
  status: number;
  body: { hired?: { role: string; name: string; id: string }[]; skipped?: string[]; error?: string };
}

/**
 * Hires the roles `body.roles` asks for (all four by default) on `floor`, for `body.series` or every
 * series, as `who`; they run as `owner`, the account whoever asked runs as.
 */
export function hireCrew(ctx: Ctx, floor: Floor, who: string, owner: string | undefined, body: Record<string, unknown>): HireResult {
  const studio = studioOf(ctx);
  const roles = Array.isArray(body.roles) && body.roles.length ? body.roles : [...CREW_ROLES];
  const bad = roles.find((r) => !CREW_ROLES.includes(r as CrewRole));
  if (bad !== undefined) return { status: 400, body: { error: `roles are ${CREW_ROLES.join(', ')} (got ${String(bad)})` } };
  const series = body.series ? studio.store.series(str(body.series, 64)) : undefined;
  if (body.series && !series) return { status: 404, body: { error: `No series ${String(body.series)}` } };
  if (ctx.ledger.hiringPaused) return { status: 409, body: { error: `Hiring is paused: ${ctx.ledger.hiringPaused}` } };
  const provider = isAgentProvider(body.provider) ? body.provider : undefined;
  const model = str(body.model, 120).trim() || undefined;
  const effort = isAgentEffort(body.effort) ? body.effort : undefined;
  const hired: { role: string; name: string; id: string }[] = [];
  const skipped: string[] = [];
  for (const role of roles as CrewRole[]) {
    const there = studio.crewOf(role, series?.id);
    if (there && floor.workers.get(there.workerId)) {
      skipped.push(`${role}: ${there.name} already is`);
      continue;
    }
    const desk = nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing)?.id;
    if (!desk) {
      skipped.push(`${role}: no desk free`);
      continue;
    }
    // No worktree: the crew writes to the studio, never to the floor's code.
    const w = floor.workers.spawn(desk, who, crewBrief(role, series), false, 'agent', provider ?? (model || effort ? floor.workers.officeDefault.provider : undefined), model, effort, undefined, owner);
    if (typeof w === 'string') {
      skipped.push(`${role}: ${w}`);
      continue;
    }
    studio.addCrew({ role, workerId: w.id, floorId: floor.id, name: w.name, hiredAt: Date.now(), ...(series ? { seriesId: series.id } : {}) });
    hired.push({ role, name: w.name, id: w.id });
  }
  if (hired.length) ctx.toastFloor(floor, `🎬 ${who} hired the reels crew${series ? ` for “${series.name}”` : ''}: ${hired.map((h) => `${h.name} (${h.role})`).join(', ')}`);
  if (!hired.length && skipped.length) return { status: 409, body: { hired, skipped, error: skipped.join('; ') } };
  return { status: 200, body: { hired, skipped } };
}
