import { AgentOfficeAdapter } from './agent-office-adapter.js';
import { loadEditorialConfig, type EditorialConfig } from './config.js';
import { EditorialDatabase } from './db.js';
import { EditorialDocuments } from './documents.js';
import { id, now } from './ids.js';
import { EditorialOrchestrator, type ExecutionContext } from './orchestrator.js';
import { AGENT_PROFILES, profileFor } from './profiles.js';
import { EditorialProvider, providerFromEnvironment } from './providers.js';
import { EditorialRepository } from './repository.js';
import { EditorialStorage } from './storage.js';
import { approveApproval, assertReleaseIsPublishable, assertTaskAuthority, consumeApprovedApproval, createReleaseCandidate, rejectApproval, requestApproval } from './policy.js';
import { TelegramBot } from './telegram.js';
import { hashText, json } from './ids.js';
import { backupEditorial } from './backup.js';
import { EditorialAudit } from './audit.js';
import { KdpPreparation } from './kdp.js';
import { EditorialMarketing } from './social.js';
import type { ApprovalRecord, ArtifactRef, DashboardSnapshot, ProjectBrief, ProjectRecord, ReleaseCandidate, RoleId, TaskContract, TaskResult } from './types.js';

export class EditorialRuntime {
  readonly config: EditorialConfig;
  readonly db: EditorialDatabase;
  readonly repo: EditorialRepository;
  readonly storage: EditorialStorage;
  readonly documents: EditorialDocuments;
  readonly audit: EditorialAudit;
  readonly kdp: KdpPreparation;
  readonly marketing: EditorialMarketing;
  readonly provider: EditorialProvider;
  readonly telegram: TelegramBot;
  readonly agentOffice: AgentOfficeAdapter;
  readonly orchestrator: EditorialOrchestrator;

  constructor(dataDir: string, env: NodeJS.ProcessEnv = process.env, dependencies: { fetchImpl?: typeof fetch } = {}) {
    this.config = loadEditorialConfig(dataDir, env);
    this.db = new EditorialDatabase(`${this.config.storageDir}/editorial.sqlite`);
    this.repo = new EditorialRepository(this.db);
    this.storage = new EditorialStorage(`${this.config.storageDir}/files`);
    this.documents = new EditorialDocuments(this.storage, this.repo);
    this.audit = new EditorialAudit(this.repo, this.storage, this.documents);
    this.kdp = new KdpPreparation(this.repo, this.documents);
    this.marketing = new EditorialMarketing(this.repo, this.documents, env.MASTODON_BASE_URL, env.MASTODON_ACCESS_TOKEN, dependencies.fetchImpl);
    this.provider = providerFromEnvironment(env);
    this.agentOffice = new AgentOfficeAdapter(this.repo, this.config.agentOfficeFloor, this.config.agentOfficeProvider);
    this.orchestrator = new EditorialOrchestrator(this.repo, {
      maxConcurrent: this.config.maxConcurrentGenerations,
      budgetUsd: this.config.budgetUsd,
      leaseMs: 10 * 60 * 1000,
      pollMs: 1000,
      owner: 'editorial',
      estimateCost: (task) => task.budgetUsd ?? 0,
      executor: (context) => this.execute(context),
      onEvent: (event) => this.repo.audit('orchestrator', `queue.${event.type}`, undefined, event.taskId, undefined, event),
    });
    this.telegram = new TelegramBot(this, this.config.botToken, this.config.ownerId, this.config.authorizedChatIds);
  }

  start(): void {
    this.orchestrator.start();
    this.telegram.start();
  }

  bindAgentOffice(ctx: Parameters<AgentOfficeAdapter['bind']>[0]): void {
    this.agentOffice.bind(ctx);
  }

  shutdown(): void {
    this.telegram.stop();
    this.orchestrator.stop();
    this.db.close();
  }

  createProject(brief: ProjectBrief): ProjectRecord {
    const project = this.repo.createProject(brief);
    this.repo.createRevision(project.id, 'brief', hashText(json(brief)), { brief, source: 'owner-input' });
    return this.repo.getProject(project.id) ?? project;
  }

  createTask(actor: 'owner' | 'orchestrator' | RoleId, input: Omit<TaskContract, 'taskId'>): TaskContract {
    assertTaskAuthority(actor, 'create');
    const contract = { ...input, taskId: id('task') };
    this.repo.createTask(contract);
    void this.orchestrator.pump();
    return contract;
  }

  createBookWorkflow(projectId: string): TaskContract[] {
    const project = this.repo.getProject(projectId);
    if (!project) throw new Error('Project not found');
    if (project.stage === 'idea') this.repo.updateProjectStage(projectId, 'research');
    const sequence: Array<{ roleId: RoleId; objective: string; scope: string }> = [
      { roleId: 'editorial-director', objective: 'Convertir la petición en brief, canon inicial y plan editorial.', scope: 'brief, decisiones y preguntas pendientes' },
      { roleId: 'researcher', objective: 'Investigar el tema, separar hechos de hipótesis y registrar fuentes.', scope: 'dossier de investigación con trazabilidad' },
      { roleId: 'rights-manager', objective: 'Registrar origen, licencia, procedencia y riesgos de derechos.', scope: 'matriz de derechos por material' },
      { roleId: 'writer', objective: 'Redactar una unidad coherente a partir del brief y las fuentes autorizadas.', scope: 'borrador editable, sin inventar evidencia' },
      { roleId: 'development-editor', objective: 'Revisar estructura, continuidad, promesa y voz.', scope: 'informe de edición y cambios propuestos' },
      { roleId: 'proofreader', objective: 'Corregir ortografía, gramática y consistencia sin alterar la intención.', scope: 'informe de corrección' },
      { roleId: 'art-director', objective: 'Proponer una ilustración sin texto tipográfico y registrar su procedencia.', scope: 'dirección visual y arte derivado' },
      { roleId: 'layout-kdp', objective: 'Preparar manuscrito, EPUB, PDF interior y renderizado de revisión.', scope: 'formatos editoriales y preflight básico' },
      { roleId: 'independent-auditor', objective: 'Auditar artefactos, hashes, derechos y formatos antes del release.', scope: 'hallazgos y candidato de release' },
      { roleId: 'kdp-publisher', objective: 'Preparar metadatos y checklist KDP en modo asistido.', scope: 'paquete y checklist; no iniciar sesión externa' },
      { roleId: 'marketing-analyst', objective: 'Crear calendario social y exportación asistida con contenido autorizado.', scope: 'piezas, horarios y métricas pendientes' },
    ];
    const tasks: TaskContract[] = [];
    let dependencies: string[] = [];
    for (const item of sequence) {
      const task = this.createTask('orchestrator', { projectId, roleId: item.roleId, objective: item.objective, scope: item.scope, inputRevisionIds: project.activeRevisionId ? [project.activeRevisionId] : [], dependencyTaskIds: dependencies, acceptanceCriteria: ['Entregable persistido', 'Resumen de acción y evidencias', 'Bloqueadores explícitos'], tools: profileFor(item.roleId).allowedTools, timeoutSeconds: 900, maxAttempts: 2, resultDestination: profileFor(item.roleId).fileScope[0] ?? 'reports' });
      tasks.push(task);
      dependencies = [task.taskId];
    }
    this.repo.audit('owner', 'workflow.create', projectId, undefined, undefined, { taskIds: tasks.map((task) => task.taskId), roles: tasks.map((task) => task.roleId) });
    return tasks;
  }

  createReleaseCandidate(projectId: string, artifacts?: ArtifactRef[], metadata: Record<string, unknown> = {}, auditStatus: ReleaseCandidate['auditStatus'] = 'not_run'): ReleaseCandidate {
    const project = this.repo.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const selected = artifacts ?? this.repo.listArtifacts(projectId).filter((artifact) => ['manuscript_source', 'epub', 'pdf_interior', 'cover_digital', 'cover_print', 'metadata', 'rights_report', 'audit_report'].includes(artifact.type));
    return createReleaseCandidate(this.repo, project, selected, metadata, auditStatus);
  }

  auditReleaseCandidate(releaseId: string) {
    const candidate = this.repo.getRelease(releaseId);
    if (!candidate) throw new Error('Release candidate not found');
    const project = this.repo.getProject(candidate.projectId);
    if (!project) throw new Error('Project not found');
    return this.audit.auditCandidate(project, candidate);
  }

  prepareKdp(projectId: string, releaseId?: string) {
    const project = this.repo.getProject(projectId);
    if (!project) throw new Error('Project not found');
    return this.kdp.prepare(project, releaseId ? this.repo.getRelease(releaseId) : undefined);
  }

  requestReleaseApproval(releaseId: string, ownerId = this.config.ownerId): { record: ApprovalRecord; token: string } {
    const candidate = this.repo.getRelease(releaseId);
    if (!candidate) throw new Error('Release candidate not found');
    if (!ownerId) throw new Error('TELEGRAM_OWNER_ID is required for an approval');
    return requestApproval(this.repo, 'owner', { projectId: candidate.projectId, action: 'publish', subjectId: candidate.id, subject: candidate, ownerId });
  }

  approveApproval(approvalId: string, ownerId = this.config.ownerId): ApprovalRecord {
    if (!ownerId) throw new Error('Owner identity is not configured');
    return approveApproval(this.repo, 'owner', approvalId, ownerId);
  }

  rejectApproval(approvalId: string, ownerId = this.config.ownerId): ApprovalRecord {
    if (!ownerId) throw new Error('Owner identity is not configured');
    return rejectApproval(this.repo, 'owner', approvalId, ownerId);
  }

  prepareApprovedRelease(releaseId: string, ownerId = this.config.ownerId): ReleaseCandidate {
    const candidate = this.repo.getRelease(releaseId);
    if (!candidate) throw new Error('Release candidate not found');
    const approval = this.repo.listApprovals(candidate.projectId).find((item) => item.action === 'publish' && item.subjectId === releaseId && item.ownerId === ownerId && ['pending', 'approved'].includes(item.state));
    if (!approval) throw new Error('No hay una aprobación de propietario para este candidato');
    assertReleaseIsPublishable(this.repo, candidate, approval);
    consumeApprovedApproval(this.repo, 'owner', approval, candidate, ownerId ?? '');
    this.repo.updateReleaseState(candidate.id, 'assisted');
    this.repo.audit('owner', 'release.assisted-preparation', candidate.projectId, undefined, candidate.manifestHash, { releaseId: candidate.id, externalPublication: false });
    return this.repo.getRelease(candidate.id) ?? { ...candidate, state: 'assisted' };
  }

  ingestTelegramDocument(projectId: string, fileName: string, bytes: Uint8Array, mimeType?: string): ArtifactRef {
    const project = this.repo.getProject(projectId);
    if (!project) throw new Error('Project not found');
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('Telegram documents above 20 MB are not accepted');
    const extension = fileName.split('.').pop()?.toLowerCase() || 'bin';
    const stored = this.storage.write(projectId, 'sources', extension, bytes);
    const artifact: ArtifactRef = { id: id('artifact'), type: 'source_upload', projectId, path: stored.relativePath, sha256: stored.sha256, sizeBytes: stored.sizeBytes, metadata: { fileName, mimeType, source: 'telegram', receivedAt: now(), aiStatus: 'not-generated' } };
    this.repo.recordArtifact(artifact);
    this.repo.recordSource({ id: id('source'), projectId, identifier: artifact.id, title: fileName, observedAt: now(), notes: mimeType ? `Telegram upload (${mimeType})` : 'Telegram upload', claims: [] });
    this.repo.audit('owner', 'telegram.document.ingest', projectId, undefined, artifact.sha256, { artifactId: artifact.id, fileName, sizeBytes: bytes.byteLength });
    return artifact;
  }

  backup(destination: string): ReturnType<typeof backupEditorial> {
    this.db.checkpoint();
    return backupEditorial(this.config.dataDir, destination, false);
  }

  snapshot(): DashboardSnapshot {
    const usage = this.repo.usageTotals();
    return {
      settings: { brandName: 'Editorial JeyTid', interfaceLanguage: 'es', editorialLanguage: 'es-419', timezone: this.config.timezone, ownerId: this.config.ownerId, authorizedChatIds: this.config.authorizedChatIds, markets: [], paidAdvertising: this.config.paidAdvertising, maxConcurrentGenerations: this.config.maxConcurrentGenerations, budgetUsd: this.config.budgetUsd, warningThresholdUsd: this.config.warningThresholdUsd, provider: this.provider.id, textModel: this.config.textModel, imageModel: this.config.imageModel },
      projects: this.repo.listProjects(),
      tasks: this.repo.listTasks().map(({ contract, state, attempts, updatedAt }) => ({ ...contract, state, attempts, updatedAt })),
      revisions: this.repo.listRevisions(),
      artifacts: this.repo.listAllArtifacts(),
      sources: this.repo.listSources(),
      rights: this.repo.listRights(),
      runs: this.repo.listRuns(),
      approvals: this.repo.listApprovals(),
      releases: this.repo.listReleases(),
      findings: this.repo.listFindings(),
      socialAccounts: this.repo.listSocialAccounts(),
      socialPosts: this.repo.listSocialPosts(),
      capabilities: this.repo.capabilities().map((row) => row.capability === 'text-generation' && this.provider.id === 'openai' && this.provider.configured ? { ...row, state: 'tested_local' as const, limitation: undefined } : row),
      connectors: { telegram: { configured: !!this.config.botToken && !!this.config.ownerId, capabilities: ['commands', 'callbacks', 'documents'] }, text: { configured: this.provider.configured, capabilities: ['generation'] }, image: { configured: this.provider.configured, capabilities: ['generation'] }, mastodon: { configured: this.marketing.mastodon.configured, capabilities: ['calendar', 'assisted-export', ...(this.marketing.mastodon.configured ? ['publish-status'] : [])], limitation: this.marketing.mastodon.configured ? 'Publishing still requires an approved post.' : 'Configure MASTODON_BASE_URL and MASTODON_ACCESS_TOKEN for the optional real connector.' }, kdp: { configured: false, capabilities: ['prepare', 'assisted'], limitation: 'No automatic publication is claimed.' } },
      costs: { estimatedUsd: usage.estimatedUsd, observedUsd: usage.observedUsd, budgetUsd: this.config.budgetUsd },
    };
  }

  private async execute(context: ExecutionContext): Promise<TaskResult> {
    const profile = profileFor(context.task.roleId);
    const roleConfig = this.config.roleProviders[context.task.roleId];
    const provider = roleConfig?.provider ? providerFromEnvironment({ ...process.env, ...this.providerEnvironment(), EDITORIAL_PROVIDER: roleConfig.provider }) : this.provider;
    const model = roleConfig?.model || (context.task.roleId === 'art-director' ? this.config.imageModel : this.config.textModel);
    this.repo.updateRunMetadata(context.runId, provider.id, model, profile.version);
    const prompt = `${profile.systemPrompt}\n\nObjetivo: ${context.task.objective}\nAlcance: ${context.task.scope}\nCriterios: ${context.task.acceptanceCriteria.join('; ')}\n\nNo almacenes razonamiento privado; devuelve solo el resultado y evidencias verificables.`;
    context.checkpoint({ phase: 'started', roleId: context.task.roleId, at: now() });
    if (this.config.agentOfficeFloor) {
      const dispatch = this.agentOffice.dispatch(context.task, prompt);
      this.repo.audit('orchestrator', 'agent-office.queue.result', context.task.projectId, context.task.taskId, undefined, dispatch);
    }
    if (context.task.roleId === 'art-director') {
      const image = await provider.generateImage({ prompt, model, size: '1024x1024', outputFormat: 'png' }, context.signal);
      const stored = this.storage.write(context.task.projectId, 'derived', image.mimeType.includes('svg') ? 'svg' : 'png', image.bytes);
      const artifact = { id: id('artifact'), type: 'illustration' as const, projectId: context.task.projectId, taskId: context.task.taskId, path: stored.relativePath, sha256: stored.sha256, sizeBytes: stored.sizeBytes, metadata: { provider: image.provider, model: image.model, aiStatus: 'generated', evidence: image.evidence } };
      this.repo.recordArtifact(artifact);
      return { taskId: context.task.taskId, runId: context.runId, state: 'completed', actionSummary: 'Ilustración generada y registrada con procedencia.', provider: image.provider, model: image.model, profileVersion: profile.version, artifacts: [artifact], findings: [], blockers: [], uncertainties: [], evidence: image.evidence, usage: image.usage, nextAction: 'Revisar la ilustración y componer tipografía por separado.' };
    }
    const result = await provider.generateText({ systemPrompt: profile.systemPrompt, prompt, model, maxOutputTokens: 1600 }, context.signal);
    const project = this.repo.getProject(context.task.projectId);
    if (!project) throw new Error('Project not found for task');
    const type = artifactTypeFor(context.task.roleId);
    const artifact = this.documents.writeTextArtifact(project, type, type === 'chapter' ? 'originals' : 'reports', result.text, { provider: result.provider, model: result.model, aiStatus: 'generated', evidence: result.evidence }, context.task.taskId);
    const artifacts: ArtifactRef[] = [artifact];
    if (context.task.roleId === 'layout-kdp') {
      const source = result.text;
      artifacts.push(this.documents.exportEpub(project, project.title, project.brief.authorName, source, context.task.taskId));
      artifacts.push(this.documents.exportPdf(project, project.title, source, context.task.taskId));
      artifacts.push(this.documents.writeRendering(project, project.title, source, context.task.taskId));
    }
    if (context.task.roleId === 'independent-auditor') {
      const candidate = this.createReleaseCandidate(project.id, undefined, { workflowRunId: context.runId }, 'not_run');
      const audit = this.audit.auditCandidate(project, candidate);
      artifacts.push(audit.report);
    }
    if (context.task.roleId === 'kdp-publisher') {
      const release = this.repo.listReleases(project.id)[0];
      const preparation = this.kdp.prepare(project, release);
      artifacts.push(preparation.metadata, preparation.checklist);
    }
    if (context.task.roleId === 'marketing-analyst') {
      const post = this.marketing.createPost(project, result.text.slice(0, 500));
      artifacts.push(this.marketing.exportCalendar(project));
      this.repo.audit('marketing-analyst', 'social.calendar.created', project.id, context.task.taskId, post.contentHash, { postId: post.id });
    }
    return { taskId: context.task.taskId, runId: context.runId, state: 'completed', actionSummary: `${profile.displayName} produjo entregables trazables.`, provider: result.provider, model: result.model, profileVersion: profile.version, artifacts, findings: [], blockers: [], uncertainties: [], evidence: result.evidence, usage: result.usage, nextAction: 'Validar el entregable antes de desbloquear dependencias.' };
  }

  private providerEnvironment(): NodeJS.ProcessEnv {
    return { EDITORIAL_PROVIDER: this.config.provider };
  }
}

function artifactTypeFor(role: RoleId): 'brief' | 'research_dossier' | 'chapter' | 'edit_report' | 'proof_report' | 'rights_report' | 'cover_digital' | 'audit_report' | 'kdp_checklist' | 'social_piece' | 'metadata' {
  switch (role) {
    case 'researcher': return 'research_dossier';
    case 'writer': return 'chapter';
    case 'development-editor': return 'edit_report';
    case 'proofreader': return 'proof_report';
    case 'rights-manager': return 'rights_report';
    case 'independent-auditor': return 'audit_report';
    case 'kdp-publisher': return 'kdp_checklist';
    case 'marketing-analyst': return 'social_piece';
    case 'editorial-director': return 'brief';
    default: return 'metadata';
  }
}

export function seededBrief(title: string, extra: Partial<ProjectBrief> = {}): ProjectBrief {
  return { provisionalTitle: title, collaborators: [], language: 'es', locale: 'es-419', desiredFormats: ['epub', 'pdf'], ...extra };
}

export { AGENT_PROFILES };
