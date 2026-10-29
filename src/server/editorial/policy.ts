import { createHash, randomBytes } from 'node:crypto';
import type { EditorialRepository } from './repository.js';
import { hashText, id, json, now } from './ids.js';
import { canUseApproval, roleCanApprove, roleCanAssignTask, roleCanCreateTask, roleCanPublish } from './state.js';
import type { ApprovalAction, ApprovalRecord, ArtifactRef, ProjectRecord, ReleaseCandidate, RoleId } from './types.js';

export type Actor = 'owner' | 'orchestrator' | RoleId;

export function assertTaskAuthority(actor: Actor, operation: 'create' | 'assign'): void {
  const allowed = operation === 'create' ? roleCanCreateTask(actor) : roleCanAssignTask(actor);
  if (!allowed) throw new Error(`${actor} cannot ${operation} editorial tasks`);
}

export function assertApprovalAuthority(actor: Actor, action: ApprovalAction): void {
  if (!roleCanApprove(actor, action)) throw new Error(`${actor} cannot approve ${action}`);
}

export function assertPublishAuthority(actor: Actor): void {
  if (!roleCanPublish(actor)) throw new Error(`${actor} cannot publish`);
}

export interface ApprovalRequest {
  projectId: string;
  action: ApprovalAction;
  subjectId: string;
  subject: unknown;
  ownerId: string;
  ttlMs?: number;
}

export function requestApproval(repo: EditorialRepository, actor: Actor, request: ApprovalRequest): { record: ApprovalRecord; token: string } {
  assertApprovalAuthority(actor, request.action);
  const token = randomBytes(24).toString('base64url');
  const createdAt = now();
  const record: ApprovalRecord = {
    id: id('approval'), projectId: request.projectId, action: request.action, subjectId: request.subjectId,
    subjectHash: hashText(json(request.subject)), ownerId: request.ownerId, state: 'pending', tokenHash: hashText(token),
    expiresAt: new Date(Date.now() + (request.ttlMs ?? 24 * 60 * 60 * 1000)).toISOString(), createdAt,
  };
  repo.createApproval(record);
  repo.audit(actor, 'approval.request', request.projectId, undefined, record.subjectHash, { action: record.action, subjectId: record.subjectId });
  return { record, token };
}

export function consumeApproval(repo: EditorialRepository, actor: Actor, token: string, expected: Pick<ApprovalRequest, 'projectId' | 'action' | 'subjectId' | 'subject' | 'ownerId'>): ApprovalRecord {
  if (actor !== 'owner') throw new Error('Only the owner can consume an approval');
  const subjectHash = hashText(json(expected.subject));
  const record = repo.consumeApproval(hashText(token), expected.ownerId, expected.action, expected.subjectId, subjectHash);
  if (!record || record.projectId !== expected.projectId || !canUseApproval('pending', record.expiresAt)) throw new Error('Approval is invalid, expired, already used, or for another version');
  repo.audit(actor, 'approval.consume', expected.projectId, expected.subjectId, subjectHash, { action: expected.action });
  return record;
}

export function createReleaseCandidate(repo: EditorialRepository, project: ProjectRecord, artifacts: ArtifactRef[], metadata: Record<string, unknown>, auditStatus: ReleaseCandidate['auditStatus'] = 'not_run'): ReleaseCandidate {
  const owned = artifacts.filter((artifact) => artifact.projectId === project.id);
  if (owned.length !== artifacts.length || artifacts.length === 0) throw new Error('Release artifacts must belong to the project and cannot be empty');
  const artifactIds = artifacts.map((artifact) => artifact.id);
  const manifestHash = hashText(json({ projectId: project.id, artifactIds: [...artifactIds].sort(), hashes: artifacts.map((artifact) => [artifact.id, artifact.sha256]).sort(), metadata }));
  const candidate: ReleaseCandidate = { id: id('release'), projectId: project.id, manifestHash, artifactIds, metadata, auditStatus, state: auditStatus === 'approved' ? 'approved' : 'draft', createdAt: now() };
  repo.createRelease(candidate);
  repo.audit('orchestrator', 'release.create', project.id, candidate.id, manifestHash, { artifactIds });
  return candidate;
}

export function assertReleaseIsPublishable(repo: EditorialRepository, candidate: ReleaseCandidate, approval: ApprovalRecord): void {
  if (candidate.auditStatus !== 'approved' || candidate.state !== 'approved') throw new Error('Release candidate is not independently audited and approved');
  if (approval.action !== 'publish' || approval.subjectId !== candidate.id || approval.subjectHash !== hashText(json(candidate))) throw new Error('Approval does not match the exact release candidate');
  if (!canUseApproval(approval.state, approval.expiresAt)) throw new Error('Approval is not usable');
}
