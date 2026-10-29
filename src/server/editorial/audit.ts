import { createHash } from 'node:crypto';
import type { EditorialDocuments, DocumentValidation } from './documents.js';
import { validateEpub, validatePdf } from './documents.js';
import { now } from './ids.js';
import type { EditorialRepository } from './repository.js';
import type { ArtifactRef, Finding, ProjectRecord, ReleaseCandidate } from './types.js';
import type { EditorialStorage } from './storage.js';

export interface AuditResult {
  candidate: ReleaseCandidate;
  report: ArtifactRef;
  findings: Finding[];
  approved: boolean;
}

/** Independent, deterministic pre-release checks. It never publishes to KDP or a social network. */
export class EditorialAudit {
  constructor(private readonly repo: EditorialRepository, private readonly storage: EditorialStorage, private readonly documents: EditorialDocuments) {}

  auditCandidate(project: ProjectRecord, candidate: ReleaseCandidate): AuditResult {
    const findings: Finding[] = [];
    const artifacts = this.repo.listArtifacts(project.id);
    const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    for (const artifactId of candidate.artifactIds) {
      const artifact = byId.get(artifactId);
      if (!artifact) {
        findings.push({ severity: 'blocking', title: 'Artefacto ausente', detail: `El manifiesto referencia ${artifactId}, que no está en el proyecto.`, status: 'open' });
        continue;
      }
      try {
        const bytes = this.storage.read(artifact.path);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (digest !== artifact.sha256) findings.push({ severity: 'blocking', title: 'Hash de artefacto no coincide', detail: artifact.path, status: 'open' });
        const validation = artifact.type === 'epub' ? validateEpub(bytes) : artifact.type === 'pdf_interior' ? validatePdf(bytes) : { ok: true, problems: [] };
        for (const problem of validation.problems) findings.push({ severity: 'blocking', title: `Validación ${artifact.type}`, detail: problem, location: artifact.path, status: 'open' });
      } catch (error) {
        findings.push({ severity: 'blocking', title: 'Artefacto ilegible', detail: `${artifact.path}: ${error instanceof Error ? error.message : 'error desconocido'}`, status: 'open' });
      }
      if (!this.repo.listRights(project.id).some((rights) => rights.artifactId === artifact.id)) findings.push({ severity: 'blocking', title: 'Procedencia ausente', detail: `No existe registro de derechos para ${artifact.id}.`, status: 'open' });
    }
    const blocking = findings.filter((finding) => finding.severity === 'blocking');
    for (const finding of findings) this.repo.addFinding(project.id, finding);
    const approved = blocking.length === 0;
    const reportText = ['# Auditoría independiente', '', `Candidato: ${candidate.id}`, `Fecha: ${now()}`, `Resultado: ${approved ? 'approved' : 'needs_changes'}`, '', ...findings.map((finding) => `- [${finding.severity}] ${finding.title}: ${finding.detail}`), '', 'La auditoría es local y no sustituye la revisión de derechos, políticas ni el formulario de la plataforma externa.'].join('\n');
    const report = this.documents.writeTextArtifact(project, 'audit_report', 'reports', reportText, { candidateId: candidate.id, independent: true, approved, generatedAt: now() });
    this.repo.updateReleaseState(candidate.id, approved ? 'approved' : 'needs_changes', approved ? 'approved' : 'needs_changes');
    this.repo.audit('independent-auditor', 'release.audit', project.id, undefined, candidate.manifestHash, { candidateId: candidate.id, approved, findingCount: findings.length, reportId: report.id });
    return { candidate: this.repo.getRelease(candidate.id) ?? candidate, report, findings, approved };
  }
}

export function validationFinding(validation: DocumentValidation, artifact: ArtifactRef): Finding[] {
  return validation.ok ? [] : validation.problems.map((detail) => ({ severity: 'blocking', title: `Validación ${artifact.type}`, detail, location: artifact.path, status: 'open' as const }));
}
