import './windows.css';
import type { GhIssue, GhIssueDetail } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, timeAgo } from '../dom';
import { issueMeeting } from '../meeting';
import { providerPicker } from '../provider';
import { getJson } from './api';
import { openClose } from './close';
import { commentBox } from './comment-box';
import { labelButton, labelChip } from './labels';
import { avatar, commentCard, errorBox, nodes, spinnerRow } from './pieces';
import { issueContext, issuePrompt, type BoardActions } from './prompts';
import { L } from '../../i18n';

// ---- The issue window -----------------------------------------------------------------------------

export function openIssue(first: GhIssue, net: Net, actions: BoardActions) {
  let it = first;
  const itemUrl = it.url;
  let detail: GhIssueDetail | null = null;
  let error = '';
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
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
  const closeIssue = h('button.btn', { type: 'button', title: L.pull.closeIssueTip, onclick: () => openClose('issue', it, net, load) }, L.pull.closeIssue);
  const queueProvider = providerPicker(store.project, `issue-provider-${it.number}`, L.pull.queueOn);
  const addIssueToQueue = () => {
    if (!queueProvider.valid()) return;
    modal.close();
    actions.queue(issuePrompt(it), `#${it.number} ${it.title}`, it.number, queueProvider.value(), queueProvider.model(), queueProvider.effort());
  };
  const queue = h('button.btn', { type: 'button', onclick: addIssueToQueue }) as HTMLButtonElement;
  const carry = actions.pickUp;
  const pickUp = carry ? h('button.btn', { type: 'button', title: L.pull.pickUpTip, onclick: () => carry(it) }, L.pull.pickUp) : null;
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
      h('a.grow', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, L.pull.openGithub),
      h('button.btn', { type: 'button', title: L.pull.askIssueTip, onclick: () => actions.ask(issueContext(it), L.pull.askAboutIssue(it.number)) }, L.pull.askWorker),
      h('button.btn', { type: 'button', title: L.pull.meetingTip, onclick: () => actions.meeting(issueMeeting(it.number, it.title)) }, L.pull.meeting),
      closeIssue,
      queueProvider.element,
      queue,
      pickUp,
      h('button.btn.primary', { type: 'button', onclick: () => actions.assign(issuePrompt(it), L.pull.handIssue(it.number), it.number) }, L.pull.hand),
    ),
  );
  const renderFrame = () => {
    const isOpen = it.state === 'OPEN';
    meta.replaceChildren(
      ...nodes(
        avatar(it.author),
        h('b', {}, it.author),
        h('span', {}, `${L.pull.openedThis} ${timeAgo(it.createdAt)}`),
        it.assignees.length ? h('span', {}, `· 👤 ${it.assignees.join(', ')}`) : it.taken ? h('span', {}, `· ${L.boards.handed}`) : null,
        ...it.labels.map(labelChip),
        labelButton('issue', () => it, net, (labels) => ((it = { ...it, labels }), renderFrame())),
      ),
    );
    pill.className = `pill ${isOpen ? 'done' : 'offline'}`;
    pill.textContent = isOpen ? L.pull.openIssue : L.pull.closedIssue;
    const task = store.taskForIssue(it.number);
    const onQueue = !!task && task.status !== 'done';
    closeIssue.classList.toggle('hidden', !isOpen);
    pickUp?.classList.toggle('hidden', !isOpen);
    queueProvider.element.classList.toggle('hidden', !isOpen || onQueue);
    queue.classList.toggle('hidden', !isOpen);
    queue.disabled = onQueue;
    queue.title = onQueue ? '' : L.pull.queueTip;
    queue.textContent = onQueue ? (task!.status === 'running' ? L.pull.onIt(task!.workerName ?? L.pull.aWorker) : L.pull.onQueue) : L.pull.addToQueue;
  };
  const render = () => {
    thread.replaceChildren(commentCard({ id: 'body', author: it.author, body: detail?.body ?? it.body, createdAt: it.createdAt, url: it.url }, itemUrl, L.pull.openedThis));
    if (error) thread.append(errorBox(error, load));
    else if (!detail) thread.append(spinnerRow(L.pull.loadingComments));
    else if (!detail.comments.length) thread.append(h('p.gh-quiet', {}, L.pull.noCommentsYet));
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
    doing: L.pull.readingIssue(it.number),
    onClose: () => {
      comment.dispose();
      unsubs.forEach((u) => u());
    },
  });
  close.addEventListener('click', () => modal.close());
  renderFrame();
  load();
}
