import './meeting.css';
import { MEETING_PATTERNS, MEETING_PATTERN_IDS, fixedRounds, meetingSpend, meetingStage, outputProblem, slugify } from '../../shared/meetings';
import { fmtTokens, type Meeting, type MeetingPattern, type MeetingTurn } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, toast, STATUS_LABEL, type Modal } from './dom';
import { confirmDialog } from './prompt';
import { providerPicker } from './provider';
import { officePrompt } from './prompts';
import { issueVars } from './github/prompts';
import { L, patternLabel, patternText, roleLabel } from '../i18n';
import { dictateField } from './dictate';

/** What a meeting called from an issue, a PR or a task starts out with. */
export interface MeetingPreset {
  pattern?: MeetingPattern;
  prompt?: string;
  title?: string;
  pr?: number;
  issue?: number;
}

export interface MeetingActions {
  openTerminal(workerId: string): void;
  /** Push the meeting's branch and open a pull request for it, through the head of the table's worker. */
  openPr(workerId: string): void;
}

/** A meeting about a GitHub issue: the form filled in with it. */
export function issueMeeting(n: number, title: string): MeetingPreset {
  return { issue: n, title: `#${n} ${title}`, prompt: officePrompt('issue.meeting', issueVars({ number: n, title })) };
}

const PART_LABEL: Record<MeetingTurn['state'], string> = L.meeting.parts;

/**
 * The meeting room's window. With a meeting at the table it shows how it's going (and stops it, or
 * clears the table once it's over); otherwise, or with a preset from an issue or a PR, it's the form
 * that calls one.
 */
export function openMeeting(net: Net, actions: MeetingActions, preset?: MeetingPreset) {
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const title = h('h2', {}, L.hints.meetingRoom);
  const body = h('div.body.meeting');
  const foot = h('footer');
  const el = h('div.modal.meeting-window', { role: 'dialog', 'aria-label': L.menu.meeting }, h('header', {}, title, close), body, foot);
  let view: 'status' | 'form' = preset || !store.meeting.current ? 'form' : 'status';
  let form: ReturnType<typeof meetingForm> | null = null;
  const render = () => {
    if (view === 'status' && store.meeting.current) {
      form = null;
      title.textContent = L.hints.meetingRoom;
      renderStatus(store.meeting.current, body, foot, net, actions, () => {
        view = 'form';
        render();
      });
      return;
    }
    if (!form) {
      form = meetingForm(net, preset, () => modal.close(), () => {
        view = 'status';
        render();
      });
      title.textContent = L.meeting.callTitle;
      body.replaceChildren(form.body);
      foot.replaceChildren(...form.foot);
    }
    form.refresh();
  };
  const offs = [store.on('meeting', render), store.on('workers', () => view === 'status' && render()), store.on('pulls', () => form?.refresh())];
  const modal: Modal = openModal(el, { doing: L.meeting.doing, onClose: () => offs.forEach((off) => off()) });
  close.addEventListener('click', () => modal.close());
  render();
}

function renderStatus(m: Meeting, body: HTMLElement, foot: HTMLElement, net: Net, actions: MeetingActions, callAnother: () => void) {
  const p = MEETING_PATTERNS[m.pattern];
  const running = m.status === 'running';
  const pill = h('span.pill', { class: running ? 'working' : m.status === 'done' ? 'done' : 'needs_input' }, running ? L.meeting.inMeeting : (L.meeting.statuses[m.status] ?? m.status));
  const seats = h(
    'ul.meeting-seats',
    {},
    ...m.seats.map((s, i) => {
      const w = s.workerId ? store.workers.get(s.workerId) : undefined;
      const t = m.turns.find((x) => x.seat === i);
      const part = running ? (t ? `${PART_LABEL[t.state]}: ${t.doing}` : L.meeting.listening) : '';
      return h(
        'li',
        {},
        h('span.dot', { style: `background:${w?.color ?? '#adb5bd'}` }),
        h('b', {}, roleLabel(s.role)),
        h('span.muted', {}, `${i === 0 ? `${L.meeting.head} · ` : ''}${s.workerName ?? '…'}`),
        w ? h('span.pill', { class: w.status }, STATUS_LABEL[w.status]) : h('span.pill.exited', {}, L.meeting.goneHome),
        part ? h('span.meeting-part', { title: t?.file ?? '' }, part) : null,
        s.tokens ? h('span.muted', {}, `${fmtTokens(s.tokens)} tokens`) : null,
        w ? h('button.btn.small', { type: 'button', onclick: () => actions.openTerminal(w.id) }, L.queue.terminal) : null,
      );
    }),
  );
  const where = m.worktree ? h('span', {}, '🌿 ', h('code', {}, m.worktree.branch), m.commit ? ` · ${L.meeting.committed(m.commit)}` : '') : null;
  const review = m.review?.url ? h('a', { href: m.review.url, target: '_blank', rel: 'noopener noreferrer' }, L.meeting.reviewOn(m.pr)) : m.review?.error ? h('span.bad', {}, L.meeting.reviewFailed(m.review.error)) : null;
  body.replaceChildren(
    ...present(
    h('div.meeting-head', {}, pill, h('b', {}, `${p.icon} ${patternLabel(m.pattern)}`), h('span.meeting-title', { title: m.prompt }, m.title)),
    h('p.meeting-line', {}, running ? `${meetingStage(m, L)} · ${L.meeting.calledBy(m.calledBy, timeAgo(new Date(m.startedAt).toISOString()))}` : m.status === 'done' ? L.meeting.wrote(m.output, m.round) : L.meeting.stoppedIn(m.round, m.reason ?? L.meeting.statuses.stopped)),
    m.tokens ? h('p.meeting-spend', { title: L.meeting.spendTip(m.tokens.toLocaleString()) }, `💸 ${running ? L.meeting.soFar(meetingSpend(m)) : meetingSpend(m)}`) : null,
    seats,
    h('div.meeting-out', {}, h('div.meeting-out-head', {}, h('b', {}, '📄 '), h('code', {}, m.output), where, review), h('pre.meeting-preview', {}, m.preview?.trim() ? m.preview : running ? L.meeting.nothingYet : L.meeting.nothingWritten)),
    store.meeting.past.length
      ? h('details.meeting-past', {}, h('summary', {}, L.meeting.earlier(store.meeting.past.length)), h('ul', {}, ...store.meeting.past.map((r) => h('li', { title: L.meeting.calledByTip(r.calledBy) }, h('b', {}, r.title), h('div.muted', {}, r.summary)))))
      : null,
    ),
  );
  const head = m.seats[0]?.workerId ? store.workers.get(m.seats[0].workerId) : undefined;
  foot.replaceChildren(
    ...present(
    h('span.grow', {}, running ? L.meeting.staysAtTable : L.meeting.clearingSends),
    running ? h('button.btn', { type: 'button', onclick: () => confirmDialog(L.meeting.stopQ, L.meeting.stopBody(m.output), L.meeting.stopIt, () => net.send({ t: 'meeting.stop' })) }, L.meeting.stop) : null,
    !running && m.commit && head?.worktree ? h('button.btn', { type: 'button', title: L.changes.pushTip(m.worktree?.branch, L.meeting.aBase), onclick: () => actions.openPr(head.id) }, head.pr ? `🔀 PR #${head.pr.number}` : `🔀 ${L.hints.openPr}`) : null,
    !running ? h('button.btn', { type: 'button', onclick: () => net.send({ t: 'meeting.clear' }) }, L.meeting.clear) : null,
    !running ? h('button.btn.primary', { type: 'button', onclick: callAnother }, L.meeting.callDots) : null,
    ),
  );
}

const present = (...xs: (Node | null)[]): Node[] => xs.filter((x): x is Node => x !== null);

/** The form that calls a meeting: the pattern, what it's about, who sits down, the output, the round limit. */
function meetingForm(net: Net, preset: MeetingPreset | undefined, done: () => void, back: () => void) {
  let pattern: MeetingPattern = preset?.pattern ?? 'debate';
  let roles: string[] = [];
  let outputTouched = false;
  const patterns = h('div.meeting-patterns', { role: 'radiogroup', 'aria-label': L.meeting.pattern });
  const about = h('textarea', { rows: 4, placeholder: L.meeting.aboutPlaceholder, 'aria-label': L.meeting.aboutLabel }) as HTMLTextAreaElement;
  about.value = preset?.prompt ?? '';
  const titleIn = h('input', { type: 'text', placeholder: L.meeting.titlePlaceholder, maxlength: 100, 'aria-label': L.changes.title }) as HTMLInputElement;
  titleIn.value = preset?.title ?? '';
  const outputIn = h('input', { type: 'text', 'aria-label': L.meeting.outputFile, spellcheck: 'false' }) as HTMLInputElement;
  const outputNote = h('small.muted');
  const prSel = h('select.provider-select', { 'aria-label': L.meeting.pullRequest }) as HTMLSelectElement;
  const prRow = h('div.meeting-field', {}, h('label', {}, L.meeting.pullRequest), prSel);
  const partsIn = h('textarea', { rows: 3, placeholder: 'src/server/\nsrc/client/\nsrc/shared/', 'aria-label': L.meeting.partsLabel, spellcheck: 'false' }) as HTMLTextAreaElement;
  const partsRow = h('div.meeting-field', {}, h('label', {}, L.meeting.partsPerLine), partsIn, h('small.muted', {}, L.meeting.partsNote));
  const count = h('b');
  const minus = h('button.btn.small', { type: 'button', 'aria-label': L.meeting.fewer }, '−');
  const plus = h('button.btn.small', { type: 'button', 'aria-label': L.meeting.more }, '+');
  const roleList = h('div.meeting-roles');
  const roundsSel = h('select.provider-select.meeting-rounds', { 'aria-label': L.meeting.roundLimit }) as HTMLSelectElement;
  // A pattern that always runs the same rounds says so, where a locked control would look broken.
  const roundsFixed = h('span.meeting-fixed');
  const roundsNote = h('small.muted');
  const provider = providerPicker(store.project, 'meeting-provider', L.meeting.workers);
  const busy = h('p.meeting-busy');
  const submit = h('button.btn.primary', { type: 'submit' }, L.meeting.start);
  const cancel = h('button.btn', { type: 'button', onclick: store.meeting.current ? back : done }, store.meeting.current ? L.meeting.back : L.hints.cancel);

  const def = () => MEETING_PATTERNS[pattern];
  const slug = () => slugify(titleIn.value.trim() || about.value.trim().split('\n')[0] || 'meeting', 32);
  const pr = () => Number(prSel.value) || undefined;
  const syncOutput = () => {
    if (!outputTouched) outputIn.value = def().output(slug(), pr());
    const problem = outputProblem(outputIn.value.trim(), L);
    outputNote.textContent = problem ? `⚠️ ${problem}` : pattern === 'review' ? L.meeting.endsReview : store.project?.branch ? L.meeting.endsCommit : L.meeting.ends;
    outputNote.classList.toggle('bad', !!problem);
  };
  const renderRoles = () => {
    const d = def();
    count.textContent = String(roles.length);
    minus.toggleAttribute('disabled', roles.length <= d.seats.min);
    plus.toggleAttribute('disabled', roles.length >= d.seats.max);
    roleList.replaceChildren(
      ...roles.map((r, i) => {
        const input = h('input', { type: 'text', value: r, maxlength: 40, 'aria-label': L.meeting.role(i + 1) }) as HTMLInputElement;
        input.addEventListener('input', () => (roles[i] = input.value));
        return h('div.meeting-role', {}, h('span.muted', {}, i === 0 ? '👑' : `${i + 1}`), input);
      }),
    );
  };
  const pickPattern = (p: MeetingPattern) => {
    pattern = p;
    const d = def();
    roles = d.roles.slice(0, d.seats.default);
    for (const b of patterns.children) b.classList.toggle('on', (b as HTMLElement).dataset.pattern === p);
    for (const b of patterns.children) b.setAttribute('aria-checked', String((b as HTMLElement).dataset.pattern === p));
    const fixed = fixedRounds(d, L);
    const limits = Array.from({ length: d.rounds.max - d.rounds.min + 1 }, (_, i) => d.rounds.min + i);
    roundsSel.replaceChildren(...limits.map((n) => h('option', { value: String(n) }, L.shared.rounds(n))));
    roundsSel.value = String(d.rounds.default);
    roundsSel.classList.toggle('hidden', !!fixed);
    roundsFixed.classList.toggle('hidden', !fixed);
    roundsFixed.textContent = fixed ? `🔒 ${fixed.line}` : '';
    roundsFixed.title = fixed?.why ?? '';
    roundsNote.textContent = fixed ? fixed.stages : `${L.meeting.roundsRange(d.rounds.min, d.rounds.max)} ${patternText(p)?.roundsNote ?? d.roundsNote ?? ''}`.trim();
    prRow.classList.toggle('hidden', d.needs !== 'pr');
    partsRow.classList.toggle('hidden', d.needs !== 'parts');
    renderRoles();
    syncOutput();
  };
  for (const id of MEETING_PATTERN_IDS) {
    const d = MEETING_PATTERNS[id];
    patterns.append(h('button.meeting-pattern', { type: 'button', role: 'radio', 'data-pattern': id, onclick: () => pickPattern(id) }, h('b', {}, `${d.icon} ${d.label}`), h('small', {}, d.blurb)));
  }
  minus.addEventListener('click', () => {
    if (roles.length > def().seats.min) roles.pop();
    renderRoles();
  });
  plus.addEventListener('click', () => {
    if (roles.length < def().seats.max) roles.push(roleLabel(def().roles[roles.length] ?? '') || L.meeting.workerN(roles.length + 1));
    renderRoles();
  });
  outputIn.addEventListener('input', () => {
    outputTouched = true;
    syncOutput();
  });
  titleIn.addEventListener('input', syncOutput);
  about.addEventListener('input', syncOutput);
  prSel.addEventListener('change', syncOutput);

  const bodyEl = h(
    'form.meeting-form',
    {},
    patterns,
    h('div.meeting-field', {}, h('label', {}, L.meeting.whatAbout), dictateField(about)),
    h('div.meeting-field', {}, titleIn),
    prRow,
    partsRow,
    h('div.meeting-field', {}, h('label', {}, L.meeting.outputFile), outputIn, outputNote),
    h('div.meeting-field', {}, h('label.meeting-count', {}, L.meeting.atTable, minus, count, plus), roleList),
    h('div.meeting-field', {}, h('label', {}, L.meeting.roundLimit), roundsSel, roundsFixed, roundsNote),
    provider.element,
    busy,
  ) as HTMLFormElement;
  bodyEl.noValidate = true;

  const send = () => {
    if (store.meeting.current?.status === 'running') return;
    const prompt = about.value.trim();
    if (!prompt) return about.focus();
    if (def().needs === 'pr' && !pr()) return prSel.focus();
    const parts = partsIn.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (def().needs === 'parts' && parts.length < roles.length - 1) {
      toast(L.meeting.listParts(roles.length - 1), 'warn');
      return partsIn.focus();
    }
    const output = outputIn.value.trim();
    if (outputProblem(output)) return outputIn.focus();
    if (!provider.valid()) return;
    net.send({
      t: 'meeting.start',
      pattern,
      prompt,
      title: titleIn.value.trim() || undefined,
      output,
      roles: roles.map((r) => r.trim()),
      parts: def().needs === 'parts' ? parts : undefined,
      pr: def().needs === 'pr' ? pr() : undefined,
      issue: preset?.issue,
      rounds: Number(roundsSel.value) || undefined,
      provider: provider.value(),
      model: provider.model(),
      effort: provider.effort(),
    });
    toast(L.meeting.calling(patternLabel(pattern)));
    done();
  };
  bodyEl.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  submit.addEventListener('click', (e) => {
    e.preventDefault();
    send();
  });

  /** Keeps what depends on the board and the room up to date: the open PRs, and whether the room is free. */
  const refresh = () => {
    const open = store.pulls.items.filter((p) => p.state === 'OPEN');
    const want = prSel.value || (preset?.pr ? String(preset.pr) : '');
    const opts: (readonly [string, string])[] = open.map((p) => [String(p.number), `#${p.number} ${p.title}`] as const);
    if (preset?.pr && !open.some((p) => p.number === preset.pr)) opts.unshift([String(preset.pr), `#${preset.pr}`]);
    const key = JSON.stringify(opts);
    if (prSel.dataset.key !== key) {
      prSel.dataset.key = key;
      prSel.replaceChildren(h('option', { value: '' }, open.length || preset?.pr ? L.meeting.pickPr : L.meeting.noPrs), ...opts.map(([v, label]) => h('option', { value: v }, label.length > 70 ? `${label.slice(0, 69)}…` : label)));
      prSel.value = want;
      syncOutput();
    }
    const m = store.meeting.current;
    const taken = m?.status === 'running';
    busy.textContent = taken ? L.meeting.busy(m.title) : m ? L.meeting.sendsLast : '';
    submit.toggleAttribute('disabled', taken);
  };
  pickPattern(pattern);
  if (preset?.pr) prSel.value = String(preset.pr);
  refresh();
  setTimeout(() => (preset?.prompt ? titleIn : about).focus(), 0);
  return { body: bodyEl, foot: [h('span.grow', {}, L.meeting.cheap), cancel, submit], refresh };
}
