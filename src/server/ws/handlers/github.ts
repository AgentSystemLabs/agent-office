// The floor's GitHub boards: refreshing them, and merging, commenting on, closing and labeling
// issues and pull requests, as whoever asks (see withGitHub).
import type { GitHubClientMsg } from '../../../shared/protocol.js';
import { GH_COMMENT_MAX, GH_LABEL_MAX } from '../../../shared/protocol.js';
import { num, str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';
import { L } from '../../i18n.js';

export const issuesView: ViewPieces['issues'] = (_ctx, floor) => floor?.github.issues ?? { items: [], fetchedAt: 0, loading: false };
export const pullsView: ViewPieces['pulls'] = (_ctx, floor) => floor?.github.pulls ?? { items: [], fetchedAt: 0, loading: false };

export const githubHandlers = {
  'gh.refresh'(ctx, c) {
    void ctx.floorOf(c)?.github.refresh();
  },
  'gh.merge'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    const method = (['squash', 'merge', 'rebase'] as const).find((m) => m === msg.method);
    if (!floor || !Number.isSafeInteger(n) || n <= 0 || !method) return;
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.merge(n, method, msg.deleteBranch === true, msg.auto === true, as).then((error) => {
          ctx.sendTo(c, { t: 'gh.merged', number: n, error });
          if (error) return;
          ctx.toastFloor(floor, msg.auto ? L.srv.autoMerge(who, n) : L.srv.merged(who, n));
          // An auto-merge rings once GitHub gets round to it and the boards see it merged.
          if (!msg.auto) floor.merged(n, who);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.merged', number: n, error }),
    );
  },
  'gh.comment'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    const kind = msg.kind === 'pull' ? 'pull' : 'issue';
    if (!floor || !Number.isSafeInteger(n) || n <= 0) return;
    const body = typeof msg.body === 'string' ? msg.body : '';
    // Refused rather than cut short: a comment that silently lost its end would read as finished.
    const invalid = !body.trim() ? L.srv.emptyComment : body.length > GH_COMMENT_MAX ? L.srv.commentTooLong(GH_COMMENT_MAX) : '';
    if (invalid) {
      ctx.sendTo(c, { t: 'gh.commented', kind, number: n, error: invalid });
      return;
    }
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.comment(kind, n, body, as).then((r) => {
          ctx.sendTo(c, { t: 'gh.commented', kind, number: n, ...r });
          if (r.comment) ctx.toastFloor(floor, L.srv.commented(who, kind === 'pull', n));
        }),
      (error) => ctx.sendTo(c, { t: 'gh.commented', kind, number: n, error }),
    );
  },
  'gh.close'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    const kind = msg.kind === 'issue' || msg.kind === 'pull' ? msg.kind : undefined;
    if (!floor || !Number.isSafeInteger(n) || n <= 0 || !kind) return;
    const reason = msg.reason === 'not planned' ? 'not planned' : 'completed';
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.close(kind, n, { comment: str(msg.comment, 20000).trim() || undefined, reason, deleteBranch: msg.deleteBranch === true }, as).then((error) => {
          ctx.sendTo(c, { t: 'gh.closed', kind, number: n, error });
          if (error) return;
          if (kind === 'pull') return ctx.toastFloor(floor, L.srv.closedPr(who, n));
          // Nobody should be seated for an issue that's closed.
          const dropped = floor.queue.dropIssue(n);
          ctx.toastFloor(floor, L.srv.closedIssue(who, n, reason === 'not planned', !!dropped));
        }),
      (error) => ctx.sendTo(c, { t: 'gh.closed', kind, number: n, error }),
    );
  },
  'gh.labels'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    const kind = msg.kind === 'issue' || msg.kind === 'pull' ? msg.kind : undefined;
    if (!floor || !Number.isSafeInteger(n) || n <= 0 || !kind) return;
    const names = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((l) => str(l, GH_LABEL_MAX + 1)).filter((l) => l && l.length <= GH_LABEL_MAX))].slice(0, 100);
    const add = names(msg.add);
    const remove = names(msg.remove).filter((l) => !add.includes(l));
    if (!add.length && !remove.length) {
      ctx.sendTo(c, { t: 'gh.labeled', kind, number: n, error: L.srv.noLabels });
      return;
    }
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.setLabels(kind, n, add, remove, as).then((r) => {
          ctx.sendTo(c, { t: 'gh.labeled', kind, number: n, ...r });
          if (r.labels) ctx.toastFloor(floor, `🏷️ ${who} labeled ${kind === 'pull' ? 'PR' : 'issue'} #${n}: ${[...add.map((l) => `+${l}`), ...remove.map((l) => `−${l}`)].join(' ')}`);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.labeled', kind, number: n, error }),
    );
  },
} satisfies HandlerMap<GitHubClientMsg>;
