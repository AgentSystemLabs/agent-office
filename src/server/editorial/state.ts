import type { ApprovalAction, ApprovalState, ProjectStage, RoleId, TaskState } from './types.js';

const projectTransitions: Record<ProjectStage, readonly ProjectStage[]> = {
  idea: ['research', 'brief', 'paused', 'blocked', 'archived'],
  research: ['brief', 'paused', 'blocked', 'archived'],
  brief: ['concept_approval', 'research', 'paused', 'blocked', 'archived'],
  concept_approval: ['planning', 'brief', 'paused', 'blocked', 'archived'],
  planning: ['writing', 'editing', 'paused', 'blocked', 'archived'],
  writing: ['editing', 'verification', 'paused', 'blocked', 'archived'],
  editing: ['writing', 'verification', 'paused', 'blocked', 'archived'],
  verification: ['rights', 'art', 'layout', 'editing', 'paused', 'blocked', 'archived'],
  rights: ['art', 'layout', 'candidate', 'verification', 'paused', 'blocked', 'archived'],
  art: ['layout', 'candidate', 'rights', 'paused', 'blocked', 'archived'],
  layout: ['candidate', 'art', 'verification', 'paused', 'blocked', 'archived'],
  candidate: ['audit', 'layout', 'rights', 'paused', 'blocked', 'archived'],
  audit: ['kdp_preparation', 'candidate', 'paused', 'blocked', 'archived'],
  kdp_preparation: ['marketing', 'published', 'audit', 'paused', 'blocked', 'archived'],
  marketing: ['published', 'kdp_preparation', 'paused', 'blocked', 'archived'],
  published: ['marketing', 'archived'],
  paused: ['idea', 'research', 'brief', 'concept_approval', 'planning', 'writing', 'editing', 'verification', 'rights', 'art', 'layout', 'candidate', 'audit', 'kdp_preparation', 'marketing', 'published', 'blocked', 'archived'],
  blocked: ['idea', 'research', 'brief', 'concept_approval', 'planning', 'writing', 'editing', 'verification', 'rights', 'art', 'layout', 'candidate', 'audit', 'kdp_preparation', 'marketing', 'paused', 'archived'],
  archived: [],
};

const taskTransitions: Record<TaskState, readonly TaskState[]> = {
  pending: ['blocked', 'ready', 'cancelled'],
  blocked: ['pending', 'ready', 'cancelled'],
  ready: ['running', 'blocked', 'cancelled'],
  running: ['waiting_user', 'completed', 'failed', 'cancelled', 'uncertain'],
  waiting_user: ['ready', 'running', 'cancelled'],
  completed: ['ready'],
  failed: ['ready', 'cancelled'],
  cancelled: [],
  uncertain: ['ready', 'cancelled'],
};

export function canTransitionProject(from: ProjectStage, to: ProjectStage): boolean {
  return from === to || projectTransitions[from].includes(to);
}

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  return from === to || taskTransitions[from].includes(to);
}

export function assertProjectTransition(from: ProjectStage, to: ProjectStage): void {
  if (!canTransitionProject(from, to)) throw new Error(`Invalid project transition: ${from} -> ${to}`);
}

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!canTransitionTask(from, to)) throw new Error(`Invalid task transition: ${from} -> ${to}`);
}

export function roleCanCreateTask(actor: 'owner' | 'orchestrator' | RoleId): boolean {
  return actor === 'owner' || actor === 'orchestrator' || actor === 'editorial-director';
}

export function roleCanAssignTask(actor: 'owner' | 'orchestrator' | RoleId): boolean {
  return actor === 'owner' || actor === 'orchestrator' || actor === 'editorial-director';
}

export function roleCanApprove(actor: 'owner' | 'orchestrator' | RoleId, action: ApprovalAction): boolean {
  return actor === 'owner' && (action === 'concept' || action === 'scope' || action === 'release' || action === 'publish' || action === 'social_batch' || action === 'external_expense' || action === 'legal_filing');
}

export function roleCanPublish(actor: 'owner' | 'orchestrator' | RoleId): boolean {
  return actor === 'owner';
}

export function canUseApproval(state: ApprovalState, expiresAt: string, now = new Date()): boolean {
  return (state === 'pending' || state === 'approved') && Date.parse(expiresAt) > now.getTime();
}
