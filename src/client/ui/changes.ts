import './changes.css';
import { changedImageType, type ChangedFile, type ChangesState, type ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';
import { confirmDialog, openPrompt } from './prompt';

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
      const label = side === 'old' ? "변경 전" : "변경 후";
      const size = h('span.size');
      const frame = h('div.img-frame');
      const img = h('img', { src: imageUrl(workerId, repo, f, side), alt: `${side === 'old' ? f.from ?? f.path : f.path} (${label.toLowerCase()})` });
      img.addEventListener('load', () => (size.textContent = `${img.naturalWidth} × ${img.naturalHeight}`));
      img.addEventListener('error', () => frame.replaceChildren(h('p', {}, `${side === 'old' ? "변경 전" : "현재 상태"} 이미지를 불러올 수 없습니다.`)));
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
  const title = h('h2', {}, `${info.name} · 변경 사항`);
  const branch = h('span.branch');
  const terminalBtn = h('button.btn', { type: 'button', title: "터미널에서 보기" }, "⌨️ 터미널");
  const closeBtn = h('button.btn.close', { 'aria-label': "닫기" }, '✕');
  const filesHead = h('h4', {}, "변경된 파일");
  const list = h('ul', { role: 'listbox', 'aria-label': "변경된 파일" });
  const files = h('aside.changes-files', {}, filesHead, list);
  const diffHead = h('div.dh');
  const diffBody = h('div.diff-scroll');
  const diff = h('section.changes-diff', {}, diffHead, diffBody);
  const summary = h('span.grow');
  const discardBtn = h('button.btn', { type: 'button', title: "이 작업 폴더의 커밋하지 않은 변경 사항 모두 삭제" }, "🗑️ 변경 모두 취소");
  const commitBtn = h('button.btn', { type: 'button', title: 'git add -A && git commit' }, "✅ 커밋…");
  const prSlot = h('span.pr-slot');
  const tabs = h('nav.changes-tabs', { role: 'tablist', 'aria-label': "저장소 목록" });
  const el = h(
    'div.modal.desk-changes',
    { role: 'dialog', 'aria-label': `${info.name}의 변경 사항`, tabindex: -1 },
    h('header', {}, dot, title, branch, onTerminal ? terminalBtn : null, closeBtn),
    tabs,
    h('div.changes-body', {}, files, diff),
    h('footer', {}, summary, discardBtn, commitBtn, prSlot),
  );

  const where = () => (state?.dir ? state.dir : "프로젝트 폴더");

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
    if (state.error) return diffBody.replaceChildren(h('div.changes-empty', {}, h('div.big', {}, '🚧'), h('p', {}, `${where()}을(를) 읽을 수 없습니다: ${state.error}`)));
    diffBody.replaceChildren(
      h(
        'div.changes-empty',
        {},
        h('div.big', {}, '🌱'),
        h('p', {}, state.base === 'HEAD' ? `${where()}에 커밋하지 않은 변경이 없습니다.` : `${info.name}은(는) ${state.base} 이후 아직 변경한 내용이 없습니다.`),
        h('p.note', {}, "직원이 작업하는 동안 변경 내용이 이 화면에 실시간으로 표시됩니다."),
      ),
    );
  };

  const renderList = () => {
    const s = state;
    list.replaceChildren();
    if (!s) return;
    const n = s.files.length;
    filesHead.textContent = n ? `${n}변경된 파일 ${s.more ? '+' : ''}개` : "변경된 파일";
    for (const f of s.files) {
      const li = h(
        'li',
        { class: f.path === selected ? 'on' : '', role: 'option', 'aria-selected': f.path === selected ? 'true' : 'false', tabindex: -1, onclick: () => select(f.path) },
        h('span.st', { class: f.status === '?' ? 'A' : f.status, title: STATUS_WORD[f.status] }, f.status === '?' ? 'A' : f.status),
        pathLabel(f.path),
        f.uncommitted ? h('span.dirty', { title: "아직 커밋하지 않음" }) : null,
        plusMinus(f.additions, f.deletions, f.binary),
      );
      list.append(li);
    }
    if (s.more) list.append(h('li.empty', {}, `외 ${s.more}개`));
    list.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  };

  const renderDiffHead = () => {
    const f = state?.files.find((x) => x.path === selected);
    if (!f) return diffHead.replaceChildren();
    const discardOne = h('button.btn', { type: 'button', title: "이 파일의 커밋하지 않은 변경 취소" }, "↩︎ 변경 취소");
    discardOne.addEventListener('click', () =>
      confirmDialog(`${f.path.split('/').pop()}의 변경을 취소할까요?`, `${where()}에서 ${f.path}을(를) 마지막 커밋 상태로 되돌립니다. ${f.status === '?' ? "파일이 삭제됩니다." : "이미 커밋한 내용은 유지됩니다."}`, "변경 취소", () =>
        net.send({ t: 'changes.discard', workerId, path: f.path, repo }),
      ),
    );
    diffHead.replaceChildren(
      h('span.st', { class: f.status === '?' ? 'A' : f.status }, f.status === '?' ? 'A' : f.status),
      h('span.path', { title: f.path }, f.from ? `${f.from} → ${f.path}` : f.path),
      h('span.word', {}, f.uncommitted ? `${STATUS_WORD[f.status]} · 커밋 전` : STATUS_WORD[f.status]),
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
      bits.push(uncommitted ? `커밋 전 ${uncommitted}개` : s.files.length ? "모두 커밋됨" : '');
      if (s.ahead) bits.push(`${s.base}보다 커밋 ${s.ahead}개 앞섬`);
      if (!s.dir) bits.push(h('span', { title: "이 직원은 공용 프로젝트 폴더에서 작업합니다. 여기에는 이 직원뿐 아니라 다른 참여자가 커밋하지 않은 변경도 함께 표시됩니다." }, "📁 공용 프로젝트 폴더"));
      else bits.push(h('span', { title: `전용 worktree: ${s.dir}` }, `📁 ${s.dir}`));
      summary.append(...bits.filter(Boolean).map((b) => (typeof b === 'string' ? h('span', {}, b) : b)));
    }
    discardBtn.disabled = busy || !uncommitted;
    commitBtn.disabled = busy || !uncommitted;
    commitBtn.textContent = uncommitted ? `✅ 파일 ${uncommitted}개 커밋…` : "✅ 커밋…";
    prSlot.replaceChildren();
    if (!s) return;
    if (s.pr) prSlot.append(h('a.btn.primary', { href: s.pr.url, target: '_blank', rel: 'noopener', title: "GitHub에서 열기" }, `🔀 PR #${s.pr.number} ↗`));
    else if (s.prBase) {
      const why = busy ? '' : uncommitted ? "먼저 커밋하세요" : !s.ahead ? `${s.branch}에 ${s.prBase}과(와) 다른 커밋이 아직 없습니다` : '';
      const pr = h('button.btn.primary', { type: 'button', title: why || `${s.branch}을(를) push하고 ${s.prBase}에 PR 생성` }, "🔀 PR 생성…");
      pr.disabled = busy || !!why;
      pr.addEventListener('click', () =>
        openPrompt({
          title: "🔀 Pull request 생성",
          subtitle: `${s.branch}을(를) origin에 push하고 ${s.prBase}에 PR을 생성합니다. 첫 줄은 제목, 나머지는 설명으로 사용합니다.`,
          initial: s.subject ?? '',
          placeholder: "제목",
          submitLabel: "PR 생성 ↗",
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
    if (w) title.textContent = `${w.name} · 변경 사항`;
    const s = state;
    if (!s || s.error) branch.textContent = '';
    else branch.textContent = s.base === 'HEAD' ? `🌿 ${s.branch} · 커밋하지 않은 변경` : `🌿 ${s.branch} · vs ${s.base}`;
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
      `${info.name} 책상의 커밋하지 않은 변경을 모두 취소할까요?`,
      `${where()}의 파일 ${n}개를 마지막 커밋 상태로 되돌리고 새 파일은 삭제합니다. 기존 커밋은 유지됩니다.${state?.dir ? '' : " 공용 폴더이므로 다른 참여자가 커밋하지 않은 변경도 함께 삭제됩니다."}`,
      "변경 모두 취소",
      () => net.send({ t: 'changes.discard', workerId, repo }),
    );
  });
  commitBtn.addEventListener('click', () => {
    const n = state?.files.filter((f) => f.uncommitted).length ?? 0;
    openPrompt({
      title: `✅ 파일 ${n}개 커밋`,
      subtitle: `${where()}의 모든 변경을 stage에 올려 커밋합니다${state?.branch ? ` · 브랜치 ${state.branch}` : ''}.`,
      placeholder: "변경 내용과 이유",
      submitLabel: "커밋",
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
    const own = w.worktree?.path.split(/[\\/]/).pop() ?? "이 프로젝트";
    tabs.replaceChildren(
      ...[{ id: undefined as string | undefined, name: own, pr: w.pr }, ...repos.map((r) => ({ id: r.floor as string | undefined, name: r.name, pr: r.pr }))].map((t) =>
        h(
          'button.btn',
          { type: 'button', role: 'tab', class: t.id === repo ? 'on' : '', 'aria-selected': t.id === repo ? 'true' : 'false', title: t.id ? `${t.name}의 전용 worktree` : `이 프로젝트의 전용 worktree: ${t.name}`, onclick: () => show(t.id) },
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
    doing: `🌿 ${info.name}의 변경 사항 확인 중`,
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
