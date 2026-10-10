import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gh } from '../../github.js';
import { floorPlaytests, PlaytestError } from '../../playtests.js';
import { previewIssue, transferIssue } from '../../playtest-triage.js';
import type { TriageIssue } from '../../../shared/playtest-triage.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const playtestTriageRoute: Route = {
  path: '/api/playtests/triage', auth: 'session',
  async handle(ctx, { req, res, url, session }) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
    if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    const floor = floorParam(ctx, url);
    if (!floor) return send(res, 404, { error: 'No such floor' });
    try {
      const as = session.account ? ctx.signins.ghAs(session.account.id) : undefined;
      if (typeof as === 'string') throw new PlaytestError(as, 403);
      const run = (args: string[]) => gh(args, floor.dir, 60000, as?.env);
      const normalize = (v: any): TriageIssue => ({ number: v.number, title: v.title, body: v.body ?? '', url: v.html_url ?? v.url, updatedAt: v.updated_at ?? v.updatedAt, state: String(v.state).toUpperCase() });
      const read = async (n: number) => normalize(JSON.parse(await run(['api', `repos/{owner}/{repo}/issues/${n}`])));
      const body = JSON.parse(await readBody(req, 8000));
      if (body.action === 'scan') {
        const pages = JSON.parse(await run(['api', 'repos/{owner}/{repo}/issues?state=open&per_page=100', '--paginate', '--slurp']));
        const issues: TriageIssue[] = pages.flat().filter((i: any) => !i.pull_request).map(normalize);
        return send(res, 200, { scanned: issues.length, proposals: issues.map(previewIssue).filter(Boolean) });
      }
      if (body.action !== 'apply' || !Number.isSafeInteger(body.number) || body.number < 1 || typeof body.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.fingerprint)) throw new PlaytestError('Invalid transfer');
      if (floor.queue.state().tasks.some(t => t.issue === body.number && t.status === 'running')) throw new PlaytestError('Ein Worker bearbeitet dieses Issue gerade. Übertragung erst nach Abschluss oder bewusstem Stoppen.', 409);
      const result = await transferIssue(path.join(floor.dir, '.agent-office'), body.number, body.fingerprint, floorPlaytests(floor), {
        read,
        async patch(n, text, close) {
          const dir = mkdtempSync(path.join(tmpdir(), 'office-playtest-'));
          try {
            const file = path.join(dir, 'patch.json');
            writeFileSync(file, JSON.stringify({ body: text, ...(close ? { state: 'closed', state_reason: 'completed' } : {}) }));
            await run(['api', '--method', 'PATCH', `repos/{owner}/{repo}/issues/${n}`, '--input', file]);
          } finally { rmSync(path.join(dir, 'patch.json'), { force: true }); rmdirSync(dir); }
        },
      }, session.account?.name ?? 'Office user');
      if (result.close) while (floor.queue.dropIssue(body.number)) { /* Remove duplicate waiting entries too. */ }
      void floor.github.refresh();
      return send(res, 200, { number: body.number, closed: result.close, tests: result.tests, state: floorPlaytests(floor).state() });
    } catch (err) {
      return send(res, err instanceof PlaytestError ? err.status : err instanceof SyntaxError ? 400 : 502, { error: (err as Error).message });
    }
  },
};
