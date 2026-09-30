// Pull requests for a worker's branch: finding and opening them, drafting their title and body,
// and listing the pull requests of one change across repositories in each of them.
import type { WorkerInfo } from '../../shared/protocol.js';
import { DESK_BY_ID } from '../../shared/layout.js';
import { gh } from '../github.js';
import type { GhAs } from '../signins.js';
import { truncate } from './util.js';

const PR_TITLE_MAX = 72;
const PR_TASK_MAX = 2500;
/** Around the list of a change's pull requests in each of their descriptions, so it can be brought up to date. */
const RELATED_START = '<!-- agent-office:related -->';
const RELATED_END = '<!-- /agent-office:related -->';

export async function findOpenPr(branch: string, cwd: string): Promise<{ number: number; url: string } | undefined> {
  const out = await gh(['pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json', 'number,url'], cwd);
  const found = (JSON.parse(out || '[]') as { number: number; url: string }[])[0];
  return found ? { number: found.number, url: found.url } : undefined;
}

/** `gh pr create` for a pushed branch; resolves to the new pull request. */
export async function createPr(branch: string, base: string | undefined, title: string, body: string, cwd: string, as?: GhAs): Promise<{ number: number; url: string }> {
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
export function draftPr(info: WorkerInfo, commits: string[], by: string, other?: { home?: string }): { title: string; body: string } {
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
