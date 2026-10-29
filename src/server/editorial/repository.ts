import type { EditorialDatabase } from './db.js';
import { hashText, id, json, now, parseJson } from './ids.js';
import type { AgentRunRecord, ApprovalRecord, ArtifactRef, CapabilityRow, Finding, ProjectBrief, ProjectRecord, ReleaseCandidate, RoleId, TaskContract, TaskResult, TaskState, UsageSnapshot } from './types.js';
import { initialCapabilities } from './capabilities.js';

type Row = Record<string, unknown>;

export class EditorialRepository {
  constructor(readonly db: EditorialDatabase) {
    this.seedCapabilities();
  }

  createProject(brief: ProjectBrief): ProjectRecord {
    const project: ProjectRecord = { id: id('project'), title: brief.provisionalTitle, stage: 'idea', paused: false, brief, createdAt: now(), updatedAt: now() };
    this.db.run('INSERT INTO projects(id,title,stage,paused,brief_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', project.id, project.title, project.stage, 0, json(project.brief), project.createdAt, project.updatedAt);
    this.audit('owner', 'project.create', project.id, undefined, undefined, { title: project.title });
    return project;
  }

  getProject(projectId: string): ProjectRecord | undefined {
    const row = this.db.get<Row>('SELECT * FROM projects WHERE id = ?', projectId);
    return row ? projectRow(row) : undefined;
  }

  listProjects(): ProjectRecord[] {
    return this.db.all<Row>('SELECT * FROM projects ORDER BY updated_at DESC').map(projectRow);
  }

  updateProjectStage(projectId: string, stage: ProjectRecord['stage'], paused = stage === 'paused'): void {
    const updatedAt = now();
    this.db.run('UPDATE projects SET stage = ?, paused = ?, updated_at = ? WHERE id = ?', stage, paused ? 1 : 0, updatedAt, projectId);
    if (!this.db.get('SELECT 1 AS ok FROM projects WHERE id = ?', projectId)) throw new Error('Project not found');
  }

  createTask(contract: TaskContract, state: TaskState = 'pending'): void {
    const createdAt = now();
    this.db.transaction(() => {
      this.db.run('INSERT INTO tasks(id,project_id,edition_id,role_id,state,contract_json,max_attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', contract.taskId, contract.projectId, contract.editionId ?? null, contract.roleId, state, json(contract), contract.maxAttempts, createdAt, createdAt);
      for (const dep of contract.dependencyTaskIds) this.db.run('INSERT INTO task_dependencies(task_id,depends_on) VALUES (?,?)', contract.taskId, dep);
    });
    this.audit('orchestrator', 'task.create', contract.projectId, contract.taskId, undefined, { roleId: contract.roleId });
  }

  getTask(taskId: string): { contract: TaskContract; state: TaskState; attempts: number; generation: number; leaseOwner?: string; leaseUntil?: string; updatedAt: string; result?: TaskResult } | undefined {
    const row = this.db.get<Row>('SELECT * FROM tasks WHERE id = ?', taskId);
    return row ? taskRow(row) : undefined;
  }

  listTasks(projectId?: string): Array<{ contract: TaskContract; state: TaskState; attempts: number; generation: number; updatedAt: string }> {
    const rows = projectId ? this.db.all<Row>('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at', projectId) : this.db.all<Row>('SELECT * FROM tasks ORDER BY created_at');
    return rows.map(taskRow);
  }

  readyTasks(limit: number): string[] {
    const rows = this.db.all<{ id: string }>(`SELECT t.id FROM tasks t WHERE t.state IN ('pending','ready','uncertain') AND NOT EXISTS (
      SELECT 1 FROM task_dependencies d JOIN tasks dep ON dep.id = d.depends_on WHERE d.task_id = t.id AND dep.state <> 'completed'
    ) ORDER BY t.created_at LIMIT ?`, limit);
    return rows.map((row) => row.id);
  }

  claimTask(taskId: string, owner: string, leaseUntil: string): { contract: TaskContract; generation: number } | undefined {
    return this.db.transaction(() => {
      const task = this.getTask(taskId);
      if (!task || !['pending', 'ready', 'uncertain'].includes(task.state)) return undefined;
      const generation = task.generation + 1;
      const result = this.db.run('UPDATE tasks SET state = ?, attempts = attempts + 1, generation = ?, lease_owner = ?, lease_until = ?, heartbeat_at = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND state IN (\'pending\',\'ready\',\'uncertain\')', 'running', generation, owner, leaseUntil, now(), now(), now(), taskId);
      if (!result.changes) return undefined;
      return { contract: task.contract, generation };
    });
  }

  heartbeat(taskId: string, owner: string, leaseUntil: string): boolean {
    return Number(this.db.run('UPDATE tasks SET lease_until = ?, heartbeat_at = ?, updated_at = ? WHERE id = ? AND state = \'running\' AND lease_owner = ?', leaseUntil, now(), now(), taskId, owner).changes) > 0;
  }

  completeTask(taskId: string, owner: string, generation: number, result: TaskResult): boolean {
    return Number(this.db.run('UPDATE tasks SET state = ?, result_json = ?, lease_owner = NULL, lease_until = NULL, updated_at = ?, completed_at = ? WHERE id = ? AND state = \'running\' AND lease_owner = ? AND generation = ?', result.state, json(result), now(), now(), taskId, owner, generation).changes) > 0;
  }

  saveCheckpoint(taskId: string, generation: number, state: unknown): void {
    this.db.run('INSERT INTO checkpoints(id,task_id,generation,state_json,created_at) VALUES (?,?,?,?,?)', id('checkpoint'), taskId, generation, json(state), now());
  }

  recordRun(run: AgentRunRecord): void {
    this.db.run('INSERT INTO agent_runs(id,task_id,role_id,provider,model,profile_version,office_worker_id,office_floor_id,status,action_summary,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', run.runId, run.taskId, run.roleId, run.provider, run.model ?? null, run.profileVersion, run.officeWorkerId ?? null, run.officeFloorId ?? null, run.status, run.actionSummary ?? null, run.startedAt, run.finishedAt ?? null);
  }

  finishRun(runId: string, status: AgentRunRecord['status'], summary: string): void {
    this.db.run('UPDATE agent_runs SET status = ?, action_summary = ?, finished_at = ? WHERE id = ?', status, summary, now(), runId);
  }

  recordArtifact(artifact: ArtifactRef): void {
    this.db.run('INSERT INTO artifacts(id,project_id,edition_id,task_id,revision_id,type,path,sha256,size_bytes,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', artifact.id, artifact.projectId, artifact.editionId ?? null, artifact.taskId ?? null, artifact.revisionId ?? null, artifact.type, artifact.path, artifact.sha256, artifact.sizeBytes, json(artifact.metadata), now());
  }

  listArtifacts(projectId: string): ArtifactRef[] {
    return this.db.all<Row>('SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at', projectId).map(artifactRow);
  }

  addFinding(projectId: string, finding: Finding, taskId?: string): string {
    const findingId = finding.id ?? id('finding');
    this.db.run('INSERT INTO findings(id,project_id,task_id,severity,title,detail,location,resolution,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', findingId, projectId, taskId ?? null, finding.severity, finding.title, finding.detail, finding.location ?? null, finding.resolution ?? null, finding.status, now());
    return findingId;
  }

  createApproval(record: ApprovalRecord): void {
    this.db.run('INSERT INTO approvals(id,project_id,action,subject_id,subject_hash,owner_id,state,token_hash,expires_at,created_at,used_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', record.id, record.projectId, record.action, record.subjectId, record.subjectHash, record.ownerId, record.state, record.tokenHash, record.expiresAt, record.createdAt, record.usedAt ?? null);
  }

  consumeApproval(tokenHash: string, ownerId: string, action: ApprovalRecord['action'], subjectId: string, subjectHash: string): ApprovalRecord | undefined {
    return this.db.transaction(() => {
      const row = this.db.get<Row>('SELECT * FROM approvals WHERE token_hash = ? AND owner_id = ? AND action = ? AND subject_id = ? AND subject_hash = ?', tokenHash, ownerId, action, subjectId, subjectHash);
      if (!row || row.state !== 'pending' || Date.parse(String(row.expires_at)) <= Date.now()) return undefined;
      const usedAt = now();
      const changed = this.db.run('UPDATE approvals SET state = \'used\', used_at = ? WHERE id = ? AND state = \'pending\'', usedAt, String(row.id));
      if (!changed.changes) return undefined;
      return approvalRow({ ...row, state: 'used', used_at: usedAt });
    });
  }

  listApprovals(projectId?: string): ApprovalRecord[] {
    const rows = projectId ? this.db.all<Row>('SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at DESC', projectId) : this.db.all<Row>('SELECT * FROM approvals ORDER BY created_at DESC');
    return rows.map(approvalRow);
  }

  createRelease(candidate: ReleaseCandidate): void {
    this.db.run('INSERT INTO releases(id,project_id,manifest_hash,artifact_ids_json,metadata_json,audit_status,state,created_at) VALUES (?,?,?,?,?,?,?,?)', candidate.id, candidate.projectId, candidate.manifestHash, json(candidate.artifactIds), json(candidate.metadata), candidate.auditStatus, candidate.state, candidate.createdAt);
  }

  getRelease(releaseId: string): ReleaseCandidate | undefined {
    const row = this.db.get<Row>('SELECT * FROM releases WHERE id = ?', releaseId);
    return row ? releaseRow(row) : undefined;
  }

  listReleases(projectId?: string): ReleaseCandidate[] {
    const rows = projectId ? this.db.all<Row>('SELECT * FROM releases WHERE project_id = ? ORDER BY created_at DESC', projectId) : this.db.all<Row>('SELECT * FROM releases ORDER BY created_at DESC');
    return rows.map(releaseRow);
  }

  invalidateProjectOutputs(projectId: string, reason: string): void {
    this.db.transaction(() => {
      this.db.run('UPDATE releases SET state = \'needs_changes\', audit_status = \'needs_changes\' WHERE project_id = ? AND state IN (\'approved\',\'prepared\',\'assisted\')', projectId);
      this.db.run('UPDATE approvals SET state = \'revoked\' WHERE project_id = ? AND state = \'pending\'', projectId);
      this.audit('system', 'outputs.invalidate', projectId, undefined, undefined, { reason });
    });
  }

  listFindings(projectId?: string): Finding[] {
    const rows = projectId ? this.db.all<Row>('SELECT * FROM findings WHERE project_id = ? ORDER BY created_at', projectId) : this.db.all<Row>('SELECT * FROM findings ORDER BY created_at');
    return rows.map((row) => ({ id: String(row.id), severity: row.severity as Finding['severity'], title: String(row.title), detail: String(row.detail), location: row.location ? String(row.location) : undefined, resolution: row.resolution ? String(row.resolution) : undefined, status: row.status as Finding['status'] }));
  }

  rememberTelegramUpdate(updateId: number): boolean {
    try {
      this.db.run('INSERT INTO telegram_updates(update_id,received_at) VALUES (?,?)', updateId, now());
      return true;
    } catch {
      return false;
    }
  }

  saveCapabilities(rows: CapabilityRow[]): void {
    this.db.transaction(() => {
      for (const row of rows) this.db.run('INSERT INTO capability_matrix(capability,component,state,evidence_json,dependency,limitation,checked_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(capability) DO UPDATE SET component=excluded.component,state=excluded.state,evidence_json=excluded.evidence_json,dependency=excluded.dependency,limitation=excluded.limitation,checked_at=excluded.checked_at', row.capability, row.component, row.state, json(row.evidence), row.dependency ?? null, row.limitation ?? null, row.checkedAt);
    });
  }

  capabilities(): CapabilityRow[] {
    return this.db.all<Row>('SELECT * FROM capability_matrix ORDER BY capability').map((row) => ({ capability: String(row.capability), component: String(row.component), state: row.state as CapabilityRow['state'], evidence: parseJson<string[]>(row.evidence_json, []), dependency: row.dependency ? String(row.dependency) : undefined, limitation: row.limitation ? String(row.limitation) : undefined, checkedAt: String(row.checked_at) }));
  }

  recordCost(projectId: string | undefined, taskId: string | undefined, provider: string, usage: UsageSnapshot, reservedUsd = 0): void {
    this.db.run('INSERT INTO cost_events(id,project_id,task_id,provider,estimated_usd,observed_usd,reserved_usd,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)', id('cost'), projectId ?? null, taskId ?? null, provider, usage.estimatedCostUsd ?? 0, usage.observedCostUsd ?? 0, reservedUsd, usage.source, now());
  }

  usageTotals(): { estimatedUsd: number; observedUsd: number; reservedUsd: number } {
    const row = this.db.get<{ estimated: number; observed: number; reserved: number }>('SELECT COALESCE(SUM(estimated_usd),0) AS estimated, COALESCE(SUM(observed_usd),0) AS observed, COALESCE(SUM(reserved_usd),0) AS reserved FROM cost_events');
    return { estimatedUsd: Number(row?.estimated ?? 0), observedUsd: Number(row?.observed ?? 0), reservedUsd: Number(row?.reserved ?? 0) };
  }

  audit(actor: string, action: string, projectId?: string, taskId?: string, subjectHash?: string, detail: unknown = {}): void {
    this.db.run('INSERT INTO audit_events(id,actor,action,project_id,task_id,subject_hash,detail_json,created_at) VALUES (?,?,?,?,?,?,?,?)', id('audit'), actor, action, projectId ?? null, taskId ?? null, subjectHash ?? null, json(detail), now());
  }

  private seedCapabilities(): void {
    if (this.db.get('SELECT 1 AS ok FROM capability_matrix LIMIT 1')) return;
    this.saveCapabilities(initialCapabilities());
  }
}

function projectRow(row: Row): ProjectRecord {
  return { id: String(row.id), title: String(row.title), stage: row.stage as ProjectRecord['stage'], paused: Number(row.paused) === 1, brief: parseJson<ProjectBrief>(row.brief_json, { provisionalTitle: String(row.title), collaborators: [], language: 'es', locale: 'es-419', desiredFormats: ['epub'] }), activeRevisionId: row.active_revision_id ? String(row.active_revision_id) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function taskRow(row: Row) {
  return { contract: parseJson<TaskContract>(row.contract_json, { taskId: String(row.id), projectId: String(row.project_id), roleId: row.role_id as RoleId, objective: '', scope: '', inputRevisionIds: [], dependencyTaskIds: [], acceptanceCriteria: [], tools: [], timeoutSeconds: 900, maxAttempts: Number(row.max_attempts), resultDestination: '' }), state: row.state as TaskState, attempts: Number(row.attempts), generation: Number(row.generation), leaseOwner: row.lease_owner ? String(row.lease_owner) : undefined, leaseUntil: row.lease_until ? String(row.lease_until) : undefined, updatedAt: String(row.updated_at), result: row.result_json ? parseJson<TaskResult | undefined>(row.result_json, undefined) : undefined };
}

function artifactRow(row: Row): ArtifactRef {
  return { id: String(row.id), type: row.type as ArtifactRef['type'], projectId: String(row.project_id), editionId: row.edition_id ? String(row.edition_id) : undefined, taskId: row.task_id ? String(row.task_id) : undefined, revisionId: row.revision_id ? String(row.revision_id) : undefined, path: String(row.path), sha256: String(row.sha256), sizeBytes: Number(row.size_bytes), metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}) };
}

function approvalRow(row: Row): ApprovalRecord {
  return { id: String(row.id), projectId: String(row.project_id), action: row.action as ApprovalRecord['action'], subjectId: String(row.subject_id), subjectHash: String(row.subject_hash), ownerId: String(row.owner_id), state: row.state as ApprovalRecord['state'], tokenHash: String(row.token_hash), expiresAt: String(row.expires_at), createdAt: String(row.created_at), usedAt: row.used_at ? String(row.used_at) : undefined };
}

function releaseRow(row: Row): ReleaseCandidate {
  return { id: String(row.id), projectId: String(row.project_id), manifestHash: String(row.manifest_hash), artifactIds: parseJson<string[]>(row.artifact_ids_json, []), metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}), auditStatus: row.audit_status as ReleaseCandidate['auditStatus'], state: row.state as ReleaseCandidate['state'], createdAt: String(row.created_at) };
}

export function manifestHash(artifactIds: string[], metadata: Record<string, unknown>): string {
  return hashText(json({ artifactIds: [...artifactIds].sort(), metadata }));
}

export type { ReleaseCandidate, ApprovalRecord };
