import type http from 'node:http';
import path from 'node:path';
import type { Ctx } from '../office/context.js';
import { gh } from '../github.js';
import { readBody, send } from '../http/util.js';
import { floorPlaytests, readPlaytest } from '../playtests.js';
import { completeDelivery, IssueDeliveries, type DeliveryRequest } from '../issue-delivery.js';

const busy = new WeakSet<object>();
/** Explicit completion by the existing PR/Issues coordinator. A merged reference alone is insufficient. */
export async function officeDeliver(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const id = url.searchParams.get('worker') ?? '';
  const floor = ctx.workerFloor(id);
  const worker = floor?.workers.authenticate(id, (req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  if (!floor || !worker) return send(res, 401, { error: 'Worker authentication required' });
  if (!['station-pulls', 'station-issues'].includes(worker.deskId)) return send(res, 403, { error: 'Only the PR or Issues coordinator can certify complete implementation' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (busy.has(floor)) return send(res, 409, { error: 'Another issue handoff is in progress; retry after it completes' });
  busy.add(floor);
  try {
    const value = JSON.parse(await readBody(req, 64000)) as DeliveryRequest;
    if (!Number.isSafeInteger(value?.issue) || value.issue < 1 || !Number.isSafeInteger(value?.pr) || value.pr < 1) throw new Error('Positive issue and PR numbers required');
    const owner = floor.workers.ownerOf(id);
    const as = owner ? ctx.signins.ghAs(owner) : undefined;
    if (typeof as === 'string') throw new Error(as);
    const run = (args: string[]) => gh(args, floor.dir, 30000, as?.env);
    const receipt = await completeDelivery(value, {
      issue: async () => JSON.parse(await run(['issue', 'view', String(value.issue), '--json', 'body,state,url'])),
      pull: async () => {
        const p = JSON.parse(await run(['pr', 'view', String(value.pr), '--json', 'state,headRefOid,baseRefName,url,title,mergedAt,body,statusCheckRollup']));
        const repo = JSON.parse(await run(['repo', 'view', '--json', 'defaultBranchRef,nameWithOwner']));
        const issueUrl = `https://github.com/${repo.nameWithOwner}/issues/${value.issue}`;
        return { state: p.state, head: p.headRefOid, base: p.baseRefName, defaultBranch: repo.defaultBranchRef.name, url: p.url, title: p.title, mergedAt: p.mergedAt,
          references: new RegExp(`(?:^|[\\s(])#${value.issue}(?!\\d)`).test(p.body) || p.body.includes(issueUrl),
          failedChecks: (p.statusCheckRollup ?? []).some((c: { conclusion?: string; state?: string }) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(c.conclusion ?? c.state ?? '')) };
      },
      validateTest: readPlaytest,
      saveTest: test => floorPlaytests(floor).add(test, worker.name),
      findTest: id => floorPlaytests(floor).state().items.find(test => test.id === id),
      close: async comment => { const err = await floor.github.close('issue', value.issue, { comment, reason: 'completed' }, as); if (err) throw new Error(err); },
      record: receipt => new IssueDeliveries(path.join(floor.dir, '.agent-office')).record(receipt),
    });
    floor.queue.reconcileDeliveries();
    await floor.github.refresh();
    ctx.toastFloor(floor, `Issue #${receipt.issue} closed; queue reconciled and ${receipt.tests.length} human checks handed off`);
    send(res, 200, { receipt });
  } catch (err) { send(res, 400, { error: (err as Error).message }); }
  finally { busy.delete(floor); }
}
