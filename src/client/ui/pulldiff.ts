import type { GhReviewComment } from '../../shared/protocol';
import { h, timeAgo } from './dom';
import { markdown } from './markdown';

// A PR's unified diff (`gh pr diff`), split into files, and the pieces the Files tab draws with it:
// each file's lines with inline review comments, the file list/tree, and which files you've reviewed.

export interface DiffLine {
  kind: 'ctx' | 'add' | 'del' | 'hunk' | 'note';
  text: string;
  old?: number;
  new?: number;
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'A' | 'D' | 'M' | 'R';
  binary: boolean;
  additions: number;
  deletions: number;
  lines: DiffLine[];
  /** Fingerprint of the file's changes, so a review mark can tell when the file changed since. */
  hash: string;
}

/** FNV-1a, enough to notice that a file's changes are different. */
function fnv(s: string): string {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193);
  return (x >>> 0).toString(36);
}

/** `a/src/x.ts` or `"a/odd name.ts"` → `src/x.ts` */
function unprefix(p: string): string {
  const q = p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\(["\\])/g, '$1') : p;
  return q.replace(/^[ab]\//, '');
}

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let f: DiffFile | null = null;
  let changes: string[] = [];
  let inHunk = false;
  let o = 0;
  let n = 0;
  const finish = () => {
    if (!f) return;
    // Only the changed lines count, so a rebase that just moves them doesn't undo your review.
    f.hash = fnv(`${f.path}\n${changes.join('\n')}`);
    files.push(f);
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      finish();
      const m = /^diff --git ("?a\/.+"?) ("?b\/.+"?)$/.exec(line);
      f = { path: m ? unprefix(m[2]) : line.slice(11), oldPath: undefined, status: 'M', binary: false, additions: 0, deletions: 0, lines: [], hash: '' };
      changes = [];
      inHunk = false;
      continue;
    }
    if (!f) continue;
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        o = Number(m[1]);
        n = Number(m[2]);
        inHunk = true;
        f.lines.push({ kind: 'hunk', text: line });
        continue;
      }
    }
    if (!inHunk) {
      if (line.startsWith('new file mode')) f.status = 'A';
      else if (line.startsWith('deleted file mode')) f.status = 'D';
      else if (line.startsWith('rename from ')) {
        f.oldPath = line.slice(12);
        f.status = 'R';
      } else if (line.startsWith('rename to ')) f.path = line.slice(10);
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') f.binary = true;
      else if (line.startsWith('+++ ') && line !== '+++ /dev/null') f.path = unprefix(line.slice(4));
      continue;
    }
    const c = line[0];
    if (c === '+') {
      f.lines.push({ kind: 'add', text: line.slice(1), new: n++ });
      f.additions++;
      changes.push(line);
    } else if (c === '-') {
      f.lines.push({ kind: 'del', text: line.slice(1), old: o++ });
      f.deletions++;
      changes.push(line);
    } else if (c === ' ') f.lines.push({ kind: 'ctx', text: line.slice(1), old: o++, new: n++ });
    else if (c === '\\') f.lines.push({ kind: 'note', text: line.slice(2) });
  }
  finish();
  return files;
}

// ---- Which files you've reviewed, per PR, kept in this browser --------------------------------

const REVIEWED_KEY = 'agent-office.reviewed';
const KEEP_PRS = 60;

type ReviewedStore = Record<string, { at: number; files: Record<string, string> }>;

function loadReviewed(): ReviewedStore {
  try {
    const v = JSON.parse(localStorage.getItem(REVIEWED_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export type ReviewMark = 'none' | 'reviewed' | 'stale';

/** Your review marks for one PR (keyed by its URL): reviewed, or reviewed but changed since. */
export class Reviewed {
  private files: Record<string, string>;

  constructor(private pr: string) {
    this.files = { ...(loadReviewed()[pr]?.files ?? {}) };
  }

  mark(f: DiffFile): ReviewMark {
    const h = this.files[f.path];
    return h === undefined ? 'none' : h === f.hash ? 'reviewed' : 'stale';
  }

  set(f: DiffFile, on: boolean) {
    if (on) this.files[f.path] = f.hash;
    else delete this.files[f.path];
    const all = loadReviewed();
    if (Object.keys(this.files).length) all[this.pr] = { at: Date.now(), files: this.files };
    else delete all[this.pr];
    // Forget the PRs looked at longest ago.
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
    for (const k of keys.slice(KEEP_PRS)) delete all[k];
    try {
      localStorage.setItem(REVIEWED_KEY, JSON.stringify(all));
    } catch {
      // storage blocked or full: the mark lasts until the window closes
    }
  }
}

// ---- Drawing a file's diff ------------------------------------------------------------------------

export const STATUS_WORD: Record<DiffFile['status'], string> = { A: 'added', D: 'deleted', M: 'modified', R: 'renamed' };

/** Lock files and build output: collapsed until asked for, like GitHub does. */
export function looksGenerated(path: string): boolean {
  return /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|go\.sum)$|\.min\.(js|css)$|\.snap$|(^|\/)dist\//.test(path);
}

/** A line comment and its replies. */
export function renderThread(root: GhReviewComment, replies: Map<number, GhReviewComment[]>, itemUrl: string): HTMLElement {
  const all = [root, ...(replies.get(root.id) ?? [])];
  return h(
    'div.pd-thread',
    {},
    ...all.map((c) =>
      h(
        'div.pd-comment',
        {},
        h('div.pd-comment-head', {}, h('b', {}, c.author), h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer', title: new Date(c.createdAt).toLocaleString() }, timeAgo(c.createdAt))),
        markdown(c.body, itemUrl),
      ),
    ),
  );
}

/** Line comments on this file that are still on a line, keyed "RIGHT:12" / "LEFT:7". */
export function threadsByLine(comments: GhReviewComment[], path: string): Map<string, GhReviewComment[]> {
  const out = new Map<string, GhReviewComment[]>();
  for (const c of comments) {
    if (c.replyTo || c.path !== path || c.line == null) continue;
    const k = `${c.side}:${c.line}`;
    out.set(k, [...(out.get(k) ?? []), c]);
  }
  return out;
}

export function repliesOf(comments: GhReviewComment[]): Map<number, GhReviewComment[]> {
  const out = new Map<number, GhReviewComment[]>();
  for (const c of comments) if (c.replyTo) out.set(c.replyTo, [...(out.get(c.replyTo) ?? []), c]);
  return out;
}

/** The lines of one file's diff, with its line comments under the lines they're on. */
export function renderFileDiff(f: DiffFile, comments: GhReviewComment[], itemUrl: string): HTMLElement {
  const out = h('div.pd-lines');
  if (f.binary) {
    out.append(h('div.pd-note', {}, 'Binary file — not shown.'));
    return out;
  }
  if (!f.lines.length) {
    out.append(h('div.pd-note', {}, f.status === 'R' ? 'Renamed without changes.' : 'No changes to show (file mode or empty file).'));
    return out;
  }
  const threads = threadsByLine(comments, f.path);
  const replies = repliesOf(comments);
  for (const l of f.lines) {
    if (l.kind === 'hunk') {
      out.append(h('div.pd-l.hunk', {}, h('span.pd-n'), h('span.pd-n'), h('span.pd-code', {}, l.text)));
      continue;
    }
    if (l.kind === 'note') {
      out.append(h('div.pd-l.note', {}, h('span.pd-n'), h('span.pd-n'), h('span.pd-code', {}, l.text)));
      continue;
    }
    const sign = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ';
    const row = h('div.pd-l', { class: l.kind }, h('span.pd-n', {}, l.old ?? ''), h('span.pd-n', {}, l.new ?? ''), h('span.pd-code', { 'data-sign': sign }, l.text));
    if (l.new !== undefined) row.dataset.new = String(l.new);
    if (l.old !== undefined) row.dataset.old = String(l.old);
    out.append(row);
    const here = [...(l.new !== undefined ? (threads.get(`RIGHT:${l.new}`) ?? []) : []), ...(l.old !== undefined && l.kind !== 'ctx' ? (threads.get(`LEFT:${l.old}`) ?? []) : [])];
    for (const c of here) out.append(renderThread(c, replies, itemUrl));
  }
  return out;
}

// ---- The file list as a folder tree --------------------------------------------------------------

export interface TreeDir {
  name: string;
  path: string;
  dirs: TreeDir[];
  files: DiffFile[];
}

/** Folders with their files, single-child folder chains squashed ("src/client/ui"), like GitHub. */
export function buildTree(files: DiffFile[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: [], files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let d = root;
    for (const part of parts.slice(0, -1)) {
      const p = d.path ? `${d.path}/${part}` : part;
      let next = d.dirs.find((x) => x.name === part && x.path === p);
      if (!next) d.dirs.push((next = { name: part, path: p, dirs: [], files: [] }));
      d = next;
    }
    d.files.push(f);
  }
  const squash = (d: TreeDir): TreeDir => {
    d.dirs = d.dirs.map(squash);
    while (d.dirs.length === 1 && !d.files.length && d.path) {
      const only = d.dirs[0];
      d = { name: `${d.name}/${only.name}`, path: only.path, dirs: only.dirs, files: only.files };
    }
    d.dirs.sort((a, b) => a.name.localeCompare(b.name));
    d.files.sort((a, b) => a.path.localeCompare(b.path));
    return d;
  };
  return squash(root);
}

/** Files in the order the tree shows them, so the diff pane matches the sidebar. */
export function treeOrder(d: TreeDir): DiffFile[] {
  return [...d.dirs.flatMap(treeOrder), ...d.files];
}
