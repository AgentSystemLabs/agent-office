import type http from 'node:http';
import { notLeaving } from '../leave-on-merge.js';
import { findWorker, readHireRequest, readHomeRequest, workerRow, type PullsView } from '../office-workers.js';
import { nextFreeSeat } from '../../shared/layout.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import { str } from '../office/input.js';
import { readBody, send } from '../http/util.js';

/**
 * The floor's workers, for any worker on it (see office-workers.ts, and bin/office-workers.js, the
 * command and MCP server that call it): GET lists them, POST hires one, POST /home sends some home
 * (its worktree and branch go too, unless they hold work), POST /tell types a prompt to one. The
 * worker's own hook token says who's asking, and the floor hears who did what, as from anyone.
 */
export async function officeWorkers(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const me = floor?.workers.authenticate(workerId, token);
  if (!floor || !me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  const who = me.name;
  const view: PullsView = { pulls: floor.github.pulls.items, tasks: floor.queue.state().tasks, pullsOf: (id) => ctx.floors.get(id)?.github.pulls.items };
  const row = (id: string) => {
    const w = floor.workers.get(id);
    return w && workerRow(w, view, me.id);
  };
  const action = url.pathname.slice('/office/workers'.length);
  if (req.method === 'GET' && !action) {
    const list = floor.workers.list();
    const free = nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing);
    return send(res, 200, {
      floor: { id: floor.id, name: floor.def.name, repo: floor.def.repo, branch: floor.project.branch },
      you: me.id,
      leaveOnMerge: ctx.leaveOnMerge.on,
      providers: floor.project.agentProviders,
      defaultProvider: floor.workers.officeDefault.provider,
      freeDesk: free?.id ?? null,
      ...(ctx.ledger.hiringPaused ? { hiringPaused: ctx.ledger.hiringPaused } : {}),
      workers: list.map((w) => workerRow(w, view, me.id)),
    });
  }
  if (req.method !== 'POST' || !['', '/home', '/tell'].includes(action)) return send(res, 405, { error: 'GET /office/workers, or POST to /office/workers, /office/workers/home or /office/workers/tell' });
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return send(res, 400, { error: 'Send JSON' });
  }

  if (action === '/home') {
    const ask = readHomeRequest(body);
    if (typeof ask === 'string') return send(res, 400, { error: ask });
    type Outcome = { worker: string; id?: string; went?: boolean; note?: string; error?: string; skipped?: string };
    const results: Outcome[] = [];
    const going: { w: WorkerInfo; why?: string }[] = [];
    if (ask.merged) {
      for (const w of floor.workers.list()) {
        const landed = floor.landed(w);
        if (!landed) continue;
        const why = landed.prs?.length ? `its pull requests merged (${landed.prs.join(', ')})` : `PR #${landed.pr} merged`;
        const staying = w.id === me.id ? "that's you" : notLeaving(w);
        if (staying) results.push({ worker: w.name, id: w.id, skipped: `${why}, but it's ${staying}` });
        else going.push({ w, why });
      }
    } else {
      for (const key of ask.workers) {
        const w = findWorker(floor.workers.list(), key);
        if (typeof w === 'string') results.push({ worker: key, error: w });
        else if (w.id === me.id) results.push({ worker: w.name, id: w.id, error: "That's you: someone else has to send you home" });
        else if (!going.some((g) => g.w === w)) going.push({ w });
      }
    }
    // One at a time: git takes a lock on the repository's refs to delete a branch.
    for (const { w, why } of going) {
      if (floor.workers.get(w.id) !== w) {
        results.push({ worker: w.name, id: w.id, skipped: 'it had already gone' });
        continue;
      }
      ctx.toastFloor(floor, why ? `🏠 ${who} sent ${w.name} home: ${why}` : `${who} sent ${w.name} home`);
      const { note, error } = await floor.sendHome(w.id, ask.cleanup);
      if (note) ctx.toastFloor(floor, note);
      if (error) ctx.toastFloor(floor, error, 'warn');
      results.push({ worker: w.name, id: w.id, went: true, ...(note ? { note } : {}), ...(error ? { error } : {}) });
    }
    return send(res, 200, { results });
  }

  if (action === '/tell') {
    const b = (body ?? {}) as { worker?: unknown; prompt?: unknown };
    const w = findWorker(floor.workers.list(), str(b.worker, 64));
    if (typeof w === 'string') return send(res, 404, { error: w });
    if (w.id === me.id) return send(res, 400, { error: "That's you" });
    // A shell would run it as a command, in someone's terminal.
    if (w.kind !== 'agent') return send(res, 400, { error: `${w.name} is a shell, not an agent` });
    const text = str(b.prompt, 20000).replace(/\r\n?/g, '\n').trim();
    if (!text) return send(res, 400, { error: 'Say what to tell it: prompt' });
    let err = floor.workers.prompt(w.id, text, who);
    // Stopped or asleep: it wakes up with this as its next message.
    if (err === 'Worker is not running') err = floor.workers.resume(w.id, text);
    if (err) return send(res, 400, { error: err });
    return send(res, 200, { ok: true, worker: row(w.id) });
  }

  const ask = readHireRequest(body, floor.project.agentProviders);
  if (typeof ask === 'string') return send(res, 400, { error: ask });
  const desk = ask.desk ?? nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing)?.id;
  if (!desk) return send(res, 409, { error: 'Every desk and bean bag is taken: send someone home first' });
  // A model or effort is the office's default worker's unless it says whose.
  const provider = ask.provider ?? (ask.model || ask.effort ? floor.workers.officeDefault.provider : undefined);
  const worktree = ask.worktree ?? !!floor.project.branch;
  // Its worktree starts from what's on GitHub now, like one hired from a desk.
  if (worktree) await floor.workers.fetchBase();
  if (!ctx.floors.has(floor.id)) return send(res, 410, { error: 'This floor closed' });
  // It runs as whoever the asking worker runs as.
  const owner = floor.workers.ownerOf(me.id);
  const r = floor.workers.spawn(desk, who, ask.prompt, worktree, 'agent', provider, ask.model, ask.effort, undefined, owner);
  if (typeof r === 'string') return send(res, 400, { error: r });
  ctx.toastFloor(floor, `${who} hired ${r.name}${ask.issue ? ` for issue #${ask.issue}` : ' with a task'}`);
  if (ask.issue) {
    const n = ask.issue;
    floor.queue.dropIssue(n);
    const as = owner ? ctx.signins.ghAs(owner) : undefined;
    if (typeof as === 'string') ctx.toastFloor(floor, `Couldn't assign issue #${n} on GitHub: ${as}`, 'warn');
    else void floor.github.claim(n, as).then((e) => e && ctx.toastFloor(floor, `Couldn't assign issue #${n} on GitHub: ${e}`, 'warn'));
  }
  send(res, 200, { ok: true, worker: row(r.id) });
}
