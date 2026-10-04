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

// ---- The issue window -----------------------------------------------------------------------------

export function openIssue(first: GhIssue, net: Net, actions: BoardActions) {
  let it = first;
  const itemUrl = it.url;
  let detail: GhIssueDetail | null = null;
  let error = '';
  const close = h('button.btn.close', { 'aria-label': "닫기" }, '✕');
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
  const closeIssue = h('button.btn', { type: 'button', title: "GitHub에서 이 이슈 닫기", onclick: () => openClose('issue', it, net, load) }, "✔️ 이슈 닫기…");
  const queueProvider = providerPicker(store.project, `issue-provider-${it.number}`, "대기열에 추가");
  const addIssueToQueue = () => {
    if (!queueProvider.valid()) return;
    modal.close();
    actions.queue(issuePrompt(it), `#${it.number} ${it.title}`, it.number, queueProvider.value(), queueProvider.model(), queueProvider.effort());
  };
  const queue = h('button.btn', { type: 'button', onclick: addIssueToQueue }) as HTMLButtonElement;
  const carry = actions.pickUp;
  const pickUp = carry ? h('button.btn', { type: 'button', title: "이슈 카드를 들고 빈 책상, 직원 또는 대기열 게시판 앞에서 E를 누르세요", onclick: () => carry(it) }, "✋ 카드 집기") : null;
  const meta = h('div.gh-meta');
  const el = h(
    'div.modal.gh-window.issue',
    { role: 'dialog', 'aria-label': `이슈 #${it.number}` },
    h('header', {}, pill, h('h2', { title: it.title }, `#${it.number} ${it.title}`), close),
    meta,
    h('div.gh-body', {}, conv),
    h(
      'footer',
      {},
      h('a.grow', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, "GitHub에서 열기 ↗"),
      h('button.btn', { type: 'button', title: "이 이슈에 대한 작업을 직원에게 요청", onclick: () => actions.ask(issueContext(it), `이슈 #${it.number}에 대해 요청`) }, "✍️ 직원에게 요청…"),
      h('button.btn', { type: 'button', title: "회의실에서 함께 진행합니다. 토론, 리더와 팀, map-reduce, red / blue 방식 중 선택하세요", onclick: () => actions.meeting(issueMeeting(it.number, it.title)) }, "🤝 회의…"),
      closeIssue,
      queueProvider.element,
      queue,
      pickUp,
      h('button.btn.primary', { type: 'button', onclick: () => actions.assign(issuePrompt(it), `이슈 #${it.number}을 직원에게 맡기기`, it.number) }, "🤖 직원에게 맡기기"),
    ),
  );
  const renderFrame = () => {
    const isOpen = it.state === 'OPEN';
    meta.replaceChildren(
      ...nodes(
        avatar(it.author),
        h('b', {}, it.author),
        h('span', {}, `등록: ${timeAgo(it.createdAt)}`),
        it.assignees.length ? h('span', {}, `· 👤 ${it.assignees.join(', ')}`) : it.taken ? h('span', {}, "· 🤖 직원에게 맡김") : null,
        ...it.labels.map(labelChip),
        labelButton('issue', () => it, net, (labels) => ((it = { ...it, labels }), renderFrame())),
      ),
    );
    pill.className = `pill ${isOpen ? 'done' : 'offline'}`;
    pill.textContent = isOpen ? 'open' : 'closed';
    const task = store.taskForIssue(it.number);
    const onQueue = !!task && task.status !== 'done';
    closeIssue.classList.toggle('hidden', !isOpen);
    pickUp?.classList.toggle('hidden', !isOpen);
    queueProvider.element.classList.toggle('hidden', !isOpen || onQueue);
    queue.classList.toggle('hidden', !isOpen);
    queue.disabled = onQueue;
    queue.title = onQueue ? '' : "빈 책상이 있고 동시 작업 한도에 여유가 생기면 직원이 자동으로 시작합니다";
    queue.textContent = onQueue ? (task!.status === 'running' ? `🤖 ${task!.workerName ?? "직원"}이(가) 작업 중` : "📋 대기열에 있음") : "📋 대기열에 추가";
  };
  const render = () => {
    thread.replaceChildren(commentCard({ id: 'body', author: it.author, body: detail?.body ?? it.body, createdAt: it.createdAt, url: it.url }, itemUrl, "등록"));
    if (error) thread.append(errorBox(error, load));
    else if (!detail) thread.append(spinnerRow("댓글을 불러오는 중…"));
    else if (!detail.comments.length) thread.append(h('p.gh-quiet', {}, "아직 댓글이 없습니다."));
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
    doing: `📋 이슈 #${it.number}을 보는 중`,
    onClose: () => {
      comment.dispose();
      unsubs.forEach((u) => u());
    },
  });
  close.addEventListener('click', () => modal.close());
  renderFrame();
  load();
}
