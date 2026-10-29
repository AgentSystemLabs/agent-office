import { id, now } from './ids.js';
import type { EditorialRepository } from './repository.js';
import type { TaskContract, TaskResult, UsageSnapshot } from './types.js';

export interface ExecutionContext {
  task: TaskContract;
  runId: string;
  generation: number;
  signal: AbortSignal;
  checkpoint(state: unknown): void;
  heartbeat(): boolean;
}

export type TaskExecutor = (context: ExecutionContext) => Promise<TaskResult>;

export interface OrchestratorOptions {
  maxConcurrent: number;
  budgetUsd?: number;
  leaseMs: number;
  pollMs: number;
  owner: string;
  estimateCost(task: TaskContract): number;
  executor: TaskExecutor;
  onEvent?: (event: { type: string; taskId?: string; runId?: string; detail?: string }) => void;
}

export class EditorialOrchestrator {
  private readonly active = new Map<string, { owner: string; controller: AbortController; generation: number }>();
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private pumping = false;

  constructor(readonly repo: EditorialRepository, readonly options: OrchestratorOptions) {}

  start(automatic = true): void {
    this.stopped = false;
    this.repo.recoverExpiredLeases();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!automatic) return;
    this.timer = setInterval(() => this.pump(), this.options.pollMs);
    void this.pump();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const run of this.active.values()) run.controller.abort();
    this.active.clear();
  }

  async pump(projectId?: string): Promise<void> {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    try {
      this.repo.recoverExpiredLeases();
      while (!this.stopped && this.active.size < Math.max(1, Math.floor(this.options.maxConcurrent))) {
        const taskId = this.repo.readyTasks(1, projectId)[0];
        if (!taskId) break;
        const task = this.repo.getTask(taskId);
        if (!task) break;
        const estimate = Math.max(0, this.options.estimateCost(task.contract));
        const reservationId = this.repo.reserveBudget(task.contract.projectId, task.contract.taskId, 'pending', estimate, this.options.budgetUsd);
        if (!reservationId) {
          this.options.onEvent?.({ type: 'budget_blocked', taskId, detail: 'No hay presupuesto disponible para reservar esta tarea.' });
          break;
        }
        const leaseOwner = `${this.options.owner}:${id('lease')}`;
        const leaseUntil = new Date(Date.now() + this.options.leaseMs).toISOString();
        const claimed = this.repo.claimTask(taskId, leaseOwner, leaseUntil);
        if (!claimed) {
          this.repo.settleBudget(reservationId, { source: 'unavailable' });
          continue;
        }
        const runId = id('run');
        const controller = new AbortController();
        this.active.set(taskId, { owner: leaseOwner, controller, generation: claimed.generation });
        this.repo.recordRun({ runId, taskId, roleId: claimed.contract.roleId, provider: 'pending', profileVersion: 'pending', status: 'started', startedAt: now() });
        this.options.onEvent?.({ type: 'task_started', taskId, runId });
        void this.execute(claimed.contract, taskId, claimed.generation, leaseOwner, runId, reservationId, controller, projectId);
      }
    } finally {
      this.pumping = false;
    }
  }

  cancel(taskId: string): boolean {
    const current = this.active.get(taskId);
    current?.controller.abort();
    const changed = this.repo.cancelTask(taskId, 'Cancelada por el propietario u orquestador');
    if (changed) this.options.onEvent?.({ type: 'task_cancelled', taskId });
    return changed;
  }

  private async execute(task: TaskContract, taskId: string, generation: number, leaseOwner: string, runId: string, reservationId: string, controller: AbortController, pumpProjectId?: string): Promise<void> {
    const heartbeatTimer = setInterval(() => {
      const ok = this.repo.heartbeat(taskId, leaseOwner, new Date(Date.now() + this.options.leaseMs).toISOString());
      if (!ok) controller.abort();
    }, Math.max(1000, Math.floor(this.options.leaseMs / 3)));
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, task.timeoutSeconds * 1000));
    const context: ExecutionContext = {
      task, runId, generation, signal: controller.signal,
      checkpoint: (state) => this.repo.saveCheckpoint(taskId, generation, state),
      heartbeat: () => this.repo.heartbeat(taskId, leaseOwner, new Date(Date.now() + this.options.leaseMs).toISOString()),
    };
    try {
      let result: TaskResult;
      try {
        result = await this.options.executor(context);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown task failure';
        result = { taskId, runId, state: controller.signal.aborted ? 'cancelled' : 'failed', actionSummary: message, provider: 'unknown', profileVersion: 'unknown', artifacts: [], findings: [], blockers: [message], uncertainties: [], evidence: [], usage: { source: 'unavailable' } };
      }
      const accepted = this.repo.completeTask(taskId, leaseOwner, generation, result);
      this.repo.settleBudget(reservationId, result.usage);
      this.repo.finishRun(runId, accepted ? result.state : 'cancelled', accepted ? result.actionSummary : 'Resultado tardío descartado porque la generación ya no es vigente.');
      this.options.onEvent?.({ type: accepted ? 'task_finished' : 'late_result_discarded', taskId, runId, detail: result.actionSummary });
    } finally {
      clearInterval(heartbeatTimer);
      clearTimeout(timeout);
      this.active.delete(taskId);
      void this.pump(pumpProjectId);
    }
  }
}

export function unavailableUsage(): UsageSnapshot {
  return { source: 'unavailable' };
}
