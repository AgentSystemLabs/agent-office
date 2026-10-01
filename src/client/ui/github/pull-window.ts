import './windows.css';
import type { GhPull, GhPullDetail, GhReviewComment } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store, workerForPull } from '../../state';
import { h, openModal, type Modal } from '../dom';
import { officePrompt } from '../prompts';
import { getJson, getText } from './api';
import { openClose } from './close';
import { commentBox } from './comment-box';
import { labelButton, labelChip } from './labels';
import { checksList, conflicted, mergeStatus, openMerge } from './merge';
import { avatar, commentCard, errorBox, nodes, REVIEW_BADGE, spinnerRow, stateOf } from './pieces';
import { FILES_KEY, mergePref, pref, savePref, TAB_KEY } from './prefs';
import { fixAndMergePrompt, fixConflictsPrompt, pullContext, pullVars, reviewPrompt, type BoardActions } from './prompts';
import { buildTree, looksGenerated, parseDiff, renderFileDiff, renderThread, repliesOf, Reviewed, STATUS_WORD, treeOrder, type DiffFile, type TreeDir } from './pulldiff';

// The window behind a card on the PR board. A PR opens on its conversation (description, comments,
// reviews, line comments, checks) with a Files tab for the diff, where you tick files off as
// reviewed; from here you comment, label, merge or close it, or hand it to a worker to review, fix up and merge.

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
