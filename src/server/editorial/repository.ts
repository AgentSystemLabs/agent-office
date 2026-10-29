import type { EditorialDatabase } from './db.js';
import { hashText, id, json, now, parseJson } from './ids.js';
import type { AgentRunRecord, ApprovalRecord, ArtifactRef, CapabilityRow, Finding, ProjectBrief, ProjectRecord, ReleaseCandidate, RevisionRecord, RightsRecord, RoleId, SocialAccountRecord, SocialPostRecord, SourceRecord, TaskContract, TaskResult, TaskState, UsageSnapshot } from './types.js';
import { initialCapabilities } from './capabilities.js';
import { assertProjectTransition } from './state.js';

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
    const current = this.getProject(projectId);
    if (!current) throw new Error('Project not found');
    assertProjectTransition(current.stage, stage);
    const updatedAt = now();
    this.db.run('UPDATE projects SET stage = ?, paused = ?, updated_at = ? WHERE id = ?', stage, paused ? 1 : 0, updatedAt, projectId);
  }

  createRevision(projectId: string, kind: string, contentHash: string, manifest: Record<string, unknown>, parentId?: string, activate = true): RevisionRecord {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    if (parentId && !this.db.get('SELECT 1 AS id FROM revisions WHERE id = ? AND project_id = ?', parentId, projectId)) throw new Error('Revision parent does not belong to project');
    const revision: RevisionRecord = { id: id('revision'), projectId, kind, parentId, contentHash, manifest, createdAt: now() };
    this.db.transaction(() => {
      this.db.run('INSERT INTO revisions(id,project_id,kind,parent_id,content_hash,manifest_json,created_at) VALUES (?,?,?,?,?,?,?)', revision.id, revision.projectId, revision.kind, revision.parentId ?? null, revision.contentHash, json(revision.manifest), revision.createdAt);
      if (activate) this.db.run('UPDATE projects SET active_revision_id = ?, updated_at = ? WHERE id = ?', revision.id, revision.createdAt, projectId);
      if (parentId) {
        this.db.run('UPDATE releases SET state = \'needs_changes\', audit_status = \'needs_changes\' WHERE project_id = ? AND state IN (\'approved\',\'prepared\',\'assisted\')', projectId);
        this.db.run('UPDATE approvals SET state = \'revoked\' WHERE project_id = ? AND state IN (\'pending\',\'approved\')', projectId);
      }
      this.audit('owner', 'revision.create', projectId, undefined, contentHash, { revisionId: revision.id, kind, parentId, activate });
    });
    return revision;
  }

  listRevisions(projectId?: string): RevisionRecord[] {
    const rows = projectId ? this.db.all<Row>('SELECT * FROM revisions WHERE project_id = ? ORDER BY created_at', projectId) : this.db.all<Row>('SELECT * FROM revisions ORDER BY created_at');
    return rows.map(revisionRow);
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

  readyTasks(limit: number, projectId?: string): string[] {
    const projectFilter = projectId ? ' AND t.project_id = ?' : '';
    const query = `SELECT t.id FROM tasks t WHERE t.state IN ('pending','ready','uncertain')${projectFilter} AND NOT EXISTS (
      SELECT 1 FROM task_dependencies d JOIN tasks dep ON dep.id = d.depends_on WHERE d.task_id = t.id AND dep.state <> 'completed'
    ) ORDER BY t.created_at LIMIT ?`;
    const rows = projectId ? this.db.all<{ id: string }>(query, projectId, limit) : this.db.all<{ id: string }>(query, limit);
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

  recoverExpiredLeases(at = now()): number {
    const result = this.db.run(`UPDATE tasks SET state = CASE WHEN attempts < max_attempts THEN 'ready' ELSE 'failed' END,
      lease_owner = NULL, lease_until = NULL, updated_at = ?
      WHERE state = 'running' AND lease_until IS NOT NULL AND lease_until <= ?`, at, at);
    return Number(result.changes);
  }

  cancelTask(taskId: string, reason: string): boolean {
    const result = this.db.run(`UPDATE tasks SET state = 'cancelled', generation = generation + 1,
      lease_owner = NULL, lease_until = NULL, updated_at = ?, result_json = ?
      WHERE id = ? AND state IN ('pending','blocked','ready','running','waiting_user','uncertain')`, now(), json({ reason }), taskId);
    return Number(result.changes) > 0;
  }

  reserveBudget(projectId: string | undefined, taskId: string, provider: string, amountUsd: number, budgetUsd?: number): string | undefined {
    if (!(amountUsd >= 0) || !Number.isFinite(amountUsd)) throw new Error('Invalid budget reservation');
    return this.db.transaction(() => {
      const totals = this.usageTotals();
      if (budgetUsd !== undefined && totals.observedUsd + totals.reservedUsd + amountUsd > budgetUsd + 1e-9) return undefined;
      const reservationId = id('reserve');
      this.db.run('INSERT INTO cost_events(id,project_id,task_id,provider,estimated_usd,observed_usd,reserved_usd,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)', reservationId, projectId ?? null, taskId, provider, 0, 0, amountUsd, 'estimate', now());
      return reservationId;
    });
  }

  settleBudget(reservationId: string, usage: UsageSnapshot): void {
    this.db.run('UPDATE cost_events SET estimated_usd = ?, observed_usd = ?, reserved_usd = 0, source = ? WHERE id = ?', usage.estimatedCostUsd ?? 0, usage.observedCostUsd ?? 0, usage.source, reservationId);
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

  updateRunMetadata(runId: string, provider: string, model: string | undefined, profileVersion: string): void {
    this.db.run('UPDATE agent_runs SET provider = ?, model = ?, profile_version = ? WHERE id = ?', provider, model ?? null, profileVersion, runId);
  }

  listRuns(projectId?: string): AgentRunRecord[] {
    const rows = projectId ? this.db.all<Row>('SELECT r.* FROM agent_runs r JOIN tasks t ON t.id = r.task_id WHERE t.project_id = ? ORDER BY r.started_at DESC', projectId) : this.db.all<Row>('SELECT * FROM agent_runs ORDER BY started_at DESC');
    return rows.map((row) => ({ runId: String(row.id), taskId: String(row.task_id), roleId: row.role_id as AgentRunRecord['roleId'], provider: String(row.provider), model: row.model ? String(row.model) : undefined, profileVersion: String(row.profile_version), officeWorkerId: row.office_worker_id ? String(row.office_worker_id) : undefined, officeFloorId: row.office_floor_id ? String(row.office_floor_id) : undefined, status: row.status as AgentRunRecord['status'], startedAt: String(row.started_at), finishedAt: row.finished_at ? String(row.finished_at) : undefined, actionSummary: row.action_summary ? String(row.action_summary) : undefined }));
  }

  recordArtifact(artifact: ArtifactRef): void {
    this.db.transaction(() => {
      this.db.run('INSERT INTO artifacts(id,project_id,edition_id,task_id,revision_id,type,path,sha256,size_bytes,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', artifact.id, artifact.projectId, artifact.editionId ?? null, artifact.taskId ?? null, artifact.revisionId ?? null, artifact.type, artifact.path, artifact.sha256, artifact.sizeBytes, json(artifact.metadata), now());
      this.db.run('INSERT INTO rights_records(id,project_id,artifact_id,origin,creator,license,evidence,ai_status,conditions,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', id('rights'), artifact.projectId, artifact.id, typeof artifact.metadata.source === 'string' ? artifact.metadata.source : typeof artifact.metadata.provider === 'string' ? artifact.metadata.provider : 'owner-provided', typeof artifact.metadata.creator === 'string' ? artifact.metadata.creator : null, typeof artifact.metadata.license === 'string' ? artifact.metadata.license : null, typeof artifact.metadata.evidence === 'string' ? artifact.metadata.evidence : json(artifact.metadata.evidence ?? {}), typeof artifact.metadata.aiStatus === 'string' ? artifact.metadata.aiStatus : 'unknown', null, 'recorded', now());
    });
  }

  listAllArtifacts(): ArtifactRef[] {
    return this.db.all<Row>('SELECT * FROM artifacts ORDER BY created_at').map(artifactRow);
  }

  listArtifacts(projectId: string): ArtifactRef[] {
    return this.db.all<Row>('SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at', projectId).map(artifactRow);
  }

  addFinding(projectId: string, finding: Finding, taskId?: string): string {
    const findingId = finding.id ?? id('finding');
    this.db.run('INSERT INTO findings(id,project_id,task_id,severity,title,detail,location,resolution,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', findingId, projectId, taskId ?? null, finding.severity, finding.title, finding.detail, finding.location ?? null, finding.resolution ?? null, finding.status, now());
    return findingId;
  }

  recordSource(source: SourceRecord): void {
    this.db.run('INSERT INTO sources(id,project_id,url,identifier,title,observed_at,notes,claims_json) VALUES (?,?,?,?,?,?,?,?)', source.id, source.projectId, source.url ?? null, source.identifier ?? null, source.title ?? null, source.observedAt, source.notes ?? null, json(source.claims));
  }

  listSources(projectId?: string): SourceRecord[] {
    const rows = projectId ? this.db.all<Row>('SELECT * FROM sources WHERE project_id = ? ORDER BY observed_at', projectId) : this.db.all<Row>('SELECT * FROM sources ORDER BY observed_at');
    return rows.map(sourceRow);
  }

  recordRights(rights: RightsRecord): void {
    this.db.run('INSERT INTO rights_records(id,project_id,artifact_id,origin,creator,license,evidence,ai_status,conditions,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', rights.id, rights.projectId, rights.artifactId ?? null, rights.origin, rights.creator ?? null, rights.license ?? null, rights.evidence ?? null, rights.aiStatus, rights.conditions ?? null, rights.status, rights.updatedAt);
  }

  listRights(projectId?: string): RightsRecord[] {
    const rows = projectId ? this.db.all<Row>('SELECT * FROM rights_records WHERE project_id = ? ORDER BY updated_at', projectId) : this.db.all<Row>('SELECT * FROM rights_records ORDER BY updated_at');
    return rows.map(rightsRow);
  }

  createApproval(record: ApprovalRecord): void {
    this.db.run('INSERT INTO approvals(id,project_id,action,subject_id,subject_hash,owner_id,state,token_hash,expires_at,created_at,used_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', record.id, record.projectId, record.action, record.subjectId, record.subjectHash, record.ownerId, record.state, record.tokenHash, record.expiresAt, record.createdAt, record.usedAt ?? null);
  }

  getApproval(approvalId: string): ApprovalRecord | undefined {
    const row = this.db.get<Row>('SELECT * FROM approvals WHERE id = ?', approvalId);
    return row ? approvalRow(row) : undefined;
  }

  approveApproval(approvalId: string, ownerId: string): ApprovalRecord | undefined {
    return this.db.transaction(() => {
      const row = this.db.get<Row>('SELECT * FROM approvals WHERE id = ? AND owner_id = ?', approvalId, ownerId);
      if (!row || row.state !== 'pending' || Date.parse(String(row.expires_at)) <= Date.now()) return undefined;
      const changed = this.db.run('UPDATE approvals SET state = \'approved\' WHERE id = ? AND owner_id = ? AND state = \'pending\'', approvalId, ownerId);
      return changed.changes ? approvalRow({ ...row, state: 'approved' }) : undefined;
    });
  }

  rejectApproval(approvalId: string, ownerId: string): ApprovalRecord | undefined {
    return this.db.transaction(() => {
      const row = this.db.get<Row>('SELECT * FROM approvals WHERE id = ? AND owner_id = ?', approvalId, ownerId);
      if (!row || !['pending', 'approved'].includes(String(row.state))) return undefined;
      const changed = this.db.run('UPDATE approvals SET state = \'rejected\' WHERE id = ? AND owner_id = ? AND state IN (\'pending\',\'approved\')', approvalId, ownerId);
      return changed.changes ? approvalRow({ ...row, state: 'rejected' }) : undefined;
    });
  }

  consumeApprovalById(approvalId: string, ownerId: string, subjectHash: string): ApprovalRecord | undefined {
    return this.db.transaction(() => {
      const row = this.db.get<Row>('SELECT * FROM approvals WHERE id = ? AND owner_id = ? AND subject_hash = ?', approvalId, ownerId, subjectHash);
      if (!row || !['pending', 'approved'].includes(String(row.state)) || Date.parse(String(row.expires_at)) <= Date.now()) return undefined;
      const usedAt = now();
      const changed = this.db.run('UPDATE approvals SET state = \'used\', used_at = ? WHERE id = ? AND owner_id = ? AND subject_hash = ? AND state IN (\'pending\',\'approved\')', usedAt, approvalId, ownerId, subjectHash);
      return changed.changes ? approvalRow({ ...row, state: 'used', used_at: usedAt }) : undefined;
    });
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

  findApprovalByTokenHash(tokenHash: string): ApprovalRecord | undefined {
    const row = this.db.get<Row>('SELECT * FROM approvals WHERE token_hash = ?', tokenHash);
    return row ? approvalRow(row) : undefined;
  }

  upsertSocialAccount(account: SocialAccountRecord): void {
    this.db.run('INSERT INTO social_accounts(id,platform,account_label,token_ref,capabilities_json,status,metadata_json,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET platform=excluded.platform,account_label=excluded.account_label,token_ref=excluded.token_ref,capabilities_json=excluded.capabilities_json,status=excluded.status,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at', account.id, account.platform, account.accountLabel, account.tokenRef ?? null, json(account.capabilities), account.status, json(account.metadata), account.updatedAt);
  }

  listSocialAccounts(): SocialAccountRecord[] {
    return this.db.all<Row>('SELECT * FROM social_accounts ORDER BY account_label').map(socialAccountRow);
  }

  createSocialPost(post: SocialPostRecord): void {
    this.db.run('INSERT INTO social_posts(id,project_id,account_id,content_hash,content_json,scheduled_at,timezone,state,remote_id,remote_url,last_error,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', post.id, post.projectId, post.accountId ?? null, post.contentHash, json(post.content), post.scheduledAt ?? null, post.timezone, post.state, post.remoteId ?? null, post.remoteUrl ?? null, post.lastError ?? null, post.updatedAt);
  }

  updateSocialPost(postId: string, patch: Partial<Pick<SocialPostRecord, 'state' | 'remoteId' | 'remoteUrl' | 'lastError'>>): boolean {
    const result = this.db.run('UPDATE social_posts SET state = COALESCE(?, state), remote_id = COALESCE(?, remote_id), remote_url = COALESCE(?, remote_url), last_error = COALESCE(?, last_error), updated_at = ? WHERE id = ?', patch.state ?? null, patch.remoteId ?? null, patch.remoteUrl ?? null, patch.lastError ?? null, now(), postId);
    return Number(result.changes) > 0;
  }

  listSocialPosts(projectId?: string): SocialPostRecord[] {
    const rows = projectId ? this.db.all<Row>('SELECT * FROM social_posts WHERE project_id = ? ORDER BY scheduled_at, updated_at', projectId) : this.db.all<Row>('SELECT * FROM social_posts ORDER BY scheduled_at, updated_at');
    return rows.map(socialPostRow);
  }

  updateReleaseState(releaseId: string, state: ReleaseCandidate['state'], auditStatus?: ReleaseCandidate['auditStatus']): boolean {
    const result = this.db.run('UPDATE releases SET state = ?, audit_status = COALESCE(?, audit_status) WHERE id = ?', state, auditStatus ?? null, releaseId);
    return Number(result.changes) > 0;
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

function revisionRow(row: Row): RevisionRecord {
  return { id: String(row.id), projectId: String(row.project_id), kind: String(row.kind), parentId: row.parent_id ? String(row.parent_id) : undefined, contentHash: String(row.content_hash), manifest: parseJson<Record<string, unknown>>(row.manifest_json, {}), createdAt: String(row.created_at) };
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

function sourceRow(row: Row): SourceRecord {
  return { id: String(row.id), projectId: String(row.project_id), url: row.url ? String(row.url) : undefined, identifier: row.identifier ? String(row.identifier) : undefined, title: row.title ? String(row.title) : undefined, observedAt: String(row.observed_at), notes: row.notes ? String(row.notes) : undefined, claims: parseJson<string[]>(row.claims_json, []) };
}

function rightsRow(row: Row): RightsRecord {
  return { id: String(row.id), projectId: String(row.project_id), artifactId: row.artifact_id ? String(row.artifact_id) : undefined, origin: String(row.origin), creator: row.creator ? String(row.creator) : undefined, license: row.license ? String(row.license) : undefined, evidence: row.evidence ? String(row.evidence) : undefined, aiStatus: String(row.ai_status), conditions: row.conditions ? String(row.conditions) : undefined, status: String(row.status), updatedAt: String(row.updated_at) };
}

function socialAccountRow(row: Row): SocialAccountRecord {
  return { id: String(row.id), platform: String(row.platform), accountLabel: String(row.account_label), tokenRef: row.token_ref ? String(row.token_ref) : undefined, capabilities: parseJson<string[]>(row.capabilities_json, []), status: String(row.status), metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}), updatedAt: String(row.updated_at) };
}

function socialPostRow(row: Row): SocialPostRecord {
  return { id: String(row.id), projectId: String(row.project_id), accountId: row.account_id ? String(row.account_id) : undefined, contentHash: String(row.content_hash), content: parseJson<Record<string, unknown>>(row.content_json, {}), scheduledAt: row.scheduled_at ? String(row.scheduled_at) : undefined, timezone: String(row.timezone), state: String(row.state), remoteId: row.remote_id ? String(row.remote_id) : undefined, remoteUrl: row.remote_url ? String(row.remote_url) : undefined, lastError: row.last_error ? String(row.last_error) : undefined, updatedAt: String(row.updated_at) };
}

export function manifestHash(artifactIds: string[], metadata: Record<string, unknown>): string {
  return hashText(json({ artifactIds: [...artifactIds].sort(), metadata }));
}

export type { ReleaseCandidate, ApprovalRecord };
