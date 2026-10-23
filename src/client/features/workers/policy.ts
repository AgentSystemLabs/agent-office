import type { AgentEffort, AgentProvider, ClientMsg, WorkerInfo } from '../../../shared/protocol';
import type { PromptOptions } from '../../ui/prompt';
import type { DeskKey } from '../../interaction';

/** Runtime capabilities, not a provider choice. An empty policy keeps standalone behavior. */
export interface WorkerActionPolicy {
  requireInitialTask?: boolean;
  conversationLabel?: string;
  reviewFollowupDrafts?: boolean;
  releaseOnly?: boolean;
  shell?: boolean;
  repositories?: boolean;
  deskLabels?: boolean;
  boardAgents?: boolean;
  providerChoices?: boolean;
}

export function workerKeyAllowed(policy: WorkerActionPolicy, key: string): boolean {
  if (key === 'B') return policy.shell !== false;
  if (key === 'C' || key === 'O') return policy.repositories !== false;
  if (key === 'L') return policy.deskLabels !== false;
  return true;
}

export function workerPromptOptions(policy: WorkerActionPolicy, options: PromptOptions, hiring: boolean): PromptOptions {
  return {
    ...options,
    ...(hiring && policy.requireInitialTask ? {
      subtitle: 'An initial task is required. The new conversation inherits this floor’s settings.',
      placeholder: 'Required initial task…', allowEmpty: false,
    } : {}),
    ...(policy.providerChoices === false ? { providerOption: false } : {}),
    ...(policy.repositories === false ? { worktreeOption: false, repoOptions: undefined } : {}),
    ...(!hiring && policy.reviewFollowupDrafts ? {
      title: 'Review a follow-up draft',
      subtitle: `Review this draft in the ${policy.conversationLabel ?? 'worker conversation'}. Nothing is sent or queued automatically.`,
      submitLabel: 'Review draft in worker conversation', enterLabel: 'Enter to review draft', allowEmpty: false,
    } : {}),
  };
}

export function releaseWorkerCopy(name: string, where: string) {
  return {
    title: `Release ${name}’s desk?`,
    body: `This releases ${where} only. The conversation and any model work continue. Use Stop in the native conversation to stop work.`,
    submitLabel: 'Release desk',
  };
}

interface PolicyDeps {
  workerAtDesk(deskId: string): WorkerInfo | undefined;
  worker(id: string): WorkerInfo | undefined;
  desk(deskId: string): { label: string; station?: unknown; room?: boolean } | undefined;
  canHire(): boolean;
  hire(deskId: string, task: string): void;
  send(message: ClientMsg): void;
  openConversation(id: string): void;
  prompt(options: PromptOptions): void;
  confirm(title: string, body: string, submit: string, yes: () => void): void;
  notify(message: string): void;
}

/** Pure action boundary, shared by hotkeys and direct feature callbacks. It does not select a runtime. */
export function createWorkerPolicy(policy: WorkerActionPolicy, deps: PolicyDeps) {
  const unavailable = () => deps.notify('This action is not connected in this runtime. Use the worker conversation.');
  const blockBoard = () => {
    if (policy.boardAgents !== false) return false;
    deps.notify('GitHub boards and board agents are not connected in this runtime.');
    return true;
  };
  const requestTask = (deskId: string) => {
    if (!deps.canHire()) return;
    deps.prompt(workerPromptOptions(policy, {
      title: `✨ New task at ${deps.desk(deskId)?.label ?? 'the desk'}`,
      submitLabel: 'Hire & start',
      onSubmit: task => { if (task.trim()) deps.hire(deskId, task.trim()); },
    }, true));
  };
  const release = (id: string) => {
    if (!policy.releaseOnly) return false;
    const w = deps.worker(id);
    if (w) {
      const copy = releaseWorkerCopy(w.name, deps.desk(w.deskId)?.label ?? 'the desk');
      deps.confirm(copy.title, copy.body, copy.submitLabel, () => deps.send({ t: 'worker.kill', workerId: id }));
    }
    return true;
  };
  return {
    unavailable, blockBoard, release,
    desk(deskId: string, key: DeskKey): boolean {
      if (!workerKeyAllowed(policy, key)) { unavailable(); return true; }
      const desk = deps.desk(deskId);
      if ((desk?.station || desk?.room) && blockBoard()) return true;
      const worker = deps.workerAtDesk(deskId);
      if (!worker && policy.requireInitialTask && (key === 'E' || key === 'P')) { requestTask(deskId); return true; }
      if (worker && policy.conversationLabel && (key === 'E' || key === 'R')) { deps.openConversation(worker.id); return true; }
      if (worker && key === 'P' && policy.reviewFollowupDrafts) {
        deps.prompt(workerPromptOptions(policy, {
          title: `Prompt ${worker.name}`,
          onSubmit: task => { if (task.trim()) deps.send({ t: 'worker.prompt', workerId: worker.id, prompt: task.trim() }); },
        }, false));
        return true;
      }
      return !!worker && key === 'X' && release(worker.id);
    },
    allowHire(deskId: string, prompt?: string, worktree = false, provider?: AgentProvider, model?: string, effort?: AgentEffort,
      issue?: number, repos?: string[], via?: string): boolean {
      if ((deps.desk(deskId)?.station || issue !== undefined || via) && blockBoard()) return false;
      if ((policy.repositories === false && (worktree || repos?.length)) ||
        (policy.providerChoices === false && (provider !== undefined || model !== undefined || effort !== undefined))) {
        unavailable(); return false;
      }
      if (policy.requireInitialTask && !prompt?.trim()) { requestTask(deskId); return false; }
      return true;
    },
  };
}

export function workerPolicyHint(policy: WorkerActionPolicy, worker: WorkerInfo | undefined, deskLabel: string, status: string) {
  if (!Object.keys(policy).length) return null;
  const keys: [DeskKey, string][] = [];
  if (!worker) {
    keys.push(['E', policy.requireInitialTask ? 'Hire with required task' : 'Hire a worker'], ['P', 'Hire with a task']);
    if (policy.shell !== false) keys.push(['B', 'Shell']);
  } else {
    keys.push(['E', policy.conversationLabel ? 'Open worker conversation' : 'Open terminal']);
    if (policy.repositories !== false) keys.push(['C', 'Changes']);
    keys.push(['P', policy.reviewFollowupDrafts ? 'Review follow-up draft' : 'Prompt']);
    if (policy.repositories !== false && worker.pr) keys.push(['O', `PR #${worker.pr.number}`]);
    keys.push(['X', policy.releaseOnly ? 'Release desk' : 'Send home']);
  }
  if (policy.deskLabels !== false) keys.push(['L', 'Label']);
  return { title: worker ? `${worker.name} · ${status}` : `${deskLabel} · empty`, keys };
}
