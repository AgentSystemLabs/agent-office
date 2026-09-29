import type { GhCheck, GhCloseReason, GhComment, GhIssue, GhIssueDetail, GhLabel, GhMergeMethod, GhPull, GhPullDetail, GhReviewComment, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { AVATAR_COLORS, store, workerForPull } from '../state';
import { issuePrompt, issueVars, type BoardActions } from './boards';
import { issueMeeting } from './meeting';
import { officePrompt } from './prompts';
import { h, openModal, timeAgo, type Modal } from './dom';
import { markdown, repoUrlOf } from './markdown';
import { buildTree, looksGenerated, parseDiff, renderFileDiff, renderThread, repliesOf, Reviewed, STATUS_WORD, treeOrder, type DiffFile, type TreeDir } from './pulldiff';
import { providerPicker } from './provider';

// The windows behind the board cards. A PR opens on its conversation (description, comments,
// reviews, line comments, checks) with a Files tab for the diff, where you tick files off as
// reviewed; from here you comment, label, merge or close it, or hand it to a worker to review, fix up and merge.

/** The board windows ask about the floor you're on. */
function onFloor(url: string): string {
  return store.floor ? `${url}${url.includes('?') ? '&' : '?'}floor=${encodeURIComponent(store.floor)}` : url;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(onFloor(url), { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

async function getText(url: string): Promise<string> {
  const r = await fetch(onFloor(url), { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.text();
}

const mergeWaiters = new Map<number, (msg: Extract<ServerMsg, { t: 'gh.merged' }>) => void>();
const commentWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'gh.commented' }>) => void>();
/** Open close dialogs, by "issue:N" or "pull:N". */
const closeWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'gh.closed' }>) => void>();
/** Open label pickers, by "issue:N" or "pull:N". */
const labelWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'gh.labeled' }>) => void>();

/** Main feeds server messages through here so an open merge, close or label dialog or comment box hears back. */
export function routePullMessage(msg: ServerMsg) {
  if (msg.t === 'gh.merged') mergeWaiters.get(msg.number)?.(msg);
  if (msg.t === 'gh.commented') commentWaiters.get(`${msg.kind}#${msg.number}`)?.(msg);
  if (msg.t === 'gh.closed') closeWaiters.get(`${msg.kind}:${msg.number}`)?.(msg);
  if (msg.t === 'gh.labeled') labelWaiters.get(`${msg.kind}:${msg.number}`)?.(msg);
}

function pref<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // storage blocked
  }
}

const MERGE_KEY = 'agent-office.merge';
const FILES_KEY = 'agent-office.pr-files';
const TAB_KEY = 'agent-office.pr-tab';
/** Followed by the issue or PR's URL: the comment you were writing there. */
const DRAFT_KEY = 'agent-office.comment:';

interface MergePref {
  method?: GhMergeMethod;
  deleteBranch?: boolean;
}

const METHOD_LABEL: Record<GhMergeMethod, string> = { squash: 'Squash and merge', merge: 'Create a merge commit', rebase: 'Rebase and merge' };

function mergePref(methods: GhMergeMethod[]): { method: GhMergeMethod; deleteBranch: boolean } {
  const p = pref<MergePref>(MERGE_KEY, {});
  return { method: p.method && methods.includes(p.method) ? p.method : methods[0], deleteBranch: p.deleteBranch ?? true };
}

/** owner/repo from a PR or issue URL. */
function nameWithOwner(url: string): string {
  return repoUrlOf(url).replace(/^https?:\/\/[^/]+\//, '');
}

// ---- Small pieces ---------------------------------------------------------------------------------

/** A GitHub label in its own color, with text that stays readable on dark ones. */
export function labelChip(l: GhLabel) {
  const n = parseInt(l.color.slice(1), 16);
  const lum = Number.isNaN(n) ? 1 : (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return h('span.label', { style: `background:${l.color};color:${lum < 0.55 ? '#fff' : 'var(--ink)'}` }, l.name);
}

function avatar(name: string) {
  let x = 0;
  for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) | 0;
  return h('span.gh-avatar', { style: `background:${AVATAR_COLORS[Math.abs(x) % AVATAR_COLORS.length]}`, 'aria-hidden': 'true' }, (name[0] ?? '?').toUpperCase());
}

function when(iso: string, url?: string) {
  const title = iso ? new Date(iso).toLocaleString() : '';
  return url ? h('a.when', { href: url, target: '_blank', rel: 'noopener noreferrer', title }, timeAgo(iso)) : h('span.when', { title }, timeAgo(iso));
}

const REVIEW_BADGE: Record<string, [string, string]> = {
  APPROVED: ['✅ approved', 'ok'],
  CHANGES_REQUESTED: ['🛠 requested changes', 'bad'],
  COMMENTED: ['💬 reviewed', ''],
  DISMISSED: ['review dismissed', 'muted'],
};

function commentCard(c: GhComment, itemUrl: string, verb: string, badge?: [string, string]) {
  return h(
    'article.gh-card',
    { class: badge?.[1] ? `is-${badge[1]}` : '' },
    h('header', {}, avatar(c.author), h('b', {}, c.author), h('span', {}, verb), when(c.createdAt, c.url), badge ? h('span.gh-badge', { class: badge[1] }, badge[0]) : null),
    c.body.trim() || !badge ? markdown(c.body, itemUrl) : null,
  );
}

/** Drops the nulls of optional pieces, for replaceChildren. */
function nodes(...xs: (Node | string | null | undefined)[]): (Node | string)[] {
  return xs.filter((x): x is Node | string => x != null);
}

function spinnerRow(text: string) {
  return h('div.gh-loading', {}, h('span.spinner'), text);
}

function errorBox(text: string, retry?: () => void) {
  return h('div.gh-error', {}, `Couldn't load from GitHub: ${text}`, retry ? h('button.btn', { type: 'button', onclick: retry }, 'Try again') : null);
}

const CHECK_ICON: Record<GhCheck['state'], string> = { pass: '✅', fail: '❌', pending: '🟡', skip: '⚪' };

function stateOf(it: { state: string; isDraft?: boolean }): [string, string] {
  if (it.state === 'MERGED') return ['merged', 'merged'];
  if (it.state === 'CLOSED') return ['closed', 'offline'];
  return it.isDraft ? ['draft', 'idle'] : ['open', 'working'];
}

// ---- Whether a PR can merge ---------------------------------------------------------------------

interface MergeStatus {
  icon: string;
  text: string;
  cls: 'ok' | 'warn' | 'bad' | 'muted';
  /** False when merging can't work at all (draft, conflicts, already merged). */
  can: boolean;
  /** GitHub could merge it on its own once the requirements pass. */
  auto: boolean;
}

/** An open PR whose branch can't merge until someone resolves conflicts with the base. */
function conflicted(d: GhPullDetail) {
  return d.state === 'OPEN' && !d.isDraft && (d.mergeable === 'CONFLICTING' || d.mergeStateStatus === 'DIRTY');
}

function mergeStatus(d: GhPullDetail): MergeStatus {
  const failing = d.checks.filter((c) => c.state === 'fail').length;
  const pending = d.checks.filter((c) => c.state === 'pending').length;
  if (d.state === 'MERGED') return { icon: '🎉', text: 'Merged.', cls: 'ok', can: false, auto: false };
  if (d.state === 'CLOSED') return { icon: '🗑️', text: 'Closed without merging.', cls: 'muted', can: false, auto: false };
  if (d.isDraft) return { icon: '📝', text: 'This is still a draft. Mark it ready for review on GitHub before merging.', cls: 'muted', can: false, auto: false };
  if (conflicted(d))
    return { icon: '⚠️', text: `This branch has conflicts with ${d.baseRefName} that must be resolved first.`, cls: 'bad', can: false, auto: false };
  if (d.mergeStateStatus === 'BEHIND') return { icon: '⤵️', text: `The branch is behind ${d.baseRefName}, and this repo wants it up to date before merging.`, cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'BLOCKED') {
    const why = d.reviewDecision === 'CHANGES_REQUESTED' ? 'changes were requested' : d.reviewDecision === 'REVIEW_REQUIRED' ? 'it needs an approving review' : failing ? `${failing} check${failing > 1 ? 's are' : ' is'} failing` : pending ? 'required checks are still running' : 'a branch rule is not met yet';
    return { icon: '🚫', text: `Merging is blocked: ${why}.`, cls: 'bad', can: true, auto: true };
  }
  if (failing) return { icon: '❌', text: `${failing} check${failing > 1 ? 's' : ''} failing. It can still be merged.`, cls: 'warn', can: true, auto: false };
  if (pending || d.mergeStateStatus === 'UNSTABLE') return { icon: '🟡', text: 'Checks are still running. It can be merged now, or once they pass.', cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'UNKNOWN' || d.mergeable === 'UNKNOWN') return { icon: '⏳', text: 'GitHub is still working out whether this can merge. Refresh in a moment.', cls: 'muted', can: true, auto: false };
  return { icon: '✅', text: `Ready to merge: no conflicts with ${d.baseRefName}${d.checks.length ? ' and all checks passed' : ''}.`, cls: 'ok', can: true, auto: false };
}

function checksList(checks: GhCheck[]) {
  const order: GhCheck['state'][] = ['fail', 'pending', 'pass', 'skip'];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return h(
    'ul.gh-checks',
    {},
    ...sorted.map((c) => h('li', {}, h('span', { 'aria-label': c.state }, CHECK_ICON[c.state]), c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.name) : h('span', {}, c.name))),
  );
}

// ---- Comment box --------------------------------------------------------------------------------

interface CommentBox {
  el: HTMLElement;
  /** Names the GitHub account the comment goes out as, once the window knows it. */
  setViewer(login: string): void;
  /** Stops waiting for an answer; the window closed. */
  dispose(): void;
}

/**
 * Where you comment on an issue or a PR's conversation. It goes out through the server's gh, so
 * as that account rather than as you. The draft is kept per item until it is posted, so Esc or a
 * closed window doesn't lose it.
 */
function commentBox(kind: 'issue' | 'pull', number: number, itemUrl: string, net: Net, onPosted: (c: GhComment) => void): CommentBox {
  const draftKey = `${DRAFT_KEY}${itemUrl}`;
  const waitKey = `${kind}#${number}`;
  let busy = false;
  let timer = 0;
  const ta = h('textarea', { rows: 4, placeholder: 'Leave a comment. Markdown works; ⌘/Ctrl+Enter posts it.', 'aria-label': 'Comment' }) as HTMLTextAreaElement;
  ta.value = pref<string>(draftKey, '');
  const shown = h('div.gh-compose-preview.hidden');
  const write = h('button.btn.on', { type: 'button' }, 'Write');
  const preview = h('button.btn', { type: 'button' }, 'Preview');
  const who = h('span.grow', {}, "Posts to GitHub as the office's gh account");
  const post = h('button.btn.primary', { type: 'button' }, '💬 Comment');
  const result = h('div.gh-merge-result.error.hidden');
  const el = h(
    'article.gh-card.gh-compose',
    {},
    h('header', {}, h('b', {}, 'Add a comment'), h('span.grow'), h('div.seg', {}, write, preview)),
    h('div.gh-compose-body', {}, ta, shown),
    result,
    h('div.gh-compose-foot', {}, who, post),
  );

  const sync = () => {
    post.disabled = busy || !ta.value.trim();
    ta.readOnly = busy;
    post.textContent = busy ? 'Posting…' : '💬 Comment';
  };
  const saveDraft = () => {
    if (ta.value) savePref(draftKey, ta.value);
    else
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // storage blocked
      }
  };
  const setPreview = (on: boolean) => {
    write.classList.toggle('on', !on);
    preview.classList.toggle('on', on);
    ta.classList.toggle('hidden', on);
    shown.classList.toggle('hidden', !on);
    if (on) shown.replaceChildren(ta.value.trim() ? markdown(ta.value, itemUrl) : h('p.gh-quiet', {}, 'Nothing to preview.'));
    else ta.focus();
  };
  const fail = (text: string) => {
    result.textContent = text;
    result.classList.remove('hidden');
  };
  const settle = () => {
    commentWaiters.delete(waitKey);
    clearTimeout(timer);
    busy = false;
  };
  const submit = () => {
    const body = ta.value;
    if (busy || !body.trim()) return;
    busy = true;
    result.classList.add('hidden');
    sync();
    commentWaiters.set(waitKey, (msg) => {
      settle();
      if (msg.comment) {
        ta.value = '';
        saveDraft();
        setPreview(false);
        onPosted(msg.comment);
      } else fail(msg.error ?? 'GitHub did not take the comment');
      sync();
    });
    // The office drops messages while it's disconnected, and then no answer comes.
    timer = window.setTimeout(() => {
      settle();
      fail('No answer from the office. Reload the conversation to see whether the comment went through before posting it again.');
      sync();
    }, 45_000);
    net.send({ t: 'gh.comment', kind, number, body });
  };

  ta.addEventListener('input', () => (saveDraft(), sync()));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  });
  write.addEventListener('click', () => setPreview(false));
  preview.addEventListener('click', () => setPreview(true));
  post.addEventListener('click', submit);
  sync();
  return {
    el,
    setViewer(login) {
      if (login) who.textContent = `Posts to GitHub as @${login}`;
    },
    dispose: settle,
  };
}

// ---- Prompts for workers ------------------------------------------------------------------------

/** What a pull request's prompts fill in. */
function pullVars(it: GhPull) {
  return { number: it.number, title: it.title, url: it.url, branch: it.headRefName, base: it.baseRefName };
}

function reviewPrompt(it: GhPull) {
  return officePrompt('pull.review', pullVars(it));
}

function mergeCommand(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return `gh pr merge ${it.number} --${method}${deleteBranch ? ' --delete-branch' : ''} --repo ${nameWithOwner(it.url)}`;
}

function mergeVars(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return { ...pullVars(it), repo: nameWithOwner(it.url), merge: mergeCommand(it, method, deleteBranch) };
}

function fixAndMergePrompt(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return officePrompt('pull.fixMerge', mergeVars(it, method, deleteBranch));
}

function fixConflictsPrompt(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return officePrompt('pull.fixConflicts', mergeVars(it, method, deleteBranch));
}

function pullContext(it: GhPull) {
  return officePrompt('pull.ask', pullVars(it));
}

function issueContext(it: GhIssue) {
  return officePrompt('issue.ask', issueVars(it));
}

// ---- Merge dialog -------------------------------------------------------------------------------

function openMerge(it: GhPull, d: GhPullDetail, net: Net, handToWorker: () => void, onMerged: () => void) {
  const st = mergeStatus(d);
  const methods = d.repo.methods;
  let { method, deleteBranch } = mergePref(methods);
  let busy = false;

  const methodBtns = h('div.seg');
  const go = h('button.btn.primary', { type: 'button' });
  const auto = h('input', { type: 'checkbox', id: 'merge-auto' }) as HTMLInputElement;
  auto.checked = st.auto && st.cls !== 'ok';
  const renderMethods = () => {
    methodBtns.replaceChildren(
      ...methods.map((m) =>
        h('button.btn', { type: 'button', class: m === method ? 'on' : '', onclick: () => ((method = m), savePref(MERGE_KEY, { method, deleteBranch }), renderMethods()) }, METHOD_LABEL[m]),
      ),
    );
    go.textContent = auto.checked ? '⏱ Merge when ready' : `🔀 ${METHOD_LABEL[method]}`;
  };
  auto.addEventListener('change', renderMethods);
  const del = h('input', { type: 'checkbox', id: 'merge-del' }) as HTMLInputElement;
  del.checked = deleteBranch;
  del.addEventListener('change', () => {
    deleteBranch = del.checked;
    savePref(MERGE_KEY, { method, deleteBranch });
  });
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  // Conflicts can't be merged from here, so fixing them is the main button.
  const worker = conflicted(d)
    ? h('button.btn.primary', { type: 'button', title: 'A new worker merges the base in, resolves the conflicts, then merges it the way picked above' }, '✨ New worker: fix conflicts & merge')
    : h('button.btn', { type: 'button', title: 'A worker fixes whatever is in the way, then merges' }, '🤖 Hand to a worker');

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': `Merge PR #${it.number}` },
    h('header', {}, h('h2', {}, `🔀 Merge #${it.number}`)),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, h('small', {}, `${it.headRefName} → ${it.baseRefName}`)),
      h('div.gh-status', { class: st.cls }, h('span', {}, st.icon), st.text),
      d.checks.length ? checksList(d.checks) : null,
      h('label', { style: 'margin-top:14px' }, 'How'),
      methodBtns,
      h('label.gh-check', { for: 'merge-del' }, del, `Delete ${it.headRefName} after merging`),
      st.auto ? h('label.gh-check', { for: 'merge-auto', title: 'gh pr merge --auto (the repo must allow auto-merge)' }, auto, 'Merge automatically once the requirements pass') : null,
      result,
    ),
    h('footer', {}, st.can || conflicted(d) ? null : worker, h('span.grow'), cancel, conflicted(d) ? worker : go),
  );
  renderMethods();
  if (!st.can) go.disabled = true;

  const modal = openModal(el, { onClose: () => mergeWaiters.delete(it.number) });
  cancel.addEventListener('click', () => modal.close());
  worker.addEventListener('click', () => {
    modal.close();
    handToWorker();
  });
  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), auto.checked && st.auto ? 'Asking GitHub to merge it when ready…' : 'Merging…');
    mergeWaiters.set(it.number, (msg) => {
      mergeWaiters.delete(it.number);
      busy = false;
      if (msg.error) {
        go.disabled = false;
        result.className = 'gh-merge-result error';
        result.replaceChildren(msg.error);
        return;
      }
      modal.close();
      onMerged();
    });
    net.send({ t: 'gh.merge', number: it.number, method, deleteBranch, auto: auto.checked && st.auto });
  });
  setTimeout(() => (st.can ? go : cancel).focus(), 30);
}

// ---- Close dialog -------------------------------------------------------------------------------

const REASON_LABEL: Record<GhCloseReason, string> = { completed: '✅ Completed', 'not planned': '🚫 Not planned' };

/** Closes an issue (as completed or not planned) or a PR without merging, with an optional comment. */
function openClose(kind: 'issue' | 'pull', it: GhIssue | GhPull, net: Net, onClosed: () => void) {
  const key = `${kind}:${it.number}`;
  const pull = kind === 'pull' ? (it as GhPull) : null;
  let reason: GhCloseReason = 'completed';
  let busy = false;

  const go = h('button.btn.danger', { type: 'button' });
  const reasons = h('div.seg');
  const renderReasons = () => {
    reasons.replaceChildren(...(Object.keys(REASON_LABEL) as GhCloseReason[]).map((r) => h('button.btn', { type: 'button', class: r === reason ? 'on' : '', onclick: () => ((reason = r), renderReasons()) }, REASON_LABEL[r])));
    go.textContent = pull ? '🚫 Close pull request' : `${reason === 'completed' ? '✔️' : '🚫'} Close as ${reason}`;
  };
  const comment = h('textarea', { rows: 4, placeholder: 'Leave a comment (optional)', 'aria-label': 'Closing comment' }) as HTMLTextAreaElement;
  const del = h('input', { type: 'checkbox', id: 'close-del' }) as HTMLInputElement;
  const w = pull && workerForPull(store.workers.values(), pull);
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const noun = pull ? 'pull request' : 'issue';

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': `Close ${noun} #${it.number}` },
    h('header', {}, h('h2', {}, `${pull ? '🚫' : '✔️'} Close ${pull ? 'PR' : 'issue'} #${it.number}`)),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, pull ? h('small', {}, `${pull.headRefName} → ${pull.baseRefName}`) : null),
      pull
        ? h('div.gh-status.muted', {}, h('span', {}, 'ℹ️'), `It won't be merged, and can be reopened on GitHub later.${w ? ` ${w.name} is still at a desk working on its branch.` : ''}`)
        : h('label', {}, 'Why'),
      pull ? h('label.gh-check', { for: 'close-del' }, del, `Delete ${pull.headRefName} too`) : reasons,
      comment,
      result,
    ),
    h('footer', {}, h('span.grow'), cancel, go),
  );
  renderReasons();

  const modal = openModal(el, { onClose: () => closeWaiters.delete(key) });
  cancel.addEventListener('click', () => modal.close());
  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), `Closing the ${noun}…`);
    closeWaiters.set(key, (msg) => {
      closeWaiters.delete(key);
      busy = false;
      if (msg.error) {
        go.disabled = false;
        result.className = 'gh-merge-result error';
        result.replaceChildren(msg.error);
        return;
      }
      modal.close();
      onClosed();
    });
    net.send({ t: 'gh.close', kind, number: it.number, comment: comment.value.trim() || undefined, reason: pull ? undefined : reason, deleteBranch: !!pull && del.checked });
  });
  setTimeout(() => comment.focus(), 30);
}

// ---- Label picker -------------------------------------------------------------------------------

/**
 * Picks an issue's or PR's labels from the repo's own, like GitHub's sidebar: tick them on and off,
 * then save, and the office's gh account adds and takes off the difference.
 */
export function openLabels(kind: 'issue' | 'pull', it: GhIssue | GhPull, net: Net, onSaved?: (labels: GhLabel[]) => void) {
  const key = `${kind}:${it.number}`;
  const had = new Set(it.labels.map((l) => l.name));
  const on = new Set(had);
  const noun = kind === 'pull' ? 'PR' : 'issue';
  const manage = `${repoUrlOf(it.url)}/labels`;
  let repo: GhLabel[] | null = null;
  let error = '';
  let busy = false;
  let timer = 0;
  /** Each row and the text the filter looks in. */
  const rows = new Map<HTMLElement, string>();

  const filter = h('input', { type: 'text', placeholder: 'Filter labels…', 'aria-label': 'Filter labels' }) as HTMLInputElement;
  const list = h('ul.gh-labels');
  const none = h('p.gh-quiet.hidden');
  const result = h('div.gh-merge-result.hidden');
  const summary = h('span.grow');
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const save = h('button.btn.primary', { type: 'button' }, '🏷️ Save labels');
  const el = h(
    'div.modal.gh-merge.gh-labeler',
    { role: 'dialog', 'aria-label': `Labels on ${noun} #${it.number}` },
    h('header', {}, h('h2', {}, `🏷️ Labels on ${noun} #${it.number}`)),
    h('div.body', {}, h('p.gh-merge-title', {}, it.title), filter, list, none, result),
    h('footer', {}, summary, cancel, save),
  );

  const changes = () => ({ add: [...on].filter((n) => !had.has(n)), remove: [...had].filter((n) => !on.has(n)) });
  const sync = () => {
    const { add, remove } = changes();
    save.disabled = busy || (!add.length && !remove.length);
    save.textContent = busy ? 'Saving…' : '🏷️ Save labels';
    summary.textContent = add.length || remove.length ? [...add.map((l) => `+${l}`), ...remove.map((l) => `−${l}`)].join('  ') : `${on.size} label${on.size === 1 ? '' : 's'} on it`;
    for (const box of list.querySelectorAll('input')) box.disabled = busy;
  };
  const applyFilter = () => {
    const q = filter.value.trim().toLowerCase();
    let shown = 0;
    for (const [row, text] of rows) {
      const hit = !q || text.includes(q);
      row.classList.toggle('hidden', !hit);
      if (hit) shown++;
    }
    const empty = !!repo && !shown;
    none.classList.toggle('hidden', !empty);
    if (empty)
      none.replaceChildren(q ? `No labels match “${filter.value.trim()}”. ` : 'This repository has no labels yet. ', h('a', { href: manage, target: '_blank', rel: 'noopener noreferrer' }, 'Make one on GitHub ↗'));
  };
  const row = (l: GhLabel) => {
    const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
    box.checked = on.has(l.name);
    box.addEventListener('change', () => {
      if (box.checked) on.add(l.name);
      else on.delete(l.name);
      sync();
    });
    const li = h('li', {}, h('label.gh-check', {}, box, labelChip(l), l.description ? h('small', {}, l.description) : null));
    rows.set(li, `${l.name}\n${l.description ?? ''}`.toLowerCase());
    return li;
  };
  const render = () => {
    rows.clear();
    // The ones it has first, then the rest, each A to Z. Worked out once, so a row never jumps away from the pointer.
    const byName = (a: GhLabel, b: GhLabel) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    const known = new Map((repo ?? []).map((l) => [l.name, l]));
    const mine = it.labels.map((l) => known.get(l.name) ?? l).sort(byName);
    const rest = (repo ?? []).filter((l) => !had.has(l.name)).sort(byName);
    list.replaceChildren(...[...mine, ...rest].map(row));
    if (error) list.append(h('li', {}, errorBox(error, load)));
    else if (!repo) list.append(h('li', {}, spinnerRow("Loading the repo's labels…")));
    applyFilter();
    sync();
  };
  const load = () => {
    error = '';
    repo = null;
    render();
    getJson<GhLabel[]>('/api/gh/labels')
      .then((l) => (repo = l))
      .catch((err) => (error = (err as Error).message))
      .finally(render);
  };
  const settle = () => {
    labelWaiters.delete(key);
    clearTimeout(timer);
    busy = false;
  };
  const fail = (text: string) => {
    result.className = 'gh-merge-result error';
    result.replaceChildren(text);
    sync();
  };
  const submit = () => {
    const { add, remove } = changes();
    if (busy || (!add.length && !remove.length)) return;
    busy = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), 'Saving the labels on GitHub…');
    sync();
    labelWaiters.set(key, (msg) => {
      settle();
      if (!msg.labels) return fail(msg.error ?? 'GitHub did not take the labels');
      modal.close();
      onSaved?.(msg.labels);
    });
    // The office drops messages while it's disconnected, and then no answer comes.
    timer = window.setTimeout(() => {
      settle();
      fail('No answer from the office. Look at the board to see whether the labels changed before saving again.');
    }, 45_000);
    net.send({ t: 'gh.labels', kind, number: it.number, add, remove });
  };

  filter.addEventListener('input', applyFilter);
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.metaKey || e.ctrlKey) submit();
    // Enter in the filter ticks (or unticks) the first label it shows.
    else if (e.target === filter) [...rows.keys()].find((r) => !r.classList.contains('hidden'))?.querySelector('input')?.click();
    else return;
    e.preventDefault();
  });
  const modal = openModal(el, { onClose: settle });
  cancel.addEventListener('click', () => modal.close());
  save.addEventListener('click', submit);
  load();
  setTimeout(() => filter.focus(), 30);
}

/** The button that opens the label picker, after an issue's or PR's labels. */
function labelButton(kind: 'issue' | 'pull', it: () => GhIssue | GhPull, net: Net, onSaved: (labels: GhLabel[]) => void) {
  const has = it().labels.length > 0;
  return h('button.btn.gh-label-edit', { type: 'button', title: 'Change the labels', 'aria-label': 'Change the labels', onclick: () => openLabels(kind, it(), net, onSaved) }, has ? '🏷️ Edit' : '🏷️ Add labels');
}

// ---- The PR window ------------------------------------------------------------------------------

export function openPull(first: GhPull, net: Net, actions: BoardActions) {
  let it = first;
  const itemUrl = it.url;
  const reviewed = new Reviewed(it.url);
  let detail: GhPullDetail | null = null;
  let detailError = '';
  let files: DiffFile[] | null = null;
  let diffError = '';
  let tab: 'conversation' | 'files' = pref<string>(TAB_KEY, '') === 'files' ? 'files' : 'conversation';
  let mode: 'tree' | 'list' = pref<string>(FILES_KEY, '') === 'list' ? 'list' : 'tree';
  let filter = '';
  let current = '';
  const collapsedDirs = new Set<string>();
  /** Files you opened or closed yourself; the rest follow the defaults (reviewed ones closed). */
  const open = new Map<string, boolean>();
  const sections = new Map<string, { sec: HTMLElement; body: HTMLElement; box: HTMLInputElement; built: boolean; big: boolean }>();

  // --- Frame
  const pill = h('span.pill');
  const title = h('h2');
  const reload = h('button.btn', { type: 'button', title: 'Reload from GitHub' }, '🔄');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const meta = h('div.gh-meta');
  const tabConv = h('button.gh-tab', { type: 'button', role: 'tab' });
  const tabFiles = h('button.gh-tab', { type: 'button', role: 'tab' });
  const conv = h('div.gh-conv');
  // The comment box stays put while the conversation above it is redrawn, so a load finishing
  // doesn't take the focus (or the text) away from someone typing.
  const thread = h('div.gh-items');
  const comment = commentBox('pull', it.number, itemUrl, net, (c) => {
    if (!detail) return loadAll();
    detail.comments.push(c);
    renderConv();
    renderFrame();
  });
  conv.append(h('div.gh-col', {}, thread, comment.el));
  const filesPane = h('div.pd');
  const footBtns = h('span.gh-foot');
  const el = h(
    'div.modal.gh-window',
    { role: 'dialog', 'aria-label': `Pull request #${it.number}`, tabindex: -1 },
    h('header', {}, pill, title, reload, close),
    meta,
    h('nav.gh-tabs', { role: 'tablist' }, tabConv, tabFiles),
    h('div.gh-body', {}, conv, filesPane),
    h('footer', {}, h('a.grow', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on GitHub ↗'), footBtns),
  );

  const handToWorker = () => {
    const p = mergePref(detail?.repo.methods ?? ['squash', 'merge', 'rebase']);
    if (detail && conflicted(detail)) actions.assign(fixConflictsPrompt(it, p.method, p.deleteBranch), `Fix conflicts & merge PR #${it.number}`);
    else actions.assign(fixAndMergePrompt(it, p.method, p.deleteBranch), `Fix up & merge PR #${it.number}`);
  };

  const renderFrame = () => {
    const [word, cls] = stateOf(it);
    pill.className = `pill ${cls}`;
    pill.textContent = word;
    title.textContent = `#${it.number} ${it.title}`;
    title.title = it.title;
    const commits = detail ? `${detail.commits} commit${detail.commits === 1 ? '' : 's'}` : 'its commits';
    meta.replaceChildren(
      ...nodes(
      avatar(it.author),
      h('b', {}, it.author),
      h('span', {}, it.state === 'MERGED' ? `merged ${commits} into` : `wants to merge ${commits} into`),
      h('code', {}, it.baseRefName),
      h('span', {}, 'from'),
      h('code', {}, it.headRefName),
      h('span.gh-pm', {}, h('span.add', {}, `+${it.additions}`), ' ', h('span.del', {}, `−${it.deletions}`)),
      ...it.labels.map(labelChip),
      labelButton('pull', () => it, net, (labels) => ((it = { ...it, labels }), renderFrame())),
      it.reviewDecision ? h('span.gh-badge', { class: REVIEW_BADGE[it.reviewDecision]?.[1] ?? '' }, it.reviewDecision === 'REVIEW_REQUIRED' ? 'review required' : (REVIEW_BADGE[it.reviewDecision]?.[0] ?? it.reviewDecision.toLowerCase())) : null,
      ),
    );
    const done = files ? files.filter((f) => reviewed.mark(f) === 'reviewed').length : 0;
    tabConv.replaceChildren(...nodes('💬 Conversation', detail ? h('span.gh-count', {}, String(detail.comments.length + detail.reviews.length + detail.reviewComments.filter((c) => !c.replyTo).length)) : null));
    tabFiles.replaceChildren(...nodes('📄 Files changed', files ? h('span.gh-count', {}, String(files.length)) : null, files?.length ? h('span.gh-progress', { class: done === files.length ? 'all' : '' }, `✓ ${done}/${files.length}`) : null));
    tabConv.classList.toggle('on', tab === 'conversation');
    tabFiles.classList.toggle('on', tab === 'files');
    tabConv.setAttribute('aria-selected', String(tab === 'conversation'));
    tabFiles.setAttribute('aria-selected', String(tab === 'files'));
    conv.classList.toggle('hidden', tab !== 'conversation');
    filesPane.classList.toggle('hidden', tab !== 'files');

    const isOpen = it.state === 'OPEN';
    const conflicts = !!detail && conflicted(detail);
    const merge = h(conflicts ? 'button.btn' : 'button.btn.primary', { type: 'button', disabled: !detail, title: detail ? 'Merge this pull request' : 'Loading…' }, '🔀 Merge…');
    merge.addEventListener('click', () => detail && openMerge(it, detail, net, handToWorker, loadAll));
    const w = workerForPull(store.workers.values(), it);
    footBtns.replaceChildren(
      ...nodes(
      w ? h('button.btn', { type: 'button', onclick: () => actions.goToDesk(w.deskId) }, `🪑 Go to ${w.name}'s desk`) : null,
      h('button.btn', { type: 'button', title: 'Send a worker your own prompt about this PR', onclick: () => actions.ask(pullContext(it), `Ask about PR #${it.number}`) }, '✍️ Ask a worker…'),
      isOpen ? h('button.btn', { type: 'button', onclick: () => actions.assign(reviewPrompt(it), `Review PR #${it.number}`) }, '🔍 Review') : null,
      isOpen
        ? h('button.btn', { type: 'button', title: 'A few workers review it in the meeting room, each through its own lens, and the office posts one combined review', onclick: () => actions.meeting({ pattern: 'review', pr: it.number, title: `Review of PR #${it.number}`, prompt: officePrompt('pull.panel', pullVars(it)) }) }, '🤝 Review panel…')
        : null,
      conflicts
        ? h('button.btn.primary', { type: 'button', title: 'A new worker merges the base in, resolves the conflicts, gets the checks green, then merges', onclick: handToWorker }, '✨ Fix conflicts & merge')
        : isOpen
          ? h('button.btn', { type: 'button', title: 'A worker addresses the review comments, gets the checks green, then merges', onclick: handToWorker }, '🤖 Fix comments & merge')
          : null,
      isOpen ? h('button.btn', { type: 'button', title: 'Close this pull request without merging it', onclick: () => openClose('pull', it, net, loadAll) }, '🚫 Close PR…') : null,
      isOpen ? merge : null,
      ),
    );
  };

  // --- Conversation
  const showInDiff = (c: GhReviewComment) => {
    setTab('files');
    requestAnimationFrame(() => revealLine(c.path, c.side, c.line));
  };

  const renderConv = () => {
    thread.replaceChildren(commentCard({ id: 'body', author: it.author, body: detail?.body ?? it.body, createdAt: it.createdAt, url: it.url }, itemUrl, 'opened this'));
    if (detailError) return thread.append(errorBox(detailError, loadAll));
    if (!detail) return thread.append(spinnerRow('Loading the conversation…'));
    const d = detail;
    const replies = repliesOf(d.reviewComments);
    const items: { at: string; node: HTMLElement }[] = [
      ...d.comments.map((c) => ({ at: c.createdAt, node: commentCard(c, itemUrl, 'commented') })),
      ...d.reviews.map((r) => ({ at: r.createdAt, node: commentCard(r, itemUrl, '', REVIEW_BADGE[r.state ?? ''] ?? [r.state?.toLowerCase() ?? 'reviewed', '']) })),
      ...d.reviewComments
        .filter((c) => !c.replyTo)
        .map((c) => ({
          at: c.createdAt,
          node: h(
            'article.gh-card.gh-thread',
            {},
            h(
              'header',
              {},
              h('span', {}, '💬'),
              h('code', { title: c.path }, `${c.path}${c.line ? `:${c.line}` : ''}`),
              c.line == null ? h('span.gh-badge.muted', {}, 'outdated') : null,
              h('span.grow'),
              c.line != null ? h('button.btn', { type: 'button', onclick: () => showInDiff(c) }, 'Show in diff') : null,
            ),
            renderThread(c, replies, itemUrl),
          ),
        })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    thread.append(...items.map((x) => x.node));
    if (!items.length) thread.append(h('p.gh-quiet', {}, 'No comments or reviews yet.'));

    const st = mergeStatus(d);
    const box = h('section.gh-mergebox', { class: st.cls }, h('div.gh-status', { class: st.cls }, h('span', {}, st.icon), st.text), d.checks.length ? checksList(d.checks) : null);
    if (it.state === 'OPEN' && st.can) box.append(h('div.gh-mergebox-go', {}, h('button.btn.primary', { type: 'button', onclick: () => openMerge(it, d, net, handToWorker, loadAll) }, '🔀 Merge…')));
    if (conflicted(d)) box.append(h('div.gh-mergebox-go', {}, h('button.btn.primary', { type: 'button', onclick: handToWorker }, '✨ New worker: fix conflicts & merge')));
    else if (it.state === 'OPEN' && !st.can && !d.isDraft) box.append(h('div.gh-mergebox-go', {}, h('button.btn', { type: 'button', onclick: handToWorker }, '🤖 Have a worker fix it & merge')));
    thread.append(box);
  };

  // --- Files
  /** The files in the order the sidebar lists them, after the filter. */
  let order: DiffFile[] = [];
  const shown = () => {
    if (!files) return [];
    const q = filter.trim().toLowerCase();
    const list = mode === 'tree' ? treeOrder(buildTree(files)) : files;
    return q ? list.filter((f) => f.path.toLowerCase().includes(q)) : list;
  };

  const isOpenFile = (f: DiffFile) => open.get(f.path) ?? reviewed.mark(f) !== 'reviewed';

  const buildBody = (f: DiffFile) => {
    const s = sections.get(f.path)!;
    s.body.replaceChildren();
    s.built = true;
    s.body.append(renderFileDiff(f, detail?.reviewComments ?? [], itemUrl));
  };

  let budget = 0;
  const syncSection = (f: DiffFile) => {
    const s = sections.get(f.path)!;
    const mark = reviewed.mark(f);
    const isOpen = isOpenFile(f);
    s.sec.classList.toggle('closed', !isOpen);
    s.sec.classList.toggle('reviewed', mark === 'reviewed');
    s.box.checked = mark === 'reviewed';
    s.sec.querySelector('.pd-stale')?.classList.toggle('hidden', mark !== 'stale');
    if (!isOpen || s.built) return;
    // Big files and lock files wait for a click, so a huge PR doesn't lock up the window.
    if (s.big && !open.get(f.path)) {
      s.body.replaceChildren(
        h('div.pd-big', {}, looksGenerated(f.path) ? 'Generated or lock file — not shown by default.' : `Large diff (${f.lines.length} lines) — not shown by default.`, h('button.btn', { type: 'button', onclick: () => (open.set(f.path, true), buildBody(f)) }, 'Show diff')),
      );
      return;
    }
    buildBody(f);
  };

  const setReviewed = (f: DiffFile, on: boolean, advance = false) => {
    reviewed.set(f, on);
    open.delete(f.path);
    const s = sections.get(f.path);
    const pane = filesPane.querySelector<HTMLElement>('.pd-main');
    syncSection(f);
    // Closing a file you were reading: keep its header in view instead of jumping past the next one.
    if (on && s && pane && s.sec.offsetTop < pane.scrollTop) pane.scrollTop = s.sec.offsetTop;
    if (on && advance) {
      const next = order.slice(order.indexOf(f) + 1).find((x) => reviewed.mark(x) !== 'reviewed');
      if (next) scrollToFile(next.path);
    }
    renderSide();
    renderFrame();
  };

  const scrollToFile = (p: string, reveal = false) => {
    const s = sections.get(p);
    const pane = filesPane.querySelector<HTMLElement>('.pd-main');
    const f = files?.find((x) => x.path === p);
    if (!s || !pane || !f) return;
    if (reveal && !isOpenFile(f)) {
      open.set(p, true);
      syncSection(f);
    }
    pane.scrollTop = s.sec.offsetTop;
    setCurrent(p);
  };

  const revealLine = (p: string, side: 'LEFT' | 'RIGHT', line: number | null) => {
    const f = files?.find((x) => x.path === p);
    const s = sections.get(p);
    if (!f || !s) return;
    open.set(p, true);
    syncSection(f);
    if (!s.built) buildBody(f);
    const row = s.body.querySelector<HTMLElement>(side === 'LEFT' ? `.pd-l[data-old="${line}"]:not(.add)` : `.pd-l[data-new="${line}"]`);
    const pane = filesPane.querySelector<HTMLElement>('.pd-main')!;
    if (!row) return scrollToFile(p);
    // Rows sit in .pd-main's coordinates (it's the positioned ancestor), like the sections.
    pane.scrollTop = row.offsetTop - pane.clientHeight / 3;
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1600);
    setCurrent(p);
  };

  const side = h('aside.pd-side');
  const fileList = h('ul.pd-files', { role: 'tree' });
  const filterInput = h('input', { type: 'text', placeholder: 'Filter files…', 'aria-label': 'Filter files' }) as HTMLInputElement;
  filterInput.addEventListener('input', () => {
    filter = filterInput.value;
    renderFiles();
  });

  const setCurrent = (p: string) => {
    if (current === p) return;
    current = p;
    for (const li of fileList.querySelectorAll<HTMLElement>('li[data-path]')) {
      const on = li.dataset.path === p;
      li.classList.toggle('on', on);
      if (on) li.scrollIntoView({ block: 'nearest' });
    }
  };

  const checkBtn = (f: DiffFile) => {
    const mark = reviewed.mark(f);
    return h(
      'button.pd-tick',
      {
        type: 'button',
        class: mark,
        title: mark === 'reviewed' ? 'Reviewed — click to unmark' : mark === 'stale' ? 'Changed since you reviewed it' : 'Mark as reviewed',
        'aria-pressed': String(mark === 'reviewed'),
        onclick: ((e: Event) => {
          e.stopPropagation();
          setReviewed(f, mark !== 'reviewed');
        }) as EventListener,
      },
      mark === 'reviewed' ? '✓' : mark === 'stale' ? '!' : '',
    );
  };

  const countComments = (p: string) => detail?.reviewComments.filter((c) => c.path === p && !c.replyTo).length ?? 0;

  const fileRow = (f: DiffFile, depth: number) => {
    const slash = f.path.lastIndexOf('/');
    const n = countComments(f.path);
    return h(
      'li.pd-row',
      { 'data-path': f.path, class: `${current === f.path ? 'on' : ''} ${reviewed.mark(f)}`, style: `--depth:${depth}`, role: 'treeitem', title: f.path, onclick: () => scrollToFile(f.path, true) },
      checkBtn(f),
      h('span.pd-st', { class: f.status, title: STATUS_WORD[f.status] }, f.status),
      // The name first and its folder after, so a narrow sidebar cuts the folder, not the name.
      h('span.pd-path', {}, f.path.slice(slash + 1), mode === 'list' && slash >= 0 ? h('span.dir', {}, ` ${f.path.slice(0, slash)}`) : null),
      n ? h('span.pd-c', { title: `${n} comment${n > 1 ? 's' : ''}` }, `💬${n}`) : null,
      h('span.gh-pm', {}, f.binary ? h('span.bin', {}, 'bin') : h('span', {}, h('span.add', {}, `+${f.additions}`), ' ', h('span.del', {}, `−${f.deletions}`))),
    );
  };

  const dirRows = (d: TreeDir, depth: number, visible: Set<DiffFile>, out: HTMLElement[]) => {
    for (const sub of d.dirs) {
      const inside = treeOrder(sub).filter((f) => visible.has(f));
      if (!inside.length) continue;
      const shut = collapsedDirs.has(sub.path) && !filter;
      const all = inside.every((f) => reviewed.mark(f) === 'reviewed');
      out.push(
        h(
          'li.pd-dir',
          {
            style: `--depth:${depth}`,
            role: 'treeitem',
            'aria-expanded': String(!shut),
            title: sub.path,
            onclick: () => {
              if (collapsedDirs.has(sub.path)) collapsedDirs.delete(sub.path);
              else collapsedDirs.add(sub.path);
              renderSide();
            },
          },
          h('span.pd-caret', {}, shut ? '▸' : '▾'),
          h('span', {}, '📁'),
          h('span.pd-path', {}, sub.name),
          all ? h('span.pd-done', { title: 'Everything in here is reviewed' }, '✓') : null,
        ),
      );
      if (!shut) dirRows(sub, depth + 1, visible, out);
    }
    for (const f of d.files) if (visible.has(f)) out.push(fileRow(f, depth));
  };

  const renderSide = () => {
    if (!files) return;
    const rows: HTMLElement[] = [];
    if (mode === 'tree') dirRows(buildTree(files), 0, new Set(order), rows);
    else rows.push(...order.map((f) => fileRow(f, 0)));
    if (!rows.length) rows.push(h('li.pd-none', {}, filter ? 'No files match.' : 'No files changed.'));
    fileList.replaceChildren(...rows);
    const done = files.filter((f) => reviewed.mark(f) === 'reviewed').length;
    const bar = side.querySelector<HTMLElement>('.pd-bar i');
    if (bar) bar.style.width = `${files.length ? (100 * done) / files.length : 0}%`;
    const txt = side.querySelector<HTMLElement>('.pd-done-txt');
    if (txt) txt.textContent = `${done} of ${files.length} file${files.length === 1 ? '' : 's'} reviewed`;
  };

  const renderFiles = () => {
    order = shown();
    renderSide();
    const main = filesPane.querySelector<HTMLElement>('.pd-main');
    if (!main || !files) return;
    main.replaceChildren(...order.map((f) => sections.get(f.path)!.sec));
    if (!order.length) main.append(h('div.pd-note', {}, 'No files match the filter.'));
  };

  const setupFiles = () => {
    const was = filesPane.querySelector<HTMLElement>('.pd-main')?.scrollTop ?? 0;
    filesPane.replaceChildren();
    sections.clear();
    if (diffError) return filesPane.append(errorBox(diffError, loadAll));
    if (!files) return filesPane.append(spinnerRow('Loading the diff…'));
    const modeBtn = (m: 'tree' | 'list', label: string) =>
      h(
        'button.btn',
        {
          type: 'button',
          class: mode === m ? 'on' : '',
          onclick: () => {
            mode = m;
            savePref(FILES_KEY, m);
            for (const b of side.querySelectorAll('.pd-mode .btn')) b.classList.toggle('on', b.textContent === label);
            renderFiles();
          },
        },
        label,
      );
    side.replaceChildren(
      h('div.pd-side-head', {}, h('div.seg.pd-mode', {}, modeBtn('tree', '🌲 Tree'), modeBtn('list', '☰ List')), h('div.pd-bar', {}, h('i')), h('div.pd-done-txt')),
      filterInput,
      fileList,
      h('div.pd-keys', {}, h('span.key', {}, 'J'), h('span.key', {}, 'K'), 'next / previous file · ', h('span.key', {}, 'V'), 'reviewed'),
    );
    const main = h('div.pd-main', { tabindex: -1 });
    budget = 0;
    for (const f of files) {
      const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
      box.addEventListener('change', () => setReviewed(f, box.checked));
      const body = h('div.pd-fbody');
      const n = countComments(f.path);
      const big = looksGenerated(f.path) || f.lines.length > 800 || budget > 6000;
      if (!big) budget += f.lines.length;
      const sec = h(
        'section.pd-file',
        { 'data-path': f.path },
        h(
          'header.pd-fh',
          {},
          h('button.pd-fold', { type: 'button', 'aria-label': 'Show or hide this file', onclick: () => (open.set(f.path, !isOpenFile(f)), syncSection(f)) }),
          h('span.pd-st', { class: f.status, title: STATUS_WORD[f.status] }, f.status),
          h('span.pd-fpath', { title: f.path }, f.status === 'R' && f.oldPath ? `${f.oldPath} → ${f.path}` : f.path),
          h('span.gh-pm', {}, f.binary ? h('span.bin', {}, 'binary') : h('span', {}, h('span.add', {}, `+${f.additions}`), ' ', h('span.del', {}, `−${f.deletions}`))),
          n ? h('span.pd-c', {}, `💬 ${n}`) : null,
          h('span.pd-stale.hidden', { title: 'The file changed after you marked it reviewed' }, 'changed since review'),
          h('label.pd-viewed', { title: 'Mark as reviewed (V)' }, box, 'Reviewed'),
        ),
        body,
      );
      sections.set(f.path, { sec, body, box, built: false, big });
      syncSection(f);
    }
    main.addEventListener('scroll', () => {
      if (spy) return;
      spy = requestAnimationFrame(() => {
        spy = 0;
        const top = main.scrollTop + 12;
        let at = '';
        for (const f of order) {
          const s = sections.get(f.path)!;
          if (s.sec.offsetTop > top) break;
          at = f.path;
        }
        if (at) setCurrent(at);
      });
    });
    filesPane.append(side, main);
    renderFiles();
    main.scrollTop = was;
    if (!current && order[0]) setCurrent(order[0].path);
  };
  let spy = 0;

  const step = (dir: 1 | -1) => {
    const i = order.findIndex((f) => f.path === current);
    const next = order[Math.max(0, Math.min(order.length - 1, i + dir))];
    if (next) scrollToFile(next.path, true);
  };

  el.addEventListener('keydown', (e) => {
    if (tab !== 'files' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input[type=text], textarea')) return;
    if (e.key === 'j' || e.key === 'n') step(1);
    else if (e.key === 'k' || e.key === 'p') step(-1);
    else if (e.key === 'v') {
      const f = files?.find((x) => x.path === current);
      if (f) setReviewed(f, reviewed.mark(f) !== 'reviewed', true);
    } else return;
    e.preventDefault();
  });

  const setTab = (t: typeof tab) => {
    tab = t;
    savePref(TAB_KEY, t);
    renderFrame();
    if (t === 'files') filesPane.querySelector<HTMLElement>('.pd-main')?.focus({ preventScroll: true });
  };
  tabConv.addEventListener('click', () => setTab('conversation'));
  tabFiles.addEventListener('click', () => setTab('files'));

  // --- Loading
  let generation = 0;
  function loadAll() {
    const g = ++generation;
    detailError = '';
    diffError = '';
    renderConv();
    getJson<GhPullDetail>(`/api/gh/pull?number=${it.number}`)
      .then((d) => {
        if (g !== generation) return;
        detail = d;
        comment.setViewer(d.viewer);
        it = { ...it, state: d.state, isDraft: d.isDraft, reviewDecision: d.reviewDecision };
        // Line comments go into the diff, so draw it again with them.
        if (files) setupFiles();
      })
      .catch((err) => g === generation && (detailError = (err as Error).message))
      .finally(() => g === generation && (renderFrame(), renderConv()));
    getText(`/api/gh/pull/diff?number=${it.number}`)
      .then((text) => {
        if (g !== generation) return;
        files = parseDiff(text);
      })
      .catch((err) => g === generation && (diffError = (err as Error).message))
      .finally(() => g === generation && (setupFiles(), renderFrame()));
    renderFrame();
  }
  reload.addEventListener('click', () => {
    net.send({ t: 'gh.refresh' });
    loadAll();
  });

  const unsub = store.on('pulls', () => {
    const fresh = store.pulls.items.find((p) => p.number === it.number);
    if (!fresh) return;
    it = detail ? { ...fresh, state: fresh.state === 'OPEN' ? detail.state : fresh.state } : fresh;
    renderFrame();
  });
  const modal: Modal = openModal(el, {
    doing: `🔀 reading PR #${it.number}`,
    onClose: () => {
      unsub();
      comment.dispose();
    },
  });
  close.addEventListener('click', () => modal.close());
  renderFrame();
  setupFiles();
  loadAll();
  setTimeout(() => el.focus({ preventScroll: true }), 30);
}

// ---- The issue window -----------------------------------------------------------------------------

export function openIssue(first: GhIssue, net: Net, actions: BoardActions) {
  let it = first;
  const itemUrl = it.url;
  let detail: GhIssueDetail | null = null;
  let error = '';
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const pill = h('span.pill');
  const conv = h('div.gh-conv');
  const thread = h('div.gh-items');
  const comment = commentBox('issue', it.number, itemUrl, net, (c) => {
    if (!detail) return load();
    detail.comments.push(c);
    render();
  });
  conv.append(h('div.gh-col', {}, thread, comment.el));
  // The footer stays put and renderFrame only shows, hides and relabels, so a board refresh never
  // pulls focus out of the provider picker.
  const closeIssue = h('button.btn', { type: 'button', title: 'Close this issue on GitHub', onclick: () => openClose('issue', it, net, load) }, '✔️ Close issue…');
  const queueProvider = providerPicker(store.project, `issue-provider-${it.number}`, 'Queue on');
  const addIssueToQueue = () => {
    if (!queueProvider.valid()) return;
    modal.close();
    actions.queue(issuePrompt(it), `#${it.number} ${it.title}`, it.number, queueProvider.value(), queueProvider.model(), queueProvider.effort());
  };
  const queue = h('button.btn', { type: 'button', onclick: addIssueToQueue }) as HTMLButtonElement;
  const pickUp = h('button.btn', { type: 'button', title: 'Carry its card to an empty desk, a worker or the queue board, and press E there', onclick: () => actions.pickUp(it) }, '✋ Pick it up');
  const meta = h('div.gh-meta');
  const el = h(
    'div.modal.gh-window.issue',
    { role: 'dialog', 'aria-label': `Issue #${it.number}` },
    h('header', {}, pill, h('h2', { title: it.title }, `#${it.number} ${it.title}`), close),
    meta,
    h('div.gh-body', {}, conv),
    h(
      'footer',
      {},
      h('a.grow', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on GitHub ↗'),
      h('button.btn', { type: 'button', title: 'Send a worker your own prompt about this issue', onclick: () => actions.ask(issueContext(it), `Ask about issue #${it.number}`) }, '✍️ Ask a worker…'),
      h('button.btn', { type: 'button', title: 'Workers take it on together in the meeting room: a debate, lead & team, map-reduce or red / blue', onclick: () => actions.meeting(issueMeeting(it.number, it.title)) }, '🤝 Meeting…'),
      closeIssue,
      queueProvider.element,
      queue,
      pickUp,
      h('button.btn.primary', { type: 'button', onclick: () => actions.assign(issuePrompt(it), `Hand issue #${it.number} to a worker`) }, '🤖 Hand to a worker'),
    ),
  );
  const renderFrame = () => {
    const isOpen = it.state === 'OPEN';
    meta.replaceChildren(
      ...nodes(
        avatar(it.author),
        h('b', {}, it.author),
        h('span', {}, `opened this ${timeAgo(it.createdAt)}`),
        it.assignees.length ? h('span', {}, `· 👤 ${it.assignees.join(', ')}`) : null,
        ...it.labels.map(labelChip),
        labelButton('issue', () => it, net, (labels) => ((it = { ...it, labels }), renderFrame())),
      ),
    );
    pill.className = `pill ${isOpen ? 'done' : 'offline'}`;
    pill.textContent = isOpen ? 'open' : 'closed';
    const task = store.taskForIssue(it.number);
    const onQueue = !!task && task.status !== 'done';
    closeIssue.classList.toggle('hidden', !isOpen);
    pickUp.classList.toggle('hidden', !isOpen);
    queueProvider.element.classList.toggle('hidden', !isOpen || onQueue);
    queue.classList.toggle('hidden', !isOpen);
    queue.disabled = onQueue;
    queue.title = onQueue ? '' : 'A worker picks it up by itself when a desk is free and there is room under the worker limit';
    queue.textContent = onQueue ? (task!.status === 'running' ? `🤖 ${task!.workerName ?? 'A worker'} is on it` : '📋 On the queue') : '📋 Add to queue';
  };
  const render = () => {
    thread.replaceChildren(commentCard({ id: 'body', author: it.author, body: detail?.body ?? it.body, createdAt: it.createdAt, url: it.url }, itemUrl, 'opened this'));
    if (error) thread.append(errorBox(error, load));
    else if (!detail) thread.append(spinnerRow('Loading comments…'));
    else if (!detail.comments.length) thread.append(h('p.gh-quiet', {}, 'No comments yet.'));
    else thread.append(...detail.comments.map((c) => commentCard(c, itemUrl, 'commented')));
  };
  let generation = 0;
  function load() {
    const g = ++generation;
    error = '';
    render();
    getJson<GhIssueDetail>(`/api/gh/issue?number=${it.number}`)
      .then((d) => {
        if (g !== generation) return;
        detail = d;
        it = { ...it, state: d.state };
        comment.setViewer(d.viewer);
      })
      .catch((err) => g === generation && (error = (err as Error).message))
      .finally(() => g === generation && (renderFrame(), render()));
  }
  const unsubs = [
    store.on('issues', () => {
      const fresh = store.issues.items.find((i) => i.number === it.number);
      if (!fresh) return;
      // The board can lag behind a close made from here.
      it = detail ? { ...fresh, state: fresh.state === 'OPEN' ? detail.state : fresh.state } : fresh;
      renderFrame();
    }),
    store.on('queue', renderFrame),
  ];
  const modal = openModal(el, {
    doing: `📋 reading issue #${it.number}`,
    onClose: () => {
      comment.dispose();
      unsubs.forEach((u) => u());
    },
  });
  close.addEventListener('click', () => modal.close());
  renderFrame();
  load();
}
