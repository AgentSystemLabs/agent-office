import './prompt.css';
import type { AgentEffort, AgentProvider, LostBranch, ServerMsg, WorktreeCleanup, WorktreeState } from '../../shared/protocol';
import { h, openModal } from './dom';
import { store } from '../state';
import { providerPicker, type ProviderPicker } from './provider';
import { dictateField } from './dictate';

export interface PromptOptions {
  title: string;
  subtitle?: string;
  /** A warning over the prompt, e.g. that the machine is under pressure. */
  warning?: string;
  placeholder?: string;
  initial?: string;
  submitLabel?: string;
  /** Allow hiring a worker without an initial prompt (the direct hire flow). */
  allowEmpty?: boolean;
  /** Offer the "own git worktree" option (only when hiring a new worker). */
  worktreeOption?: boolean;
  /** Offer the configured agent provider choice (only when hiring a new worker). */
  providerOption?: boolean;
  /** Other floors' projects a new worker in its own worktree can work in too (see WorkerInfo.repos). */
  repoOptions?: { id: string; name: string }[];
  onSubmit(text: string, opts: { worktree: boolean; provider?: AgentProvider; model?: string; effort?: AgentEffort; repos: string[] }): void;
}

const WT_KEY = 'agent-office.worktree';
/** Whether the last hire asked for its own git worktree (the Ask window shares the choice). */
export function worktreePref(): boolean {
  try {
    return localStorage.getItem(WT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Hiring across repositories: other floors' projects the new worker takes on too, each in a worktree
 * of its own on the same branch. That needs a worktree of its own here, so picking one ticks `wtBox`
 * and unticking that clears them.
 */
export function repoPicker(options: { id: string; name: string }[] | undefined, wtBox: HTMLInputElement): { element: HTMLElement | null; value(): string[] } {
  const picks = (options ?? []).map((r) => {
    const box = h('input', { type: 'checkbox', value: r.id, onchange: () => box.checked && (wtBox.checked = true) }) as HTMLInputElement;
    return { id: r.id, box, el: h('label.repo-pick', { title: `${r.name}에도 같은 이름의 브랜치와 worktree를 만들고 별도의 PR을 생성합니다` }, box, r.name) };
  });
  if (!picks.length) return { element: null, value: () => [] };
  wtBox.addEventListener('change', () => {
    if (!wtBox.checked) for (const p of picks) p.box.checked = false;
  });
  return {
    element: h('div.repo-picks', { role: 'group', 'aria-label': "함께 작업할 다른 프로젝트" }, h('span', {}, "🗂️ 함께 작업할 프로젝트"), ...picks.map((p) => p.el)),
    value: () => picks.filter((p) => p.box.checked).map((p) => p.id),
  };
}

export function openPrompt(opts: PromptOptions) {
  const ta = h('textarea', { rows: 7, placeholder: opts.placeholder ?? "직원에게 맡길 작업을 적어주세요", 'aria-label': "작업 지시" }) as HTMLTextAreaElement;
  ta.value = opts.initial ?? '';
  const wtBox = h('input', { type: 'checkbox', id: 'wt-toggle' }) as HTMLInputElement;
  wtBox.checked = worktreePref();
  const wtRow = opts.worktreeOption
    ? h(
        'label',
        { for: 'wt-toggle', style: 'display:flex;gap:8px;align-items:center;margin:10px 0 0;font-weight:700;cursor:pointer', title: "별도 브랜치에서 작업해 다른 직원의 변경과 충돌하지 않게 합니다" },
        wtBox,
        "🌿 별도의 Git worktree와 브랜치에서 작업",
    )
    : null;
  const repos = repoPicker(opts.worktreeOption ? opts.repoOptions : undefined, wtBox);
  const provider: ProviderPicker | null = opts.providerOption ? providerPicker(store.project, 'prompt-provider') : null;
  const submit = h('button.btn.primary', { type: 'submit' }, opts.submitLabel ?? "작업 보내기 ✨");
  const cancel = h('button.btn', { type: 'button' }, "취소");
  const form = h(
    'form.modal',
    { role: 'dialog', 'aria-label': opts.title },
    h('header', {}, h('h2', {}, opts.title)),
    h('div.body', {}, opts.warning ? h('p.setting-note.bad', { style: 'margin:0 0 10px', role: 'alert' }, opts.warning) : null, opts.subtitle ? h('p', { style: 'margin:0 0 10px;font-weight:700;color:var(--muted)' }, opts.subtitle) : null, dictateField(ta), provider?.element ?? null, wtRow, repos.element),
    h('footer', {}, h('span.grow', {}, "Enter로 보내기 · Shift+Enter로 줄바꿈"), cancel, submit),
  ) as HTMLFormElement;
  form.noValidate = true;

  const modal = openModal(form);
  cancel.addEventListener('click', () => modal.close());
  const send = () => {
    const text = ta.value.trim();
    if (!text && !opts.allowEmpty) {
      ta.focus();
      return;
    }
    if (provider && !provider.valid()) return;
    modal.close();
    if (opts.worktreeOption) {
      try {
        localStorage.setItem(WT_KEY, wtBox.checked ? '1' : '0');
      } catch {
        // storage blocked
      }
    }
    const worktree = !!opts.worktreeOption && wtBox.checked;
    opts.onSubmit(text, { worktree, provider: provider?.value(), model: provider?.model(), effort: provider?.effort(), repos: worktree ? repos.value() : [] });
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  setTimeout(() => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, 30);
}

export function confirmDialog(title: string, body: string, confirmLabel: string, onConfirm: () => void) {
  const yes = h('button.btn.danger', { type: 'button' }, confirmLabel);
  const no = h('button.btn', { type: 'button' }, "취소");
  const el = h('div.modal', { role: 'alertdialog', 'aria-label': title }, h('header', {}, h('h2', {}, title)), h('div.body', {}, h('p', { style: 'margin:0;font-weight:700' }, body)), h('footer', {}, no, yes));
  const modal = openModal(el);
  no.addEventListener('click', () => modal.close());
  yes.addEventListener('click', () => {
    modal.close();
    onConfirm();
  });
  setTimeout(() => yes.focus(), 30);
}

export interface SendHomeOptions {
  workerId: string;
  name: string;
  /** The desk's label. */
  where: string;
  worktree: { path: string; branch: string };
  /** A worker across repositories: the folders of its workspace, its own floor's first (see WorkerInfo.repos). */
  repos?: string[];
  /** Asks the office what the worktree holds; the answer comes back through routeWorktreeMessage. */
  ask(): void;
  onConfirm(cleanup: WorktreeCleanup): void;
}

/** Whoever is waiting to hear what a worker's worktree holds, by worker id. */
const worktreeChecks = new Map<string, (state: WorktreeState) => void>();

export function routeWorktreeMessage(msg: ServerMsg) {
  if (msg.t !== 'worker.worktree') return;
  worktreeChecks.get(msg.workerId)?.(msg.state);
  worktreeChecks.delete(msg.workerId);
}

function inspectWorktree(workerId: string, ask: () => void): Promise<WorktreeState> {
  return new Promise((resolve) => {
    worktreeChecks.set(workerId, resolve);
    ask();
    setTimeout(() => {
      if (worktreeChecks.get(workerId) !== resolve) return;
      worktreeChecks.delete(workerId);
      resolve({ exists: true, dirty: 0, ahead: 0, unpushed: 0, error: "서버에서 응답이 없습니다" });
    }, 8000);
  });
}

const CLEANUP_LABEL: Record<WorktreeCleanup, string> = {
  all: "퇴근 및 worktree·브랜치 삭제",
  worktree: "퇴근 및 worktree 삭제",
  keep: "퇴근시키기",
};

/**
 * Sending home a worker that has its own worktree: pick what becomes of the worktree and its branch.
 * Opens on "keep" while the office checks the worktree, then suggests deleting when nothing would be lost.
 */
export function sendHomeDialog(opts: SendHomeOptions) {
  const { branch, path } = opts.worktree;
  const across = opts.repos && opts.repos.length > 1 ? opts.repos : undefined;
  const choices: [WorktreeCleanup, string, string][] = across
    ? [
        ['all', "worktree와 브랜치 삭제", `${across.join(', ')}의 worktree와 각 프로젝트의 ${branch}을(를) 삭제합니다.`],
        ['worktree', "worktree 삭제, 브랜치 보존", `각 프로젝트에 ${branch}을(를) 남겨 PR을 만들거나 나중에 다시 작업할 수 있습니다.`],
        ['keep', "모두 보존", "모두 그대로 보존합니다. 나중에 각 프로젝트에서 agent-office prune으로 정리할 수 있습니다."],
      ]
    : [
        ['all', "worktree와 브랜치 삭제", `${path}과(와) ${branch}을(를) 삭제합니다.`],
        ['worktree', "worktree 삭제, 브랜치 보존", `${branch}을(를) 남겨 PR을 만들거나 나중에 다시 작업할 수 있습니다.`],
        ['keep', "둘 다 보존", "모두 그대로 보존합니다. 나중에 agent-office prune으로 정리할 수 있습니다."],
      ];
  const radios = new Map<WorktreeCleanup, HTMLInputElement>();
  let touched = false;
  const yes = h('button.btn.danger', { type: 'submit' }, CLEANUP_LABEL.keep);
  const chosen = (): WorktreeCleanup => [...radios].find(([, r]) => r.checked)?.[0] ?? 'keep';
  const pick = (c: WorktreeCleanup) => {
    radios.get(c)!.checked = true;
    yes.textContent = CLEANUP_LABEL[c];
  };
  const list = h(
    'div.choices',
    {},
    ...choices.map(([value, title, sub]) => {
      const r = h('input', {
        type: 'radio',
        name: 'cleanup',
        value,
        onchange: () => {
          touched = true;
          yes.textContent = CLEANUP_LABEL[chosen()];
        },
      }) as HTMLInputElement;
      radios.set(value, r);
      return h('label.choice', {}, r, h('span', {}, title, h('small', {}, sub)));
    }),
  );
  const status = h('p.wt-status', {}, `${branch}의 변경 사항을 확인하는 중…`);
  const no = h('button.btn', { type: 'button' }, "취소");
  const form = h(
    'form.modal',
    { role: 'dialog', 'aria-label': `${opts.name}을(를) 퇴근시킬까요?` },
    h('header', {}, h('h2', {}, `${opts.name}을(를) 퇴근시킬까요?`)),
    h(
      'div.body',
      {},
      h('p', { style: 'margin:0 0 12px;font-weight:700' }, `${opts.where}의 세션을 종료하고 책상을 비웁니다. ${opts.name}은(는) 🌿 ${branch}에서 ${across ? `각 ${across.join(', ')}의 worktree에서` : "전용 worktree에서"} 작업했습니다:`),
      list,
      status,
    ),
    h('footer', {}, no, yes),
  ) as HTMLFormElement;
  pick('keep');
  const modal = openModal(form);
  no.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const cleanup = chosen();
    modal.close();
    opts.onConfirm(cleanup);
  });
  void inspectWorktree(opts.workerId, opts.ask).then((s) => {
    if (!form.isConnected) return;
    // Across repositories, a line for each worktree, named.
    const each = s.repos?.length ? s.repos.map((r) => describeState(r.state, branch, `${r.name}: `)) : [describeState(s, branch)];
    const lines = each.flatMap((d) => d.lines);
    const risky = each.some((d) => d.risky);
    if (s.repos?.length && s.error && !lines.length) lines.push(`worktree를 확인하지 못했습니다: ${s.error}.`);
    status.replaceChildren(...lines.flatMap((l, i) => (i ? [h('br'), l] : [l])));
    status.classList.toggle('warn', risky || (!!s.error && !s.repos?.length));
    if (!touched) pick(risky ? 'keep' : 'all');
  });
  setTimeout(() => yes.focus(), 30);
}

export interface LostWorktreeOptions {
  name: string;
  worktree: { path: string; branch: string };
  lost: { branch: LostBranch };
  /** A worker across repositories: its workspace folder, deleted with every worktree in it. */
  workspace?: string;
  /** The other workers on the floor whose worktrees were deleted too. */
  others: string[];
  /** Its process is still running, in the deleted folder: its terminal is there to look at. */
  openTerminal?: () => void;
  /** Puts the folder back, for `all` the others' too. */
  rebuild(all: boolean): void;
  sendHome(): void;
}

/**
 * A worker whose worktree was deleted outside agent-office (see WorkerInfo.lost): says what happened
 * and what's left, and puts it back (every lost worker's at once, when there are more), or sends it home.
 */
export function lostWorktreeDialog(opts: LostWorktreeOptions) {
  const { name, others } = opts;
  const { branch } = opts.worktree;
  const folder = opts.workspace ?? opts.worktree.path;
  const title = `🌿 ${name}의 worktree가 삭제되었습니다`;
  const what = {
    here: `🌿 ${branch} 브랜치는 남아 있습니다. 다시 만들면 같은 위치에서 브랜치를 복원하고 ${name}의 대화를 이어갑니다. 폴더 삭제와 함께 사라진 내용은 커밋하지 않은 변경뿐입니다.`,
    origin: `🌿 ${branch} 브랜치도 삭제됐지만 원격에 push되어 있습니다. 다시 만들면 origin에서 같은 위치로 복원하고 ${name}의 대화를 이어갑니다.`,
    gone: `🌿 ${branch} 브랜치도 삭제됐고 push 기록이 없어 작업 내용이 사라졌습니다. 다시 만들면 시작 지점에서 브랜치를 새로 생성하고 ${name}의 대화를 이어갑니다.`,
  }[opts.lost.branch];
  const one = h('button.btn.primary', { type: 'button' }, "worktree 다시 만들기");
  const all = others.length ? h('button.btn', { type: 'button' }, `${others.length + 1}개 모두 다시 만들기`) : null;
  const home = h('button.btn.danger', { type: 'button' }, "퇴근시키기…");
  const look = opts.openTerminal ? h('button.btn', { type: 'button' }, "터미널 열기") : null;
  const el = h(
    'div.modal.lost-worktree',
    { role: 'alertdialog', 'aria-label': title },
    h('header', {}, h('h2', {}, title)),
    h(
      'div.body',
      {},
      h('p', { style: 'margin:0 0 10px;font-weight:700' }, `Agent Office 외부에서 ${folder}이(가) 삭제되어 ${name}이(가) ${opts.openTerminal ? "이미 삭제된 폴더에서 실행 중입니다" : "해당 위치에서 시작할 수 없습니다"}.`),
      h('p.wt-status', { style: 'margin:0' }, what),
      others.length ? h('p.wt-status.warn', {}, `이 프로젝트의 ${plural(others.length, "다른 직원")}도 ${others.length === 1 ? "worktree" : "worktree"}을(를) 잃었습니다: ${others.join(', ')}.`) : null,
    ),
    h('footer', {}, home, h('span.grow'), look, all, one),
  );
  const modal = openModal(el);
  const then = (fn: () => void) => () => {
    modal.close();
    fn();
  };
  one.addEventListener('click', then(() => opts.rebuild(false)));
  all?.addEventListener('click', then(() => opts.rebuild(true)));
  home.addEventListener('click', then(opts.sendHome));
  if (look) look.addEventListener('click', then(opts.openTerminal!));
  setTimeout(() => one.focus(), 30);
}

/** What deleting one worktree (and its branch) would lose, in a line or two for the send-home dialog. */
function describeState(s: WorktreeState, branch: string, prefix = ''): { lines: string[]; risky: boolean } {
  if (s.error) return { lines: [`${prefix}worktree를 확인하지 못했습니다: ${s.error}.`], risky: true };
  const lines: string[] = [];
  let risky = false;
  if (!s.exists) lines.push(`${prefix}worktree 폴더가 이미 삭제되었습니다.`);
  if (s.dirty) {
    lines.push(`⚠️ worktree에 커밋하지 않은 변경 ${prefix}개가 있습니다. 삭제하면 해당 변경을 잃습니다.`);
    risky = true;
  }
  if (s.unpushed) {
    lines.push(`⚠️ ${branch}에 원격으로 보내지 않은 커밋 ${prefix}개가 있습니다. 브랜치를 삭제하면 잃습니다.`);
    risky = true;
  } else if (s.ahead) lines.push(`${branch}의 커밋 ${prefix}개는 모두 push 또는 병합되었습니다.`);
  if (!lines.length) lines.push(`${prefix}브랜치에 새 커밋이 없고 worktree도 깨끗하므로 삭제할 수 있습니다.`);
  return { lines, risky };
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
