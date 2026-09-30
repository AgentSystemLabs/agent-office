import type http from 'node:http';
import { DESK_BY_ID } from '../../shared/layout.js';
import type { Ctx } from '../office/context.js';
import { str } from '../office/input.js';
import { readBody, send } from '../http/util.js';

/**
 * The task queue, for the board agents (see stations.ts, which tells them how): GET lists it, POST
 * adds a task, DELETE with ?task= takes a waiting one off. The agent's own hook token says who's asking.
 */
export async function officeQueue(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const agent = floor?.workers.authenticate(workerId, token);
  if (!floor || !agent) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  if (!DESK_BY_ID.get(agent.deskId)?.station) return send(res, 403, { error: 'Only the agents standing by the boards can use the queue' });
  const view = () => {
    const q = floor.queue.state();
    return {
      maxWorkers: q.maxWorkers,
      tasks: q.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, outcome: t.outcome, issue: t.issue, addedBy: t.addedBy, worker: t.workerName, branch: t.branch, pr: t.pr, error: t.error })),
    };
  };
  if (req.method === 'GET') return send(res, 200, view());
  if (req.method === 'DELETE') {
    const err = floor.queue.remove(url.searchParams.get('task') ?? '');
    return err ? send(res, 400, { error: err }) : send(res, 200, view());
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'GET, POST or DELETE' });
  let body: { prompt?: unknown; title?: unknown; issue?: unknown };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'Send JSON: {"title": "…", "prompt": "…", "issue": 12}' });
  }
  const issue = Number.isInteger(body?.issue) && (body.issue as number) > 0 ? (body.issue as number) : undefined;
  // Its tasks run as whoever the board agent runs as.
  const err = floor.queue.add(str(body?.prompt, 20000), agent.name, str(body?.title, 200) || undefined, issue, undefined, undefined, undefined, floor.workers.ownerOf(agent.id));
  if (err) return send(res, 400, { error: err });
  const task = floor.queue.state().tasks.at(-1)!;
  ctx.toastFloor(floor, `📋 The ${agent.name} queued ${issue !== undefined ? `issue #${issue}` : `“${task.title}”`}`);
  send(res, 200, { ok: true, task: { id: task.id, title: task.title, status: task.status } });
}
