import type { EditorialDocuments } from './documents.js';
import type { EditorialRepository } from './repository.js';
import type { ArtifactRef, ProjectRecord, ReleaseCandidate } from './types.js';
import { now } from './ids.js';

export interface KdpPreparationResult {
  metadata: ArtifactRef;
  checklist: ArtifactRef;
  candidate?: ReleaseCandidate;
  blockers: string[];
}

/** Preparation/assisted route only. No KDP login, MFA, CAPTCHA or external submission is automated. */
export class KdpPreparation {
  constructor(private readonly repo: EditorialRepository, private readonly documents: EditorialDocuments) {}

  prepare(project: ProjectRecord, candidate?: ReleaseCandidate): KdpPreparationResult {
    const artifacts = this.repo.listArtifacts(project.id);
    const epub = artifacts.find((artifact) => artifact.type === 'epub');
    const pdf = artifacts.find((artifact) => artifact.type === 'pdf_interior');
    const blockers: string[] = [];
    if (!epub) blockers.push('No existe un EPUB final asociado al proyecto');
    if (!pdf) blockers.push('No existe un PDF interior asociado al proyecto');
    const metadata = this.documents.writeTextArtifact(project, 'metadata', 'reports', JSON.stringify({ title: project.brief.provisionalTitle, author: project.brief.authorName, language: project.brief.language, markets: project.brief.locale, formats: project.brief.desiredFormats, generatedAt: now(), source: 'editorial-jeytid', kdpAutomation: 'unsupported' }, null, 2), { format: 'kdp-metadata-json', externalSubmission: false });
    const checklistText = [
      '# Preparación KDP (asistida)',
      '',
      `Título: ${project.brief.provisionalTitle}`,
      `Autor: ${project.brief.authorName || 'pendiente'}`,
      `EPUB: ${epub ? 'presente' : 'pendiente'}`,
      `PDF interior: ${pdf ? 'presente' : 'pendiente'}`,
      `Candidato: ${candidate?.id || 'pendiente'}`,
      '',
      '## Confirmaciones del propietario',
      '- Confirmar identidad, derechos, territorios y precio en KDP.',
      '- Revisar el renderizado y el número de páginas antes de preparar la cubierta.',
      '- Completar login, MFA, CAPTCHA y envío manual en la cuenta KDP.',
      '- No activar exclusividad ni publicidad pagada desde este módulo.',
      '',
      'Fuentes oficiales:',
      '- https://kdp.amazon.com/en_US/help',
      '- https://kdp.amazon.com/en_US/help/topic/G202187850',
      '- https://kdp.amazon.com/es_ES/cover-templates',
    ].join('\n');
    const checklist = this.documents.writeTextArtifact(project, 'kdp_checklist', 'reports', checklistText, { format: 'kdp-checklist', externalSubmission: false, blockers });
    this.repo.audit('kdp-publisher', 'kdp.preparation', project.id, undefined, undefined, { candidateId: candidate?.id, blockers });
    if (candidate && blockers.length === 0) this.repo.updateReleaseState(candidate.id, 'prepared');
    return { metadata, checklist, candidate: candidate ? this.repo.getRelease(candidate.id) : undefined, blockers };
  }
}
