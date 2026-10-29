import type { Ctx } from '../office/context.js';
import type { EditorialRepository } from './repository.js';
import { id, now } from './ids.js';
import type { TaskContract } from './types.js';

interface FloorLike {
  id: string;
  def: { name: string };
  queue: { add(prompt: string, by: string, title?: string, issue?: number, provider?: 'claude' | 'opencode' | 'codex' | 'grok' | 'muse' | 'dsh' | 'pi' | 'cursor' | 'custom', model?: string, effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max', owner?: string): string | undefined };
  workers: { list(): Array<{ id: string; name: string; status: string }> };
}

export interface AgentOfficeDispatch {
  dispatched: boolean;
  requestId: string;
  floorId?: string;
  error?: string;
}

/**
 * Keeps editorial runs associated with Agent Office without requiring each book to be a public git
 * repository. The queue dispatch is deliberately opt-in: a configured floor is required and the
 * existing Agent Office queue remains the authority for worker lifecycle.
 */
export class AgentOfficeAdapter {
  private ctx?: Pick<Ctx, 'floors'>;

  constructor(private readonly repo: EditorialRepository, private readonly configuredFloor?: string, private readonly provider: FloorLike['queue'] extends { add: (...args: infer A) => unknown } ? A[4] : never = 'claude') {}

  bind(ctx: Pick<Ctx, 'floors'>): void {
    this.ctx = ctx;
  }

  dispatch(task: TaskContract, prompt: string, owner = 'editorial'): AgentOfficeDispatch {
    const requestId = id('office_request');
    const floor = this.floor();
    if (!floor) return { dispatched: false, requestId, error: this.configuredFloor ? `Agent Office floor not found: ${this.configuredFloor}` : 'EDITORIAL_AGENT_OFFICE_FLOOR is not configured' };
    const error = floor.queue.add(prompt, owner, `Editorial ${task.roleId}: ${task.objective.slice(0, 90)}`, undefined, this.provider as any);
    if (error) return { dispatched: false, requestId, floorId: floor.id, error };
    this.repo.audit(owner, 'agent-office.queue.dispatch', task.projectId, task.taskId, undefined, { requestId, floorId: floor.id, roleId: task.roleId, dispatchedAt: now() });
    return { dispatched: true, requestId, floorId: floor.id };
  }

  workers(): Array<{ floorId: string; floorName: string; workerId: string; name: string; status: string }> {
    const floors = this.ctx ? [...this.ctx.floors.values()] as unknown as FloorLike[] : [];
    return floors.flatMap((floor) => floor.workers.list().map((worker) => ({ floorId: floor.id, floorName: floor.def.name, workerId: worker.id, name: worker.name, status: worker.status })));
  }

  private floor(): FloorLike | undefined {
    if (!this.ctx) return undefined;
    const floors = [...this.ctx.floors.values()] as unknown as FloorLike[];
    if (!this.configuredFloor) return undefined;
    return floors.find((floor) => floor.id === this.configuredFloor || floor.def.name === this.configuredFloor);
  }
}
