// Pull requests for a worker's branch: finding and opening them, drafting their title and body,
// and listing the pull requests of one change across repositories in each of them.
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';
import { DESK_BY_ID } from '../../shared/layout.js';
import { isBusy } from '../../shared/status.js';
import { gh } from '../github.js';
import type { GhAs } from '../signins.js';
import { Worktrees } from '../worktrees.js';
import { run } from './process.js';
import type { OpenedPr, Worker, WorkerContext } from './types.js';
import { truncate } from './util.js';
import { originRepo } from './worktree.js';

const PR_TITLE_MAX = 72;
const PR_TASK_MAX = 2500;
/** Around the list of a change's pull requests in each of their descriptions, so it can be brought up to date. */
const RELATED_START = '<!-- agent-office:related -->';
const RELATED_END = '<!-- /agent-office:related -->';

async function findOpenPr(branch: string, cwd: string): Promise<{ number: number; url: string } | undefined> {
  const out = await gh(['pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json', 'number,url'], cwd);
  const found = (JSON.parse(out || '[]') as { number: number; url: string }[])[0];
  return found ? { number: found.number, url: found.url } : undefined;
}

/** `gh pr create` for a pushed branch; resolves to the new pull request. */
async function createPr(branch: string, base: string | undefined, title: string, body: string, cwd: string, as?: GhAs): Promise<{ number: number; url: string }> {
  const out = await gh(['pr', 'create', '--head', branch, ...(base ? ['--base', base] : []), '--title', title, '--body', body], cwd, 60_000, as?.env);
  const url = out.trim().split('\n').pop() ?? '';
  const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
  if (!number) throw new Error(`gh did not return a pull request URL (${truncate(out, 120)})`);
  return { number, url };
}

/** owner/name#12 for a pull request on GitHub (which links it with its title), else its URL. */
function prRef(url: string): string {
  const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return m ? `${m[1]}#${m[2]}` : url;
}

/** The list of a change's pull requests across repositories, for the description of the one at `self`. */
export function relatedBlock(prs: { repo?: string; url: string }[], self: string, branch: string): string {
  const lines = prs.map((p) => `- ${p.repo ? `**${p.repo}**: ` : ''}${prRef(p.url)}${p.url === self ? ' (this one)' : ''}`);
  return [RELATED_START, `**One change across ${prs.length} repositories**, each on \`${branch}\`: review and merge them together.`, '', ...lines, RELATED_END].join('\n');
}

/** A description with its list of related pull requests put in, or brought up to date. */
export function withRelated(body: string, block: string): string {
  const at = body.indexOf(RELATED_START);
  const end = at < 0 ? -1 : body.indexOf(RELATED_END, at);
  if (end >= 0) return body.slice(0, at) + block + body.slice(end + RELATED_END.length);
  return body.trim() ? `${body.trimEnd()}\n\n${block}` : block;
}

/**
 * A pull request title and body from what the worker was asked to do. The title is the issue's
 * title when the task came off the issues board, else the task's first line; the body carries the
 * task, the commits, a "Closes #n" when the task asked for one, and which desk it came from. With
 * `other`, it's for one of the other repositories of a worker across repositories: the issue is its
 * own floor's (`home`), so this one only mentions it.
 */
function draftPr(info: WorkerInfo, commits: string[], by: string, other?: { home?: string }): { title: string; body: string } {
  const task = (info.prompt ?? '').replace(/\r\n?/g, '\n').trim();
  const firstLine = task.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  // The issues board hands work over as: Work on GitHub issue #12: "Title".
  const issue = /\bissue #(\d+):\s*["“](.+?)["”]\.?\s*$/i.exec(firstLine);
  const title = truncate(issue?.[2] || firstLine.replace(/[.:;,]+$/, '') || commits[0]?.replace(/^\S+\s+/, '') || info.worktree?.branch || info.name, PR_TITLE_MAX);
  const closes = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[^\n]{0,40}?#(\d+)/i.exec(task)?.[1] ?? issue?.[1];
  const parts: string[] = [];
  if (task) parts.push(`## Task\n\n${task.length > PR_TASK_MAX ? `${task.slice(0, PR_TASK_MAX)}…` : task}`);
  parts.push(`## Commits\n\n${commits.map((c) => `- \`${c.slice(0, c.indexOf(' '))}\` ${c.slice(c.indexOf(' ') + 1)}`).join('\n')}`);
  if (closes && !other) parts.push(`Closes #${closes}`);
  else if (closes && other?.home) parts.push(`Part of ${other.home}#${closes}`);
  parts.push(`_Opened from Agent Office by ${by} · ${info.name} at ${DESK_BY_ID.get(info.deskId)?.label ?? info.deskId}_`);
  return { title, body: parts.join('\n\n') };
}

/** Opening pull requests for one floor's workers (see WorkerContext). */
export class WorkerPrs {
  constructor(private ctx: WorkerContext) {}

  /**
   * Pushes a worktree worker's branch and opens a pull request for it, with a title and body
   * drafted from its task, as `as` (whoever pressed the button) or else the office. Resolves to the
   * PR, or to a message saying why there is none. The branch may already have an open PR (a second
   * press, or one opened by hand): that one is used. A worker across repositories gets one in each
   * repository it committed to (see openPrs).
   */
  async openPr(id: string, by: string, as?: GhAs): Promise<{ prs: OpenedPr[]; failed: string[] } | string> {
    const w = this.ctx.workers.get(id);
    if (!w) return 'No such worker';
    const { info } = w;
    const wt = info.worktree;
    if (!wt) return `${info.name} works in the main checkout — only workers with their own worktree can open a PR`;
    if (info.prOpening) return `${info.name}'s pull request is already being opened`;
    if (isBusy(info.status)) {
      return `${info.name} is still ${info.status === 'needs_input' ? 'waiting on input' : info.status} — wait until it's done`;
    }
    if (info.repos?.length) return this.openPrs(w, by, as);
    const cwd = path.join(this.ctx.dir, wt.path);
    if (!existsSync(cwd)) return `${info.name}'s worktree is gone (${wt.path})`;
    info.prOpening = true;
    this.ctx.emit(w);
    try {
      // The PR comes from the branch its work is on, which may be one it made itself.
      await this.ctx.syncBranch(w);
      const branch = info.worktree?.branch ?? wt.branch;
      const commits = (await run('git', ['log', '--reverse', '--format=%h %s', `${wt.base}..${branch}`], cwd)).split('\n').filter(Boolean);
      const dirty = (await run('git', ['status', '--porcelain'], cwd)) !== '';
      if (!commits.length) return dirty ? `${info.name} hasn't committed anything yet — ask it to commit first` : `${info.name} has no commits on ${branch} yet`;
      const open = await findOpenPr(branch, cwd);
      if (open) {
        info.pr = open;
        this.ctx.persist();
        return { prs: [{ ...open, existed: true, dirty }], failed: [] };
      }
      await run('git', ['push', '-u', 'origin', branch], cwd, 90_000, as?.env);
      const base = await this.pushedBranch([wt.from, this.ctx.trees.currentBranch()], branch);
      const { title, body } = draftPr(info, commits, by);
      const { number, url } = await createPr(branch, base, title, body, cwd, as);
      info.pr = { number, url };
      this.ctx.persist();
      return { prs: [{ number, url, existed: false, dirty }], failed: [] };
    } catch (err) {
      return `Couldn't open a PR for ${info.name}: ${(err as Error).message}`;
    } finally {
      info.prOpening = false;
      // The worker may have been sent home meanwhile; an update would bring it back as a ghost.
      if (this.ctx.workers.get(id) === w) this.ctx.emit(w);
    }
  }

  /**
   * 'worker.pr' for a worker across repositories: a pull request in each repository it committed to
   * (or the one its branch already has there), with every one of them listed in each one's
   * description, so they're reviewed and merged together. The issue its task came from is closed by
   * its own floor's pull request; the others only mention it.
   */
  private async openPrs(w: Worker, by: string, as?: GhAs): Promise<{ prs: OpenedPr[]; failed: string[] } | string> {
    const { info } = w;
    const wt = info.worktree!;
    const home = originRepo(this.ctx.dir);
    const parts = [
      { name: path.basename(wt.path), dir: this.ctx.dir, ...wt, pr: info.pr, own: true, set: (pr: { number: number; url: string }) => (info.pr = pr) },
      ...info.repos!.map((r) => ({ ...r, own: false, set: (pr: { number: number; url: string }) => (r.pr = pr) })),
    ];
    const gone = parts.filter((p) => !existsSync(path.join(this.ctx.dir, p.path)));
    if (gone.length) return `${info.name}'s worktree${gone.length > 1 ? 's' : ''} of ${gone.map((p) => p.name).join(', ')} ${gone.length > 1 ? 'are' : 'is'} gone`;
    info.prOpening = true;
    this.ctx.emit(w);
    const prs: (OpenedPr & { cwd: string })[] = [];
    const failed: string[] = [];
    const uncommitted: string[] = [];
    try {
      for (const p of parts) {
        const cwd = path.join(this.ctx.dir, p.path);
        try {
          const dirty = (await run('git', ['status', '--porcelain'], cwd)) !== '';
          const known = p.pr ?? (await findOpenPr(p.branch, cwd));
          if (known) {
            p.set(known);
            prs.push({ repo: p.name, ...known, existed: true, dirty, cwd });
            continue;
          }
          const commits = (await run('git', ['log', '--reverse', '--format=%h %s', `${p.base}..${p.branch}`], cwd)).split('\n').filter(Boolean);
          if (!commits.length) {
            if (dirty) uncommitted.push(p.name);
            continue;
          }
          await run('git', ['push', '-u', 'origin', p.branch], cwd, 90_000, as?.env);
          const base = await this.pushedBranch([p.from, new Worktrees(p.dir).currentBranch()], p.branch, p.dir);
          const { title, body } = draftPr(info, commits, by, p.own ? undefined : { home });
          const pr = await createPr(p.branch, base, title, body, cwd, as);
          p.set(pr);
          this.ctx.persist();
          prs.push({ repo: p.name, ...pr, existed: false, dirty, cwd });
        } catch (err) {
          failed.push(`Couldn't open a PR in ${p.name}: ${(err as Error).message}`);
        }
      }
      if (!prs.length) {
        if (failed.length) return failed.join('; ');
        return uncommitted.length ? `${info.name} hasn't committed anything yet in ${uncommitted.join(', ')} — ask it to commit first` : `${info.name} has no commits on ${wt.branch} yet in any of its repositories`;
      }
      if (prs.length > 1 && prs.some((p) => !p.existed)) {
        for (const p of prs) {
          try {
            const body = await gh(['pr', 'view', p.url, '--json', 'body', '--jq', '.body'], p.cwd, 30_000, as?.env);
            const next = withRelated(body, relatedBlock(prs, p.url, wt.branch));
            if (next !== body) await gh(['pr', 'edit', p.url, '--body', next], p.cwd, 60_000, as?.env);
          } catch (err) {
            failed.push(`Couldn't list the other pull requests on ${p.repo} #${p.number}: ${(err as Error).message}`);
          }
        }
      }
      this.ctx.persist();
      return { prs: prs.map(({ cwd: _, ...p }) => p), failed };
    } finally {
      info.prOpening = false;
      if (this.ctx.workers.get(info.id) === w) this.ctx.emit(w);
    }
  }

  /** The first of these branches that exists on origin (of `dir`'s repository), for a PR base. None: gh picks the default branch. */
  private async pushedBranch(candidates: (string | undefined)[], not: string, dir = this.ctx.dir): Promise<string | undefined> {
    for (const c of candidates) {
      if (!c || c === not) continue;
      try {
        await run('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${c}`], dir);
        return c;
      } catch {
        // not on the remote (or never fetched)
      }
    }
    return undefined;
  }
}
