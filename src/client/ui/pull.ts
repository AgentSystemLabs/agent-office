import type { GhCheck, GhComment, GhIssue, GhIssueDetail, GhMergeMethod, GhPull, GhPullDetail, GhReviewComment, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { AVATAR_COLORS, projectRepository, store, workerForPull } from '../state';
import { issuePrompt, type BoardActions } from './boards';
import { h, openModal, timeAgo, type Modal } from './dom';
import { markdown, repoUrlOf } from './markdown';
import { buildTree, looksGenerated, parseDiff, renderFileDiff, renderThread, repliesOf, Reviewed, STATUS_WORD, treeOrder, type DiffFile, type TreeDir } from './pulldiff';
import { providerPicker } from './provider';
import { lookupIssueProject } from './repository-project';

// The windows behind the board cards. A PR opens on its conversation (description, comments,
// reviews, line comments, checks) with a Files tab for the diff, where you tick files off as
// reviewed; from here you merge it, or hand it to a worker to review, fix up and merge.

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

async function getText(url: string): Promise<string> {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.text();
}

const mergeWaiters = new Map<number, (msg: Extract<ServerMsg, { t: 'gh.merged' }>) => void>();

/** Main feeds server messages through here so an open merge dialog hears back. */
export function routePullMessage(msg: ServerMsg) {
  if (msg.t === 'gh.merged') mergeWaiters.get(msg.number)?.(msg);
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
export function labelChip(l: { name: string; color: string }) {
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

// ---- Prompts for workers ------------------------------------------------------------------------

function reviewPrompt(it: GhPull) {
  return `Review pull request #${it.number}: "${it.title}".\n\nUse \`gh pr view ${it.number} --comments\` and \`gh pr diff ${it.number}\`. Look for bugs, risky changes and missing tests, then give me a short summary with concrete suggestions. Don't push any commits.`;
}

function checkoutStep(it: GhPull) {
  return `Get onto its branch: \`gh pr checkout ${it.number}\`. If git says \`${it.headRefName}\` is already checked out in another worktree, use \`git fetch origin ${it.headRefName} && git checkout --detach FETCH_HEAD\` instead and push with \`git push origin HEAD:${it.headRefName}\`.`;
}

function mergeCommand(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  return `gh pr merge ${it.number} --${method}${deleteBranch ? ' --delete-branch' : ''} --repo ${nameWithOwner(it.url)}`;
}

function fixAndMergePrompt(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  const n = it.number;
  const repo = nameWithOwner(it.url);
  return [
    `Get pull request #${n} "${it.title}" (${it.url}) ready and merge it.`,
    '',
    `1. ${checkoutStep(it)}`,
    `2. Read all the feedback: \`gh pr view ${n} --comments\`, and the comments on lines of code with \`gh api repos/${repo}/pulls/${n}/comments\`.`,
    `3. Address every review comment that is still open: fix it, or if you disagree, reply on the PR saying why. If the branch conflicts with \`${it.baseRefName}\`, merge \`${it.baseRefName}\` in and resolve the conflicts.`,
    '4. Verify your changes the way this project does (build, typecheck, tests), then commit and push.',
    `5. Wait for the checks with \`gh pr checks ${n} --watch\` and fix anything that fails.`,
    `6. When the checks pass and no feedback is left, merge it: \`${mergeCommand(it, method, deleteBranch)}\`. If something only a person can decide is in the way, stop and tell me instead of merging.`,
  ].join('\n');
}

function fixConflictsPrompt(it: GhPull, method: GhMergeMethod, deleteBranch: boolean) {
  const n = it.number;
  const base = it.baseRefName;
  return [
    `Pull request #${n} "${it.title}" (${it.url}) has merge conflicts with \`${base}\`. Resolve them and merge it.`,
    '',
    `1. ${checkoutStep(it)}`,
    `2. Bring in the latest \`${base}\`: \`git fetch origin ${base} && git merge origin/${base}\`.`,
    `3. Resolve every conflict so both sides' changes survive. Read the PR (\`gh pr view ${n}\`) and the \`${base}\` commits that touched the same code to see what each side meant; don't just take one side.`,
    '4. Verify the result the way this project does (build, typecheck, tests), then commit the merge and push.',
    `5. Wait for the checks with \`gh pr checks ${n} --watch\` and fix anything that fails.`,
    `6. When the checks pass, merge it: \`${mergeCommand(it, method, deleteBranch)}\`. If a conflict needs a decision only a person can make, stop and tell me instead of merging.`,
  ].join('\n');
}

function pullContext(it: GhPull) {
  return `This is about pull request #${it.number} "${it.title}" (${it.url}), branch \`${it.headRefName}\` into \`${it.baseRefName}\`. Read it with \`gh pr view ${it.number} --comments\` and see its changes with \`gh pr diff ${it.number}\`.`;
}

function issueContext(it: GhIssue) {
  const repo = it.repository ? ` in ${it.repository}` : '';
  const flag = it.repository ? ` --repo ${it.repository}` : '';
  return `This is about GitHub issue #${it.number}${repo} "${it.title}" (${it.url}). Read it with \`gh issue view ${it.number} --comments${flag}\`.`;
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
      ...it.labels.slice(0, 5).map(labelChip),
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
    const w = workerForPull(store.workers.values(), it, store.issues.currentRepository ?? projectRepository(store.project));
    footBtns.replaceChildren(
      ...nodes(
      w ? h('button.btn', { type: 'button', onclick: () => actions.goToDesk(w.deskId) }, `🪑 Go to ${w.name}'s desk`) : null,
      h('button.btn', { type: 'button', title: 'Send a worker your own prompt about this PR', onclick: () => actions.ask(pullContext(it), `Ask about PR #${it.number}`) }, '✍️ Ask a worker…'),
      isOpen ? h('button.btn', { type: 'button', onclick: () => actions.assign(reviewPrompt(it), `Review PR #${it.number}`) }, '🔍 Review') : null,
      conflicts
        ? h('button.btn.primary', { type: 'button', title: 'A new worker merges the base in, resolves the conflicts, gets the checks green, then merges', onclick: handToWorker }, '✨ Fix conflicts & merge')
        : isOpen
          ? h('button.btn', { type: 'button', title: 'A worker addresses the review comments, gets the checks green, then merges', onclick: handToWorker }, '🤖 Fix comments & merge')
          : null,
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
    conv.replaceChildren();
    const col = h('div.gh-col');
    conv.append(col);
    col.append(commentCard({ id: 'body', author: it.author, body: detail?.body ?? it.body, createdAt: it.createdAt, url: it.url }, itemUrl, 'opened this'));
    if (detailError) return col.append(errorBox(detailError, loadAll));
    if (!detail) return col.append(spinnerRow('Loading the conversation…'));
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
    col.append(...items.map((x) => x.node));
    if (!items.length) col.append(h('p.gh-quiet', {}, 'No comments or reviews yet.'));

    const st = mergeStatus(d);
    const box = h('section.gh-mergebox', { class: st.cls }, h('div.gh-status', { class: st.cls }, h('span', {}, st.icon), st.text), d.checks.length ? checksList(d.checks) : null);
    if (it.state === 'OPEN' && st.can) box.append(h('div.gh-mergebox-go', {}, h('button.btn.primary', { type: 'button', onclick: () => openMerge(it, d, net, handToWorker, loadAll) }, '🔀 Merge…')));
    if (conflicted(d)) box.append(h('div.gh-mergebox-go', {}, h('button.btn.primary', { type: 'button', onclick: handToWorker }, '✨ New worker: fix conflicts & merge')));
    else if (it.state === 'OPEN' && !st.can && !d.isDraft) box.append(h('div.gh-mergebox-go', {}, h('button.btn', { type: 'button', onclick: handToWorker }, '🤖 Have a worker fix it & merge')));
    col.append(box);
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
  const modal: Modal = openModal(el, { onClose: unsub });
  close.addEventListener('click', () => modal.close());
  renderFrame();
  setupFiles();
  loadAll();
  setTimeout(() => el.focus({ preventScroll: true }), 30);
}

// ---- The issue window -----------------------------------------------------------------------------

export function openIssue(it: GhIssue, actions: BoardActions) {
  const itemUrl = it.url;
  let detail: GhIssueDetail | null = null;
  let error = '';
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const conv = h('div.gh-conv');
  const projectHint = h('span.repo-project-hint', {}, it.repository ? '📁 finding checkout…' : '');
  const [word, cls] = it.state === 'OPEN' ? ['open', 'done'] : ['closed', 'offline'];
  const task = store.taskForIssue(it.number, it.repository);
  const onQueue = !!task && task.status !== 'done';
  const queueProvider = it.state === 'OPEN' ? providerPicker(store.project, `issue-provider-${it.repository ?? 'current'}-${it.number}`, 'Queue provider') : null;
  queueProvider?.element.classList.toggle('hidden', onQueue);
  const addIssueToQueue = () => {
    if (queueProvider && !queueProvider.valid()) return;
    modal.close();
    actions.queue(issuePrompt(it), `#${it.number} ${it.title}`, it.number, queueProvider?.value(), queueProvider?.model(), it.repository);
  };
  const queue =
    it.state === 'OPEN'
      ? h(
          'button.btn',
          { type: 'button', disabled: onQueue, title: onQueue ? undefined : 'A worker picks it up by itself when a desk is free and there is room under the worker limit', onclick: addIssueToQueue },
          onQueue ? (task!.status === 'running' ? `🤖 ${task!.workerName ?? 'A worker'} is on it` : '📋 On the queue') : '📋 Add to queue',
        )
      : null;
  const el = h(
    'div.modal.gh-window.issue',
    { role: 'dialog', 'aria-label': `Issue ${it.repository ?? 'current project'} #${it.number}` },
    h('header', {}, h('span.pill', { class: cls }, word), h('h2', { title: it.title }, `${it.repository ?? 'Current project'} · #${it.number} ${it.title}`), close),
    h(
      'div.gh-meta',
      {},
      avatar(it.author),
      h('b', {}, it.author),
      h('span', {}, `opened this ${timeAgo(it.createdAt)}`),
      it.assignees.length ? h('span', {}, `· 👤 ${it.assignees.join(', ')}`) : null,
      projectHint,
      ...it.labels.slice(0, 6).map(labelChip),
    ),
    h('div.gh-body', {}, conv),
    h(
      'footer',
      {},
      h('a.grow', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on GitHub ↗'),
      h('button.btn', { type: 'button', title: 'Send a worker your own prompt about this issue', onclick: () => actions.ask(issueContext(it), `Ask about issue #${it.number}`, it.repository) }, '✍️ Ask a worker…'),
      queueProvider?.element ?? null,
      queue,
      h('button.btn.primary', { type: 'button', onclick: () => actions.assign(issuePrompt(it), `Hand issue #${it.number} to a worker`, it.repository) }, '🤖 Hand to a worker'),
    ),
  );
  const render = () => {
    const col = h('div.gh-col', {}, commentCard({ id: 'body', author: it.author, body: detail?.body ?? it.body, createdAt: it.createdAt, url: it.url }, itemUrl, 'opened this'));
    if (error) col.append(errorBox(error, load));
    else if (!detail) col.append(spinnerRow('Loading comments…'));
    else if (!detail.comments.length) col.append(h('p.gh-quiet', {}, 'No comments yet.'));
    else col.append(...detail.comments.map((c) => commentCard(c, itemUrl, 'commented')));
    conv.replaceChildren(col);
  };
  function load() {
    error = '';
    render();
    getJson<GhIssueDetail>(`/api/gh/issue?number=${it.number}${it.repository ? `&repository=${encodeURIComponent(it.repository)}` : ''}`)
      .then((d) => (detail = d))
      .catch((err) => (error = (err as Error).message))
      .finally(render);
  }
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  load();
  if (it.repository) {
    lookupIssueProject(it.repository)
      .then((project) => {
        projectHint.textContent = project ? `📁 ${project.dir}` : '📁 checkout selected when work starts';
        projectHint.title = project?.dir ?? '';
      })
      .catch(() => {
        projectHint.textContent = '📁 checkout selected when work starts';
      });
  }
}
