import './changes.css';
import { changedImageType, type ChangedFile, type ChangesState, type ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';
import { confirmDialog, openPrompt } from './prompt';
import { L } from '../i18n';

// The Changes window at a desk: the files a worker changed and their diff against the branch the
// office was opened on, refreshed while the worker works, with commit / discard / open-a-PR.

let current: { workerId: string; repo(): string | undefined; show(repo?: string): void; modal: Modal } | null = null;
const listeners = new Set<(msg: ServerMsg) => void>();

/** Main feeds every server message through here so the open window can pick its own. */
export function routeChangesMessage(msg: ServerMsg) {
  listeners.forEach((fn) => fn(msg));
}

/** Whose changes are on screen (and which of its repositories), so a reconnect can watch them again. */
export function openChangesFor(): { workerId: string; repo?: string } | null {
  return current ? { workerId: current.workerId, repo: current.repo() } : null;
}

const STATUS_WORD: Record<ChangedFile['status'], string> = L.changes.status;

function plusMinus(a: number, d: number, binary = false): HTMLElement {
  if (binary) return h('span.pm', {}, h('span.bin', {}, L.changes.binary));
  return h('span.pm', {}, h('span.add', {}, `+${a}`), ' ', h('span.del', {}, `−${d}`));
}

/** A path with its folder dimmed, so the file name stands out in a long list. */
function pathLabel(p: string): HTMLElement {
  const i = p.lastIndexOf('/');
  return h('span.path', { title: p }, i >= 0 ? h('span.dir', {}, p.slice(0, i + 1)) : null, p.slice(i + 1));
}

/** Renders a unified diff: hunk headers, added and removed lines, with line numbers. */
function renderDiff(text: string, truncated: boolean): HTMLElement {
  const out = h('div.diff-lines');
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  for (const raw of lines) {
    let cls = 'ctx';
    let o = '';
    let n = '';
    let code = raw;
    if (raw.startsWith('@@')) {
      inHunk = true;
      cls = 'hunk';
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) {
        oldN = Number(m[1]);
        newN = Number(m[2]);
      }
    } else if (!inHunk || raw.startsWith('diff --git')) {
      inHunk = false;
      // The file names are already in the header; keep only the lines that say something else.
      if (/^(diff --git|index |--- |\+\+\+ |similarity index)/.test(raw)) continue;
      cls = 'meta';
    } else if (raw.startsWith('+')) {
      cls = 'add';
      n = String(newN++);
      code = raw.slice(1);
    } else if (raw.startsWith('-')) {
      cls = 'del';
      o = String(oldN++);
      code = raw.slice(1);
    } else if (raw.startsWith('\\')) cls = 'meta';
    else {
      o = String(oldN++);
      n = String(newN++);
      code = raw.slice(1);
    }
    out.append(h('div.dl', { class: cls }, h('span.ln', {}, o), h('span.ln', {}, n), h('span.code', {}, code)));
  }
  if (truncated) out.append(h('div.dl.meta', {}, h('span.ln'), h('span.ln'), h('span.code', {}, L.changes.tooLong)));
  return out;
}

/** Where one side of a changed picture loads from. The file's signature makes a new URL whenever it changes. */
function imageUrl(workerId: string, repo: string | undefined, f: ChangedFile, side: 'old' | 'new'): string {
  const q = new URLSearchParams({ floor: store.floor ?? '', worker: workerId, path: f.path, side, v: f.sig, ...(repo ? { repo } : {}) });
  return `/api/changes/file?${q}`;
}

/** A changed picture, before and after; new and deleted files only have the one side. */
function renderPreview(workerId: string, repo: string | undefined, f: ChangedFile): HTMLElement {
  const sides: ('old' | 'new')[] = f.status === '?' || f.status === 'A' ? ['new'] : f.status === 'D' ? ['old'] : ['old', 'new'];
  return h(
    'div.img-preview',
    {},
    ...sides.map((side) => {
      const label = side === 'old' ? L.changes.before : L.changes.after;
      const size = h('span.size');
      const frame = h('div.img-frame');
      const img = h('img', { src: imageUrl(workerId, repo, f, side), alt: `${side === 'old' ? f.from ?? f.path : f.path} (${label.toLowerCase()})` });
      img.addEventListener('load', () => (size.textContent = `${img.naturalWidth} × ${img.naturalHeight}`));
      img.addEventListener('error', () => frame.replaceChildren(h('p', {}, side === 'old' ? L.changes.imgBefore : L.changes.imgNow)));
      frame.append(img);
      return h('figure', {}, h('figcaption', {}, h('b', {}, label), size), frame);
    }),
  );
}

/**
 * The Changes window for a worker. A worker across repositories (see WorkerInfo.repos) gets a tab per
 * repository, its own floor's first; `repo` opens on another floor's one.
 */
export function openChanges(net: Net, workerId: string, onTerminal?: () => void, repo?: string) {
  if (current?.workerId === workerId) return current.show(repo);
  const info = store.workers.get(workerId);
  if (!info) return;
  const previous = current;

  let state: ChangesState | null = null;
  let selected: string | null = null;
  /** The signature the shown diff was fetched for; a new one means the file changed underneath. */
  let shownSig: string | null = null;
  let requestedSig = '';
  let loading = false;

  const dot = h('span.dot', { style: `background:${info.color}` });
  const title = h('h2', {}, L.changes.header(info.name));
  const branch = h('span.branch');
  const terminalBtn = h('button.btn', { type: 'button', title: L.changes.terminalTip }, '⌨️ Terminal');
  const closeBtn = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const filesHead = h('h4', {}, L.changes.files);
  const list = h('ul', { role: 'listbox', 'aria-label': L.changes.files });
  const files = h('aside.changes-files', {}, filesHead, list);
  const diffHead = h('div.dh');
  const diffBody = h('div.diff-scroll');
  const diff = h('section.changes-diff', {}, diffHead, diffBody);
  const summary = h('span.grow');
  const discardBtn = h('button.btn', { type: 'button', title: L.changes.discardAllTip }, L.changes.discardAll);
  const commitBtn = h('button.btn', { type: 'button', title: 'git add -A && git commit' }, L.changes.commitDots);
  const prSlot = h('span.pr-slot');
  const tabs = h('nav.changes-tabs', { role: 'tablist', 'aria-label': L.elevator.repositories });
  const el = h(
    'div.modal.desk-changes',
    { role: 'dialog', 'aria-label': L.changes.of(info.name), tabindex: -1 },
    h('header', {}, dot, title, branch, onTerminal ? terminalBtn : null, closeBtn),
    tabs,
    h('div.changes-body', {}, files, diff),
    h('footer', {}, summary, discardBtn, commitBtn, prSlot),
  );

  const where = () => (state?.dir ? state.dir : L.changes.projectFolder);

  const requestDiff = () => {
    const f = state?.files.find((x) => x.path === selected);
    if (!selected || !f) return;
    loading = true;
    requestedSig = f.sig;
    net.send({ t: 'changes.diff', workerId, path: selected, repo });
  };

  const select = (p: string | null) => {
    if (p === selected) return;
    selected = p;
    shownSig = null;
    renderList();
    renderDiffHead();
    diffBody.replaceChildren();
    if (p) requestDiff();
    else renderEmpty();
  };

  const renderEmpty = () => {
    diffHead.replaceChildren();
    if (!state) return diffBody.replaceChildren(h('div.changes-empty', {}, h('div.spinner')));
    if (state.error) return diffBody.replaceChildren(h('div.changes-empty', {}, h('div.big', {}, '🚧'), h('p', {}, L.changes.couldntRead(where(), state.error))));
    diffBody.replaceChildren(
      h(
        'div.changes-empty',
        {},
        h('div.big', {}, '🌱'),
        h('p', {}, state.base === 'HEAD' ? L.changes.nothingIn(where()) : L.changes.nothingSince(info.name, state.base)),
        h('p.note', {}, L.changes.follows),
      ),
    );
  };

  const renderList = () => {
    const s = state;
    list.replaceChildren();
    if (!s) return;
    const n = s.files.length;
    filesHead.textContent = n ? L.changes.nFiles(`${n}${s.more ? '+' : ''}`, n > 1 || !!s.more) : L.changes.files;
    for (const f of s.files) {
      const li = h(
        'li',
        { class: f.path === selected ? 'on' : '', role: 'option', 'aria-selected': f.path === selected ? 'true' : 'false', tabindex: -1, onclick: () => select(f.path) },
        h('span.st', { class: f.status === '?' ? 'A' : f.status, title: STATUS_WORD[f.status] }, f.status === '?' ? 'A' : f.status),
        pathLabel(f.path),
        f.uncommitted ? h('span.dirty', { title: L.changes.notYet }) : null,
        plusMinus(f.additions, f.deletions, f.binary),
      );
      list.append(li);
    }
    if (s.more) list.append(h('li.empty', {}, L.changes.andMore(s.more)));
    list.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  };

  const renderDiffHead = () => {
    const f = state?.files.find((x) => x.path === selected);
    if (!f) return diffHead.replaceChildren();
    const discardOne = h('button.btn', { type: 'button', title: L.changes.discardOneTip }, L.changes.discardOne);
    discardOne.addEventListener('click', () =>
      confirmDialog(L.changes.discardQ(f.path.split('/').pop() ?? f.path), `${L.changes.putsBack(f.path, where())} ${f.status === '?' ? L.changes.fileDeleted : L.changes.committedStay}`, L.changes.discard, () =>
        net.send({ t: 'changes.discard', workerId, path: f.path, repo }),
      ),
    );
    diffHead.replaceChildren(
      h('span.st', { class: f.status === '?' ? 'A' : f.status }, f.status === '?' ? 'A' : f.status),
      h('span.path', { title: f.path }, f.from ? `${f.from} → ${f.path}` : f.path),
      h('span.word', {}, f.uncommitted ? `${STATUS_WORD[f.status]} · ${L.changes.notCommitted}` : STATUS_WORD[f.status]),
      plusMinus(f.additions, f.deletions, f.binary),
    );
    if (f.uncommitted && !state?.busy) diffHead.append(discardOne);
  };

  const renderFooter = () => {
    const s = state;
    const busy = !!s?.busy;
    const uncommitted = s?.files.filter((f) => f.uncommitted).length ?? 0;
    const adds = s?.files.reduce((n, f) => n + f.additions, 0) ?? 0;
    const dels = s?.files.reduce((n, f) => n + f.deletions, 0) ?? 0;
    summary.replaceChildren();
    if (busy) summary.append(h('span.spinner'), h('span', {}, s!.busy!));
    else if (s && !s.error) {
      const bits: (string | HTMLElement)[] = [];
      if (s.files.length) bits.push(plusMinus(adds, dels));
      bits.push(uncommitted ? L.changes.uncommitted(uncommitted) : s.files.length ? L.changes.allCommitted : '');
      if (s.ahead) bits.push(L.changes.aheadOf(s.ahead, s.base));
      if (!s.dir) bits.push(h('span', { title: L.changes.sharedTip }, L.changes.shared));
      else bits.push(h('span', { title: L.changes.ownWorktree(s.dir) }, `📁 ${s.dir}`));
      summary.append(...bits.filter(Boolean).map((b) => (typeof b === 'string' ? h('span', {}, b) : b)));
    }
    discardBtn.disabled = busy || !uncommitted;
    commitBtn.disabled = busy || !uncommitted;
    commitBtn.textContent = uncommitted ? `${L.changes.commitN(uncommitted)}…` : L.changes.commitDots;
    prSlot.replaceChildren();
    if (!s) return;
    if (s.pr) prSlot.append(h('a.btn.primary', { href: s.pr.url, target: '_blank', rel: 'noopener', title: L.changes.openGithub }, `🔀 PR #${s.pr.number} ↗`));
    else if (s.prBase) {
      const why = busy ? '' : uncommitted ? L.changes.commitFirst : !s.ahead ? L.changes.nothingNew(s.branch, s.prBase) : '';
      const pr = h('button.btn.primary', { type: 'button', title: why || L.changes.pushTip(s.branch, s.prBase) }, L.changes.openPrDots);
      pr.disabled = busy || !!why;
      pr.addEventListener('click', () =>
        openPrompt({
          title: L.changes.openPrTitle,
          subtitle: L.changes.openPrSub(s.branch, s.prBase),
          initial: s.subject ?? '',
          placeholder: L.changes.title,
          submitLabel: L.changes.openPrGo,
          onSubmit: (text) => {
            const [first, ...rest] = text.split('\n');
            net.send({ t: 'changes.pr', workerId, title: first.trim(), body: rest.join('\n').trim(), repo });
          },
        }),
      );
      prSlot.append(pr);
    }
  };

  const renderHeader = () => {
    const w = store.workers.get(workerId);
    if (w) title.textContent = L.changes.header(w.name);
    const s = state;
    if (!s || s.error) branch.textContent = '';
    else branch.textContent = s.base === 'HEAD' ? `🌿 ${s.branch} · ${L.changes.uncommittedChanges}` : `🌿 ${s.branch} · vs ${s.base}`;
  };

  const onState = (s: ChangesState) => {
    state = s;
    renderHeader();
    renderFooter();
    const f = selected ? s.files.find((x) => x.path === selected) : undefined;
    if (!f) {
      selected = null;
      shownSig = null;
      renderList();
      if (s.files.length) select(s.files[0].path);
      else renderEmpty();
      return;
    }
    renderList();
    renderDiffHead();
    if (shownSig !== null && shownSig !== f.sig && !loading) requestDiff();
  };

  const onMsg = (msg: ServerMsg) => {
    if (msg.t === 'changes' && msg.state.workerId === workerId && msg.state.repo === repo) onState(msg.state);
    else if (msg.t === 'changes.diff' && msg.workerId === workerId && msg.repo === repo && msg.path === selected) {
      loading = false;
      shownSig = requestedSig;
      const f = state?.files.find((x) => x.path === selected);
      const text = msg.error ? h('div.changes-empty', {}, h('p', {}, msg.error)) : renderDiff(msg.diff, msg.truncated);
      const type = f ? changedImageType(f.path) : undefined;
      // A picture's diff only says it differs, so show the picture instead. An SVG is text too: its diff stays below.
      if (f && type) diffBody.replaceChildren(renderPreview(workerId, repo, f), ...(type === 'image/svg+xml' ? [text] : []));
      else diffBody.replaceChildren(text);
      // The file changed again while the diff was on its way: fetch the fresh one.
      if (f && f.sig !== shownSig) requestDiff();
    }
  };

  const move = (delta: number) => {
    if (!state?.files.length) return;
    const i = state.files.findIndex((f) => f.path === selected);
    const next = state.files[Math.max(0, Math.min(state.files.length - 1, i + delta))];
    if (next) select(next.path);
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'j') move(1);
    else if (e.key === 'ArrowUp' || e.key === 'k') move(-1);
    else return;
    e.preventDefault();
  });

  discardBtn.addEventListener('click', () => {
    const n = state?.files.filter((f) => f.uncommitted).length ?? 0;
    confirmDialog(
      L.changes.discardAllQ(info.name),
      `${L.changes.discardAllBody(n, where())}${state?.dir ? '' : L.changes.sharedGoes}`,
      L.changes.discardEverything,
      () => net.send({ t: 'changes.discard', workerId, repo }),
    );
  });
  commitBtn.addEventListener('click', () => {
    const n = state?.files.filter((f) => f.uncommitted).length ?? 0;
    openPrompt({
      title: L.changes.commitN(n),
      subtitle: L.changes.stages(where(), state?.branch),
      placeholder: L.changes.whatChanged,
      submitLabel: L.changes.commit,
      onSubmit: (text) => net.send({ t: 'changes.commit', workerId, message: text, repo }),
    });
  });
  terminalBtn.addEventListener('click', () => {
    onTerminal?.();
    modal.close();
  });

  /** Across repositories: a tab per repository, its own floor's first (no repo), each followed on its own. */
  const renderTabs = () => {
    const w = store.workers.get(workerId) ?? info;
    const repos = w.repos ?? [];
    tabs.classList.toggle('hidden', !repos.length);
    if (!repos.length) return tabs.replaceChildren();
    const own = w.worktree?.path.split(/[\\/]/).pop() ?? L.changes.thisProject;
    tabs.replaceChildren(
      ...[{ id: undefined as string | undefined, name: own, pr: w.pr }, ...repos.map((r) => ({ id: r.floor as string | undefined, name: r.name, pr: r.pr }))].map((t) =>
        h(
          'button.btn',
          { type: 'button', role: 'tab', class: t.id === repo ? 'on' : '', 'aria-selected': t.id === repo ? 'true' : 'false', title: t.id ? L.changes.worktreeOf(t.name) : L.changes.worktreeHere(t.name), onclick: () => show(t.id) },
          `📁 ${t.name}`,
          t.pr ? h('small', {}, ` · #${t.pr.number}`) : null,
        ),
      ),
    );
  };

  /** Switches to another of its repositories: stops following the one on screen and follows that one. */
  const show = (next?: string) => {
    if (next === repo || (next && !store.workers.get(workerId)?.repos?.some((r) => r.floor === next))) return;
    net.send({ t: 'changes.unwatch', workerId, repo });
    repo = next;
    state = null;
    selected = null;
    shownSig = null;
    loading = false;
    renderTabs();
    renderHeader();
    renderList();
    renderFooter();
    renderEmpty();
    net.send({ t: 'changes.watch', workerId, repo });
  };

  listeners.add(onMsg);
  const unsub = store.on('workers', () => {
    if (!store.workers.has(workerId)) modal.close();
    else {
      renderHeader();
      renderTabs();
    }
  });
  const modal = openModal(el, {
    doing: L.changes.doing(info.name),
    onClose: () => {
      listeners.delete(onMsg);
      unsub();
      net.send({ t: 'changes.unwatch', workerId, repo });
      if (current?.modal === modal) current = null;
    },
  });
  current = { workerId, repo: () => repo, show, modal };
  previous?.modal.close();
  closeBtn.addEventListener('click', () => modal.close());
  if (repo && !info.repos?.some((r) => r.floor === repo)) repo = undefined;
  renderTabs();
  renderHeader();
  renderFooter();
  renderEmpty();
  net.send({ t: 'changes.watch', workerId, repo });
  setTimeout(() => el.focus(), 30);
}
