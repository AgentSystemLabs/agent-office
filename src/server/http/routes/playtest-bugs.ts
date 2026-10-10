import { floorPlaytests, PlaytestError } from '../../playtests.js';
import { bugDescription, playtestBugPrompt, sendBugReport } from '../../playtest-bugs.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const playtestBugRoute: Route = {
  path: '/api/playtests/bug', method: 'POST', auth: 'session',
  async handle(ctx, { req, res, url, session }) {
    if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    const floor = floorParam(ctx, url);
    if (!floor) return send(res, 404, { error: 'No such floor' });
    try {
      const body = JSON.parse(await readBody(req, 16000));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PlaytestError('Expected a bug report');
      const description = bugDescription(body.description);
      if (typeof body.reportId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.reportId)) throw new PlaytestError('Invalid report ID');
      if (typeof body.notes !== 'string' || body.notes.length > 6000) throw new PlaytestError('Invalid notes');
      const test = floorPlaytests(floor).state().items.find(t => t.id === body.id);
      if (!test) throw new PlaytestError('Test not found', 404);
      if (body.revision !== test.revision) throw new PlaytestError('The test changed. Refresh before reporting it.', 409);
      const owner = session.account?.id;
      const agent = floor.workers.list().find(w => w.deskId === 'station-issues');
      const signIn = ctx.claudeFor(agent?.provider ?? floor.workers.officeDefault.provider);
      if (owner && signIn && !ctx.signins.claudeReady(owner)) {
        await ctx.signins.look(owner, true);
        if (!ctx.signins.claudeReady(owner)) throw new PlaytestError('Sign in to the Issue agent’s provider under Your sign-ins, then retry.', 403);
      }
      const actor = session.account?.name ?? 'Office user';
      const prompt = playtestBugPrompt(test, description, body.notes, actor, body.reportId);
      if (prompt.length > 20000) throw new PlaytestError('The combined report is too long. Shorten the tester notes or description.');
      const result = sendBugReport(floor.dir, `${owner ?? 'shared'}:${body.reportId}`, () => {
        const r = floor.workers.station('station-issues', actor, prompt, owner);
        return typeof r === 'string' ? r : undefined;
      });
      return send(res, 200, { sent: true, ...result });
    } catch (err) {
      const status = err instanceof PlaytestError ? err.status : err instanceof SyntaxError ? 400 : 500;
      return send(res, status, { error: status === 500 ? 'Could not save the bug report. Your test and notes are preserved.' : (err as Error).message });
    }
  },
};
