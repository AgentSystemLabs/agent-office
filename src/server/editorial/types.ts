export const EDITORIAL_ROLES = [
  'editorial-director',
  'researcher',
  'rights-manager',
  'writer',
  'development-editor',
  'proofreader',
  'art-director',
  'layout-kdp',
  'independent-auditor',
  'kdp-publisher',
  'marketing-analyst',
] as const;

export type RoleId = (typeof EDITORIAL_ROLES)[number];

export const PROJECT_STAGES = [
  'idea',
  'research',
  'brief',
  'concept_approval',
  'planning',
  'writing',
  'editing',
  'verification',
  'rights',
  'art',
  'layout',
  'candidate',
  'audit',
  'kdp_preparation',
  'marketing',
  'published',
  'paused',
  'blocked',
  'archived',
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const TASK_STATES = ['pending', 'blocked', 'ready', 'running', 'waiting_user', 'completed', 'failed', 'cancelled', 'uncertain'] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const FINDING_SEVERITIES = ['blocking', 'important', 'minor', 'suggestion'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const APPROVAL_ACTIONS = ['concept', 'scope', 'release', 'publish', 'social_batch', 'external_expense', 'legal_filing'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const APPROVAL_STATES = ['pending', 'approved', 'rejected', 'expired', 'revoked', 'used'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const RELEASE_STATES = ['draft', 'auditing', 'approved', 'needs_changes', 'prepared', 'assisted', 'submitted', 'uncertain', 'published'] as const;
export type ReleaseState = (typeof RELEASE_STATES)[number];

export const CAPABILITY_STATES = ['implemented', 'tested_local', 'tested_real', 'requires_config', 'requires_owner', 'limited', 'unsupported'] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export const ARTIFACT_TYPES = [
  'brief',
  'research_dossier',
  'manuscript_source',
  'manuscript_docx',
  'chapter',
  'edit_report',
  'proof_report',
  'illustration',
  'cover_digital',
  'cover_print',
  'epub',
  'pdf_interior',
  'rendering',
  'metadata',
  'rights_report',
  'audit_report',
  'kdp_checklist',
  'social_piece',
  'release_package',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export interface OwnerSettings {
  brandName: string;
  interfaceLanguage: string;
  editorialLanguage: string;
  timezone: string;
  ownerId?: string;
  authorizedChatIds: string[];
  markets: string[];
  residenceCountry?: string;
  rightsJurisdiction?: string;
  paidAdvertising: boolean;
  maxConcurrentGenerations: number;
  budgetUsd?: number;
  warningThresholdUsd: number;
  provider: string;
  textModel: string;
  imageModel: string;
}

export interface ProjectBrief {
  provisionalTitle: string;
  authorName?: string;
  collaborators: string[];
  language: string;
  locale: string;
  genre?: string;
  subgenre?: string;
  audience?: string;
  objective?: string;
  premise?: string;
  promise?: string;
  differentiation?: string;
  synopsis?: string;
  targetWordCount?: number;
  tone?: string;
  voice?: string;
  pointOfView?: string;
  desiredFormats: string[];
  visualPreferences?: string;
  seriesId?: string;
}

export interface ProjectRecord {
  id: string;
  title: string;
  stage: ProjectStage;
  paused: boolean;
  brief: ProjectBrief;
  createdAt: string;
  updatedAt: string;
  activeRevisionId?: string;
}

export interface TaskContract {
  taskId: string;
  projectId: string;
  editionId?: string;
  roleId: RoleId;
  objective: string;
  scope: string;
  inputRevisionIds: string[];
  dependencyTaskIds: string[];
  acceptanceCriteria: string[];
  tools: string[];
  budgetUsd?: number;
  timeoutSeconds: number;
  maxAttempts: number;
  resultDestination: string;
}

export interface ArtifactRef {
  id: string;
  type: ArtifactType;
  projectId: string;
  editionId?: string;
  taskId?: string;
  revisionId?: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  metadata: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  runId: string;
  state: Extract<TaskState, 'completed' | 'failed' | 'cancelled' | 'uncertain'>;
  actionSummary: string;
  provider: string;
  model?: string;
  profileVersion: string;
  artifacts: ArtifactRef[];
  findings: Finding[];
  blockers: string[];
  uncertainties: string[];
  evidence: EvidenceRef[];
  usage: UsageSnapshot;
  nextAction?: string;
}

export interface EvidenceRef {
  kind: 'url' | 'file' | 'command' | 'service';
  ref: string;
  observedAt: string;
  note?: string;
}

export interface UsageSnapshot {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  observedCostUsd?: number;
  currency?: string;
  source: 'provider' | 'estimate' | 'unavailable';
}

export interface Finding {
  id?: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  location?: string;
  resolution?: string;
  status: 'open' | 'resolved' | 'accepted';
}

export interface AgentProfile {
  id: RoleId;
  displayName: string;
  mission: string;
  responsibilities: string[];
  inputs: string[];
  deliverables: string[];
  allowedTools: string[];
  fileScope: string[];
  limits: string[];
  budgetPolicy: string;
  completionConditions: string[];
  escalation: string[];
  systemPrompt: string;
  version: string;
}

export interface AgentRunRecord {
  runId: string;
  taskId: string;
  roleId: RoleId;
  provider: string;
  model?: string;
  profileVersion: string;
  officeWorkerId?: string;
  officeFloorId?: string;
  status: 'started' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
  startedAt: string;
  finishedAt?: string;
  actionSummary?: string;
}

export interface ApprovalRecord {
  id: string;
  projectId: string;
  action: ApprovalAction;
  subjectId: string;
  subjectHash: string;
  ownerId: string;
  state: ApprovalState;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  usedAt?: string;
}

export interface ReleaseCandidate {
  id: string;
  projectId: string;
  manifestHash: string;
  artifactIds: string[];
  metadata: Record<string, unknown>;
  auditStatus: 'not_run' | 'approved' | 'needs_changes' | 'external_check';
  state: ReleaseState;
  createdAt: string;
}

export interface CapabilityRow {
  capability: string;
  component: string;
  state: CapabilityState;
  evidence: string[];
  dependency?: string;
  limitation?: string;
  checkedAt: string;
}

export interface DashboardSnapshot {
  settings: OwnerSettings;
  projects: ProjectRecord[];
  tasks: Array<TaskContract & { state: TaskState; attempts: number; updatedAt: string }>;
  runs: AgentRunRecord[];
  approvals: ApprovalRecord[];
  releases: ReleaseCandidate[];
  findings: Finding[];
  capabilities: CapabilityRow[];
  connectors: Record<string, { configured: boolean; capabilities: string[]; limitation?: string }>;
  costs: { estimatedUsd: number; observedUsd: number; budgetUsd?: number };
}
