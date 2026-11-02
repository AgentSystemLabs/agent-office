import './github/windows.css';
import './boards.css';
import type { BoardCard, BoardCardDetail, CustomBoardDef, CustomBoardState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, toast } from './dom';
import { markdown } from './markdown';
import { providerPicker } from './provider';
import type { BoardActions } from './github/prompts';
import { NOTE_COLORS, TILTS } from './boards-colors';

export function cardPrompt(it: BoardCard): string {
  const parts = [`# Task: [${it.id}] ${it.title}`];
  if (it.url) parts.push(`Link: ${it.url}`);
  if (it.type) parts.push(`Type: ${it.type}`);
  if (it.priority) parts.push(`Priority: ${it.priority}`);
  if (it.parent) parts.push(`Parent: [${it.parent.key || it.parent.id}] ${it.parent.title || ''}`);
  if (it.storyPoints !== undefined) parts.push(`Story Points: ${it.storyPoints}`);
  if (it.column) parts.push(`Status: ${it.column}`);
  if (it.assignees?.length) parts.push(`Assignees: ${it.assignees.join(', ')}`);
  else if (it.author) parts.push(`Reporter: ${it.author}`);
  if (it.body) parts.push(`\n## Description\n${it.body}`);
  return parts.join('\n');
}

function isAssignedToUser(card: BoardCard, currentUser?: { displayName?: string; email?: string; name?: string }, configEmail?: string): boolean {
  if (!card.assignees?.length) return false;
  const myNames: string[] = [];
  if (currentUser?.displayName) myNames.push(currentUser.displayName.toLowerCase());
  if (currentUser?.name) myNames.push(currentUser.name.toLowerCase());
  for (const em of [currentUser?.email, configEmail]) {
    if (em) { myNames.push(em.toLowerCase(), em.split('@')[0].toLowerCase().replace(/[._-]/g, ' ')); }
  }
  if (store.profile?.name && store.profile.name !== 'Guest') myNames.push(store.profile.name.toLowerCase());
  return card.assignees.some((assignee) => {
    const a = assignee.toLowerCase();
    return myNames.some((n) => a === n || (a.includes(' ') && n.includes(' ') && a.split(' ').every((w) => n.includes(w))));
  });
}

export function openCustomBoard(boardId: string, net: Net, actions: BoardActions) {
  const currentFloor = store.currentFloor();
  const floorId = store.floor ?? currentFloor?.id ?? '';

  let filterMine = false;
  let cachedConfigEmail = '';

  fetch(`/api/boards/config?board=${encodeURIComponent(boardId)}&floor=${encodeURIComponent(floorId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d?.config?.email) {
        cachedConfigEmail = String(d.config.email);
        if (filterMine) render();
      }
    })
    .catch(() => {});

  const body = h('div.body');
  const status = h('span.board-status', { style: 'margin-left:auto;' });
  const filterMineBtn = h(
    'button.btn',
    {
      type: 'button',
      'aria-pressed': 'false',
      title: 'Filter only tickets assigned to me',
      onclick: () => {
        filterMine = !filterMine;
        filterMineBtn.classList.toggle('primary', filterMine);
        filterMineBtn.setAttribute('aria-pressed', String(filterMine));
        render();
      },
    },
    '👤 Assigned to me',
  );
  const refresh = h('button.btn', { title: 'Refresh board', onclick: () => doRefresh() }, '🔄 Refresh');
  const settings = h('button.btn', { title: 'Configure board', onclick: () => openBoardConfig(boardId, net, () => doRefresh()) }, '⚙️ Settings');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const title = h('h2', {}, '🎯 Board');

  const el = h('div.modal.board', { role: 'dialog', 'aria-label': 'Custom board' }, h('header', {}, title, status, filterMineBtn, refresh, settings, close), body);

  const queries: Record<string, string> = {};

  function getState(): CustomBoardState | undefined {
    return store.customBoards.get(boardId);
  }

  function doRefresh() {
    status.textContent = 'Refreshing…';
    if (net.up) {
      net.send({ t: 'board.refresh', boardId });
    } else {
      fetch(`/api/boards/refresh?board=${encodeURIComponent(boardId)}&floor=${encodeURIComponent(floorId)}`, { method: 'POST' })
        .then((r) => (r.ok ? r.json() : null))
        .then((st) => {
          if (st) {
            store.customBoards.set(boardId, st);
            render();
          }
        })
        .catch(() => render());
    }
  }

  const render = () => {
    const st = getState();
    const def = st?.def ?? { id: boardId, label: 'Board', icon: '🎯' };
    title.textContent = `${def.icon || '🎯'} ${def.label || 'Board'}`;
    status.textContent = st?.loading ? 'Refreshing…' : st?.fetchedAt ? `Updated ${timeAgo(st.fetchedAt)}` : '';

    body.replaceChildren();

    if (st?.error && !st.cards?.length) {
      body.append(
        h('div.board-error', {}, `Error loading board: ${st.error}`, h('br'), h('button.btn.primary', { style: 'margin-top:12px;', onclick: () => openBoardConfig(boardId, net, () => doRefresh()) }, '⚙️ Configure Board')),
      );
      return;
    }

    const allCards = st?.cards ?? [];
    if (!allCards.length) {
      body.append(
        h(
          'div.board-error',
          {},
          'No items found on this board.',
          h('br'),
          h('small', {}, 'Make sure your board URL and credentials are configured.'),
          h('br'),
          h('button.btn.primary', { style: 'margin-top:12px;', onclick: () => openBoardConfig(boardId, net, () => doRefresh()) }, '⚙️ Configure Board'),
        ),
      );
      return;
    }

    const cards = filterMine
      ? allCards.filter((c) => isAssignedToUser(c, st?.currentUser, cachedConfigEmail))
      : allCards;

    // Determine columns dynamically from st.columns, def.columns or cards
    const rawDefCols = st?.columns || st?.def?.columns || [];
    const defCols = Array.isArray(rawDefCols) && rawDefCols.length > 0 ? rawDefCols : [];
    const cardCols = [...new Set(allCards.map((c) => c.column || (c.state === 'CLOSED' ? 'Done' : 'To Do')))];
    const colNames = defCols.length ? [...defCols, ...cardCols.filter((c) => !defCols.includes(c))] : cardCols;
    if (!colNames.length) colNames.push('Items');

    for (const colName of colNames) {
      const colCards = cards.filter((c) => (c.column || (c.state === 'CLOSED' ? 'Done' : 'To Do')) === colName);
      const ul = h('ul');
      const count = h('span');
      const search = h('input', {
        type: 'text',
        value: queries[colName] ?? '',
        placeholder: 'Filter by title…',
        'aria-label': `Filter ${colName}`,
        spellcheck: 'false',
        autocomplete: 'off',
      }) as HTMLInputElement;
      const clear = h('button.col-search-clear', { type: 'button', 'aria-label': 'Clear', title: 'Clear' }, '✕');
      const section = h('section.column');

      const fill = () => {
        const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
        const matching = words.length ? colCards.filter((it) => words.every((w) => it.title.toLowerCase().includes(w) || it.id.toLowerCase().includes(w))) : colCards;
        ul.replaceChildren(
          ...matching.map((it, i) =>
            renderCard(it, i, () => openCustomCard(boardId, it, net, actions)),
          ),
        );
        if (!matching.length) {
          ul.append(
            h(
              'li.empty',
              {},
              words.length
                ? `No cards match “${search.value.trim()}”`
                : filterMine
                ? 'No tickets assigned to you'
                : 'Nothing here',
            ),
          );
        }
        count.textContent = words.length ? `${matching.length} / ${colCards.length}` : String(colCards.length);
        clear.classList.toggle('hidden', !search.value);
      };

      search.addEventListener('input', () => {
        queries[colName] = search.value;
        fill();
      });
      clear.addEventListener('click', () => {
        search.value = queries[colName] = '';
        fill();
        search.focus();
      });

      section.append(h('h4', {}, h('span.col-head', {}, h('span', {}, colName), h('span.col-count', {}, count))), h('div.col-search', {}, search, clear), ul);
      fill();
      body.append(section);
    }
  };

  const unsubs = [store.on('boards', render)];
  const timer = setInterval(() => {
    const st = getState();
    status.textContent = st?.loading ? 'Refreshing…' : st?.fetchedAt ? `Updated ${timeAgo(st.fetchedAt)}` : '';
  }, 15000);

  const modal = openModal(el, {
    doing: `at the ${boardId} board`,
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(timer);
    },
  });
  close.addEventListener('click', () => modal.close());

  render();
  if (!getState()?.fetchedAt) doRefresh();
}

function renderCard(it: BoardCard, i: number, onclick: () => void): HTMLElement {
  const num = it.number ?? Math.abs(hashCode(it.id));
  const tilt = TILTS[num % TILTS.length];
  const bg = NOTE_COLORS[num % NOTE_COLORS.length];
  const pin = ['#ef476f', '#118ab2', '#06d6a0', '#ffd166'][i % 4];

  const metaParts: (Node | string)[] = [];
  if (it.parent) {
    metaParts.push(
      h(
        'span.parent-tag',
        {
          style: 'background:rgba(0,0,0,0.06);border-radius:4px;padding:1px 5px;font-weight:700;',
          title: `Parent: ${it.parent.title || it.parent.key || it.parent.id}`,
        },
        `🏷️ ${it.parent.title || it.parent.key || it.parent.id}`,
      ),
    );
  }
  if (it.type) metaParts.push(h('span', {}, it.type));
  if (it.priority) metaParts.push(h('span', {}, it.priority));
  if (it.storyPoints !== undefined) {
    metaParts.push(
      h(
        'span.sp-tag',
        {
          style: 'background:#f59e0b;color:#fff;border-radius:4px;padding:1px 5px;font-weight:800;font-size:10px;',
          title: `${it.storyPoints} Story Points`,
        },
        `⚡ ${it.storyPoints} SP`,
      ),
    );
  }
  if (it.assignees?.length) {
    const avatarImg = it.assigneeAvatarUrl
      ? (h('img.card-avatar', {
          src: it.assigneeAvatarUrl,
          alt: '',
          'aria-hidden': 'true',
          onerror: (e: any) => {
            e.target.style.display = 'none';
          },
        }) as HTMLImageElement)
      : null;
    metaParts.push(h('span.person', {}, avatarImg, it.assignees.join(', ')));
  } else if (it.author) {
    const avatarImg = it.authorAvatarUrl
      ? (h('img.card-avatar', {
          src: it.authorAvatarUrl,
          alt: '',
          'aria-hidden': 'true',
          onerror: (e: any) => {
            e.target.style.display = 'none';
          },
        }) as HTMLImageElement)
      : null;
    metaParts.push(h('span.person', {}, avatarImg, `by ${it.author}`));
  }
  if (it.comments) metaParts.push(h('span', {}, `💬 ${it.comments}`));
  if (it.updatedAt) metaParts.push(h('span', {}, timeAgo(it.updatedAt)));

  return h(
    'li.card',
    {
      style: `--tilt:${tilt};background:${bg};--pin:${pin}`,
      tabindex: 0,
      onclick,
      onkeydown: ((e: KeyboardEvent) => e.key === 'Enter' && e.target === e.currentTarget && onclick()) as EventListener,
    },
    h('div.num', {}, it.id),
    h('div.ttl', {}, it.title),
    h('div.meta', {}, ...metaParts),
  );
}

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

export function openCustomCard(boardId: string, first: BoardCard, net: Net, actions: BoardActions) {
  let it = first;
  let detail: BoardCardDetail | null = null;
  const currentFloor = store.currentFloor();
  const floorId = store.floor ?? currentFloor?.id ?? '';

  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const pill = h('span.pill');
  const meta = h('div.gh-meta');
  const bodyEl = h('div.gh-body');
  const descEl = h('div.gh-col');
  const commentsThread = h('div.gh-items');

  bodyEl.append(descEl);

  const queueProvider = providerPicker(store.project, `custom-provider-${it.id}`, 'Queue on');
  const addQueueBtn = h('button.btn', { type: 'button' }, '📋 Add to queue') as HTMLButtonElement;
  addQueueBtn.addEventListener('click', () => {
    if (!queueProvider.valid()) return;
    modal.close();
    actions.queue(cardPrompt(it), `[${it.id}] ${it.title}`, it.number ?? 0, queueProvider.value(), queueProvider.model(), queueProvider.effort());
  });

  const handToWorkerBtn = h('button.btn.primary', {
    type: 'button',
    onclick: () => {
      modal.close();
      actions.assign(cardPrompt(it), `Work on ${it.id}: ${it.title}`, it.number);
    },
  }, '🤖 Hand to a worker');

  const el = h(
    'div.modal.gh-window.issue',
    { role: 'dialog', 'aria-label': `${it.id}: ${it.title}` },
    h('header', {}, pill, h('h2', { title: it.title }, `${it.id} ${it.title}`), close),
    meta,
    bodyEl,
    h(
      'footer',
      {},
      it.url ? h('a.grow', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open external ↗') : h('span.grow'),
      h('button.btn', { type: 'button', onclick: () => actions.ask(cardPrompt(it), `Ask about ${it.id}`) }, '✍️ Ask a worker…'),
      h('button.btn', { type: 'button', onclick: () => actions.meeting({ pattern: 'debate', title: `${it.id}: ${it.title}`, prompt: cardPrompt(it) }) }, '🤝 Meeting…'),
      queueProvider.element,
      addQueueBtn,
      handToWorkerBtn,
    ),
  );

  const renderFrame = () => {
    const isOpen = it.state !== 'CLOSED';
    pill.className = `pill ${isOpen ? 'done' : 'offline'}`;
    pill.textContent = it.column || (isOpen ? 'open' : 'closed');

    const assigneeAvatar = it.assigneeAvatarUrl
      ? (h('img.card-avatar', {
          src: it.assigneeAvatarUrl,
          alt: '',
          'aria-hidden': 'true',
          onerror: (e: any) => {
            e.target.style.display = 'none';
          },
        }) as HTMLImageElement)
      : null;
    const authorAvatar = it.authorAvatarUrl
      ? (h('img.card-avatar', {
          src: it.authorAvatarUrl,
          alt: '',
          'aria-hidden': 'true',
          onerror: (e: any) => {
            e.target.style.display = 'none';
          },
        }) as HTMLImageElement)
      : null;

    const assignToMeBtn = h(
      'button.btn.small',
      {
        type: 'button',
        style: 'margin-left:6px;padding:1px 8px;font-size:11px;font-weight:700;',
        title: 'Assign this ticket to me in Jira',
        onclick: async () => {
          assignToMeBtn.disabled = true;
          assignToMeBtn.textContent = 'Assigning…';
          try {
            const res = await fetch(
              `/api/boards/assign?board=${encodeURIComponent(boardId)}&id=${encodeURIComponent(it.id)}&floor=${encodeURIComponent(floorId)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assignee: 'me' }),
              },
            );
            const data = await res.json();
            if (data.ok && data.card) {
              it = { ...it, ...data.card };
              renderFrame();
              toast(`Assigned ${it.id} to you`, 'info');
            } else {
              throw new Error(data.error || 'Failed to assign');
            }
          } catch (err) {
            toast((err as Error).message, 'error');
          } finally {
            assignToMeBtn.disabled = false;
            assignToMeBtn.textContent = 'Assign to me';
          }
        },
      },
      'Assign to me',
    );

    const metaNodes = [
      h('b', {}, it.id),
      it.type ? h('span.label', { style: 'background:#3b82f6;color:#fff;border-radius:4px;padding:1px 6px;' }, it.type) : null,
      it.priority ? h('span', {}, `· Priority: ${it.priority}`) : null,
      it.storyPoints !== undefined ? h('span.label', { style: 'background:#f59e0b;color:#fff;border-radius:4px;padding:1px 6px;font-weight:800;' }, `⚡ ${it.storyPoints} Story Points`) : null,
      it.parent ? h('span.parent-link', {}, '· Parent: ', it.parent.url ? h('a', { href: it.parent.url, target: '_blank', rel: 'noopener noreferrer', style: 'color:#3b82f6;font-weight:700;' }, `[${it.parent.key || it.parent.id}] ${it.parent.title || ''}`) : `[${it.parent.key || it.parent.id}] ${it.parent.title || ''}`) : null,
      h('span.person', {}, '· Assignee: ', assigneeAvatar, it.assignees?.length ? it.assignees.join(', ') : 'Unassigned', assignToMeBtn),
      it.author ? h('span.person', {}, '· Reporter: ', authorAvatar, it.author) : null,
      it.updatedAt ? h('span', {}, `· Updated ${timeAgo(it.updatedAt)}`) : null,
    ].filter(Boolean) as Node[];

    meta.replaceChildren(...metaNodes);
  };

  const renderBody = () => {
    descEl.replaceChildren();
    if (it.body) {
      descEl.append(markdown(it.body, it.url));
    } else {
      descEl.append(h('p.gh-quiet', {}, 'No description provided.'));
    }

    if (detail?.commentsList?.length) {
      commentsThread.replaceChildren();
      for (const c of detail.commentsList) {
        const cAvatar = c.avatarUrl
          ? (h('img.card-avatar', {
              src: c.avatarUrl,
              alt: '',
              'aria-hidden': 'true',
              onerror: (e: any) => {
                e.target.style.display = 'none';
              },
            }) as HTMLImageElement)
          : null;
        commentsThread.append(
          h(
            'div.gh-item',
            {},
            h('div.gh-item-head', {}, cAvatar, h('b', {}, c.author), h('span', {}, `commented ${timeAgo(c.createdAt)}`)),
            h('div.gh-item-body', {}, markdown(c.body, it.url)),
          ),
        );
      }
      descEl.append(h('h3', { style: 'margin-top:20px;' }, 'Comments'), commentsThread);
    }
  };

  renderFrame();
  renderBody();

  // Load details / comments
  fetch(`/api/boards/card?board=${encodeURIComponent(boardId)}&id=${encodeURIComponent(it.id)}&floor=${encodeURIComponent(floorId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: BoardCardDetail | null) => {
      if (d) {
        detail = d;
        it = { ...it, ...d };
        renderFrame();
        renderBody();
      }
    })
    .catch(() => {});

  const modal = openModal(el, { doing: `viewing ${it.id}` });
  close.addEventListener('click', () => modal.close());
}

export function openBoardConfig(boardId: string, net: Net, onSaved?: () => void) {
  const currentFloor = store.currentFloor();
  const floorId = store.floor ?? currentFloor?.id ?? '';
  const st = store.customBoards.get(boardId);
  const def: CustomBoardDef = st?.def ?? {
    id: boardId,
    label: 'Board',
    icon: '🎯',
    configFields: [
      { key: 'boardUrl', label: 'Board URL', type: 'url', placeholder: 'https://...', required: true },
      { key: 'email', label: 'Email / Username', type: 'text', placeholder: 'user@example.com' },
      { key: 'apiToken', label: 'API Token / Secret', type: 'password', placeholder: 'API token' },
      { key: 'jql', label: 'Query / Filter (optional)', type: 'text', placeholder: 'Filter query' },
    ],
  };

  const body = h('div.body');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const saveBtn = h('button.btn.primary', { type: 'button' }, 'Save & Sync');
  const msgEl = h('p.setting-note', { style: 'margin:8px 0;' });

  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': `Configure ${def.label}`, style: 'width:min(600px,95vw);' },
    h('header', {}, h('h2', {}, `⚙️ Configure ${def.label}`), close),
    body,
    h('footer', {}, msgEl, saveBtn),
  );

  const inputs = new Map<string, HTMLInputElement>();
  const fields = def.configFields || [];

  for (const f of fields) {
    const inp = h('input', {
      type: f.type || 'text',
      placeholder: f.placeholder || '',
      'aria-label': f.label,
      style: 'width:100%;margin-top:4px;box-sizing:border-box;',
    }) as HTMLInputElement;
    inputs.set(f.key, inp);
    body.append(
      h('div', { style: 'margin-bottom:12px;' }, h('label', { style: 'font-weight:600;font-size:13px;' }, f.label, f.required ? ' *' : ''), inp),
    );
  }

  fetch(`/api/boards/config?board=${encodeURIComponent(boardId)}&floor=${encodeURIComponent(floorId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const cfg = d?.config || {};
      for (const [key, inp] of inputs) {
        if (cfg[key]) inp.value = String(cfg[key]);
      }
    })
    .catch(() => {});

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    msgEl.textContent = '';

    const config: Record<string, string> = {};
    for (const [key, inp] of inputs) {
      config[key] = inp.value.trim();
    }

    try {
      const res = await fetch(`/api/boards/config?board=${encodeURIComponent(boardId)}&floor=${encodeURIComponent(floorId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Failed to save configuration');
      }
      toast(`${def.label} configuration saved. Refreshing…`, 'info');
      modal.close();
      onSaved?.();
    } catch (err) {
      msgEl.textContent = (err as Error).message;
      msgEl.style.color = '#c62828';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Sync';
    }
  });

  const modal = openModal(el, { doing: `configuring ${def.label}` });
  close.addEventListener('click', () => modal.close());
}
