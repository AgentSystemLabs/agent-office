import { changedImageType, type ChangedFile, type ChangesState, type ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';
import { confirmDialog, openPrompt } from './prompt';

// The Changes window at a desk: the files a worker changed and their diff against the branch the
// office was opened on, refreshed while the worker works, with commit / discard / open-a-PR.

let current: { workerId: string; modal: Modal } | null = null;
const listeners = new Set<(msg: ServerMsg) => void>();

/** Main feeds every server message through here so the open window can pick its own. */
export function routeChangesMessage(msg: ServerMsg) {
  listeners.forEach((fn) => fn(msg));
}

/** Whose changes are on screen, so a reconnect can watch them again. */
export function openChangesFor(): string | null {
  return current?.workerId ?? null;
}

const STATUS_WORD: Record<ChangedFile['status'], string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', T: 'type changed', '?': 'new file' };

function plusMinus(a: number, d: number, binary = false): HTMLElement {
  if (binary) return h('span.pm', {}, h('span.bin', {}, 'binary'));
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
  if (truncated) out.append(h('div.dl.meta', {}, h('span.ln'), h('span.ln'), h('span.code', {}, '… the rest of this diff is too long to show here')));
  return out;
}

/** Where one side of a changed picture loads from. The file's signature makes a new URL whenever it changes. */
function imageUrl(workerId: string, f: ChangedFile, side: 'old' | 'new'): string {
  const q = new URLSearchParams({ floor: store.floor ?? '', worker: workerId, path: f.path, side, v: f.sig });
  return `/api/changes/file?${q}`;
}

/** A changed picture, before and after; new and deleted files only have the one side. */
function renderPreview(workerId: string, f: ChangedFile): HTMLElement {
  const sides: ('old' | 'new')[] = f.status === '?' || f.status === 'A' ? ['new'] : f.status === 'D' ? ['old'] : ['old', 'new'];
  return h(
    'div.img-preview',
    {},
    ...sides.map((side) => {
      const label = side === 'old' ? 'Before' : 'After';
      const size = h('span.size');
      const frame = h('div.img-frame');
      const img = h('img', { src: imageUrl(workerId, f, side), alt: `${side === 'old' ? f.from ?? f.path : f.path} (${label.toLowerCase()})` });
      img.addEventListener('load', () => (size.textContent = `${img.naturalWidth} × ${img.naturalHeight}`));
      img.addEventListener('error', () => frame.replaceChildren(h('p', {}, `Couldn't load the picture ${side === 'old' ? 'from before' : 'as it is now'}.`)));
      frame.append(img);
      return h('figure', {}, h('figcaption', {}, h('b', {}, label), size), frame);
    }),
  );
}

export function openChanges(net: Net, workerId: string, onTerminal?: () => void) {
  if (current?.workerId === workerId) return;
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
  const title = h('h2', {}, `${info.name} · changes`);
  const branch = h('span.branch');
  const terminalBtn = h('button.btn', { type: 'button', title: 'Open the terminal instead' }, '⌨️ Terminal');
  const closeBtn = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const filesHead = h('h4', {}, 'Changed files');
  const list = h('ul', { role: 'listbox', 'aria-label': 'Changed files' });
  const files = h('aside.changes-files', {}, filesHead, list);
  const diffHead = h('div.dh');
  const diffBody = h('div.diff-scroll');
  const diff = h('section.changes-diff', {}, diffHead, diffBody);
  const summary = h('span.grow');
  const discardBtn = h('button.btn', { type: 'button', title: 'Throw away every uncommitted change in this checkout' }, '🗑️ Discard all');
  const commitBtn = h('button.btn', { type: 'button', title: 'git add -A && git commit' }, '✅ Commit…');
  const prSlot = h('span.pr-slot');
  const el = h(
    'div.modal.desk-changes',
    { role: 'dialog', 'aria-label': `${info.name}'s changes`, tabindex: -1 },
    h('header', {}, dot, title, branch, onTerminal ? terminalBtn : null, closeBtn),
    h('div.changes-body', {}, files, diff),
    h('footer', {}, summary, discardBtn, commitBtn, prSlot),
  );

  const where = () => (state?.dir ? state.dir : 'the project folder');

  const requestDiff = () => {
    const f = state?.files.find((x) => x.path === selected);
    if (!selected || !f) return;
    loading = true;
    requestedSig = f.sig;
    net.send({ t: 'changes.diff', workerId, path: selected });
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
    if (state.error) return diffBody.replaceChildren(h('div.changes-empty', {}, h('div.big', {}, '🚧'), h('p', {}, `Couldn't read ${where()}: ${state.error}`)));
    diffBody.replaceChildren(
      h(
        'div.changes-empty',
        {},
        h('div.big', {}, '🌱'),
        h('p', {}, state.base === 'HEAD' ? `Nothing uncommitted in ${where()}.` : `${info.name} hasn't changed anything since ${state.base} yet.`),
        h('p.note', {}, 'This window follows the checkout as the worker works, so changes show up here as they are made.'),
      ),
    );
  };

  const renderList = () => {
    const s = state;
    list.replaceChildren();
    if (!s) return;
    const n = s.files.length;
    filesHead.textContent = n ? `${n}${s.more ? '+' : ''} changed file${n > 1 || s.more ? 's' : ''}` : 'Changed files';
    for (const f of s.files) {
      const li = h(
        'li',
        { class: f.path === selected ? 'on' : '', role: 'option', 'aria-selected': f.path === selected ? 'true' : 'false', tabindex: -1, onclick: () => select(f.path) },
        h('span.st', { class: f.status === '?' ? 'A' : f.status, title: STATUS_WORD[f.status] }, f.status === '?' ? 'A' : f.status),
        pathLabel(f.path),
        f.uncommitted ? h('span.dirty', { title: 'Not committed yet' }) : null,
        plusMinus(f.additions, f.deletions, f.binary),
      );
      list.append(li);
    }
    if (s.more) list.append(h('li.empty', {}, `…and ${s.more} more`));
    list.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  };

  const renderDiffHead = () => {
    const f = state?.files.find((x) => x.path === selected);
    if (!f) return diffHead.replaceChildren();
    const discardOne = h('button.btn', { type: 'button', title: 'Throw away the uncommitted changes to this file' }, '↩︎ Discard');
    discardOne.addEventListener('click', () =>
      confirmDialog(`Discard the changes to ${f.path.split('/').pop()}?`, `This puts ${f.path} back to the last commit in ${where()}. ${f.status === '?' ? 'The file is deleted.' : 'Committed changes stay.'}`, 'Discard', () =>
        net.send({ t: 'changes.discard', workerId, path: f.path }),
      ),
    );
    diffHead.replaceChildren(
      h('span.st', { class: f.status === '?' ? 'A' : f.status }, f.status === '?' ? 'A' : f.status),
      h('span.path', { title: f.path }, f.from ? `${f.from} → ${f.path}` : f.path),
      h('span.word', {}, f.uncommitted ? `${STATUS_WORD[f.status]} · not committed` : STATUS_WORD[f.status]),
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
      bits.push(uncommitted ? `${uncommitted} uncommitted` : s.files.length ? 'all committed' : '');
      if (s.ahead) bits.push(`${s.ahead} commit${s.ahead > 1 ? 's' : ''} ahead of ${s.base}`);
      if (!s.dir) bits.push(h('span', { title: "This worker works in the project folder itself, so this is everything uncommitted there — everyone's edits, not just its own." }, '📁 shared project folder'));
      else bits.push(h('span', { title: `Its own worktree at ${s.dir}` }, `📁 ${s.dir}`));
      summary.append(...bits.filter(Boolean).map((b) => (typeof b === 'string' ? h('span', {}, b) : b)));
    }
    discardBtn.disabled = busy || !uncommitted;
    commitBtn.disabled = busy || !uncommitted;
    commitBtn.textContent = uncommitted ? `✅ Commit ${uncommitted} file${uncommitted > 1 ? 's' : ''}…` : '✅ Commit…';
    prSlot.replaceChildren();
    if (!s) return;
    if (s.pr) prSlot.append(h('a.btn.primary', { href: s.pr.url, target: '_blank', rel: 'noopener', title: 'Open on GitHub' }, `🔀 PR #${s.pr.number} ↗`));
    else if (s.prBase) {
      const why = busy ? '' : uncommitted ? 'Commit first' : !s.ahead ? `Nothing on ${s.branch} that ${s.prBase} lacks yet` : '';
      const pr = h('button.btn.primary', { type: 'button', title: why || `Push ${s.branch} and open a pull request against ${s.prBase}` }, '🔀 Open PR…');
      pr.disabled = busy || !!why;
      pr.addEventListener('click', () =>
        openPrompt({
          title: '🔀 Open a pull request',
          subtitle: `Pushes ${s.branch} to origin and opens a PR against ${s.prBase}. The first line is the title; the rest is the description.`,
          initial: s.subject ?? '',
          placeholder: 'Title',
          submitLabel: 'Open PR ↗',
          onSubmit: (text) => {
            const [first, ...rest] = text.split('\n');
            net.send({ t: 'changes.pr', workerId, title: first.trim(), body: rest.join('\n').trim() });
          },
        }),
      );
      prSlot.append(pr);
    }
  };

  const renderHeader = () => {
    const w = store.workers.get(workerId);
    if (w) title.textContent = `${w.name} · changes`;
    const s = state;
    if (!s || s.error) branch.textContent = '';
    else branch.textContent = s.base === 'HEAD' ? `🌿 ${s.branch} · uncommitted changes` : `🌿 ${s.branch} · vs ${s.base}`;
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
    if (msg.t === 'changes' && msg.state.workerId === workerId) onState(msg.state);
    else if (msg.t === 'changes.diff' && msg.workerId === workerId && msg.path === selected) {
      loading = false;
      shownSig = requestedSig;
      const f = state?.files.find((x) => x.path === selected);
      const text = msg.error ? h('div.changes-empty', {}, h('p', {}, msg.error)) : renderDiff(msg.diff, msg.truncated);
      const type = f ? changedImageType(f.path) : undefined;
      // A picture's diff only says it differs, so show the picture instead. An SVG is text too: its diff stays below.
      if (f && type) diffBody.replaceChildren(renderPreview(workerId, f), ...(type === 'image/svg+xml' ? [text] : []));
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
      `Discard all uncommitted changes at ${info.name}'s desk?`,
      `This puts ${n} file${n === 1 ? '' : 's'} in ${where()} back to the last commit and deletes new files. Commits stay.${state?.dir ? '' : " That folder is shared: anyone's uncommitted edits there go too."}`,
      'Discard everything',
      () => net.send({ t: 'changes.discard', workerId }),
    );
  });
  commitBtn.addEventListener('click', () => {
    const n = state?.files.filter((f) => f.uncommitted).length ?? 0;
    openPrompt({
      title: `✅ Commit ${n} file${n === 1 ? '' : 's'}`,
      subtitle: `Stages everything in ${where()} and commits it${state?.branch ? ` on ${state.branch}` : ''}.`,
      placeholder: 'What changed, and why',
      submitLabel: 'Commit',
      onSubmit: (text) => net.send({ t: 'changes.commit', workerId, message: text }),
    });
  });
  terminalBtn.addEventListener('click', () => {
    onTerminal?.();
    modal.close();
  });

  listeners.add(onMsg);
  const unsub = store.on('workers', () => {
    if (!store.workers.has(workerId)) modal.close();
    else renderHeader();
  });
  const modal = openModal(el, {
    doing: `🌿 looking over ${info.name}'s changes`,
    onClose: () => {
      listeners.delete(onMsg);
      unsub();
      net.send({ t: 'changes.unwatch', workerId });
      if (current?.modal === modal) current = null;
    },
  });
  current = { workerId, modal };
  previous?.modal.close();
  closeBtn.addEventListener('click', () => modal.close());
  renderHeader();
  renderFooter();
  renderEmpty();
  net.send({ t: 'changes.watch', workerId });
  setTimeout(() => el.focus(), 30);
}
