import { strToU8, unzipSync, zipSync } from 'fflate';
import type { EditorialRepository } from './repository.js';
import type { EditorialStorage } from './storage.js';
import { id, json, now } from './ids.js';
import type { ArtifactRef, ProjectRecord } from './types.js';

export class EditorialDocuments {
  constructor(private readonly storage: EditorialStorage, private readonly repo: EditorialRepository) {}

  writeManuscript(project: ProjectRecord, markdown: string, taskId?: string): ArtifactRef {
    const stored = this.storage.write(project.id, 'originals', 'md', markdown);
    const artifactId = id('artifact');
    const revision = this.repo.createRevision(project.id, 'manuscript', stored.sha256, { format: 'markdown', artifactId }, project.activeRevisionId);
    const artifact = { ...toArtifact(project.id, 'manuscript_source', stored, { format: 'markdown', generatedAt: now(), contentKind: 'editable-source' }, taskId), id: artifactId, revisionId: revision.id };
    this.repo.recordArtifact(artifact);
    return artifact;
  }

  exportEpub(project: ProjectRecord, title: string, author: string | undefined, markdown: string, taskId?: string): ArtifactRef {
    const bytes = epub(title, author, markdown);
    const stored = this.storage.write(project.id, 'derived', 'epub', bytes);
    const artifact = toArtifact(project.id, 'epub', stored, { title, author, format: 'epub', generatedAt: now(), source: 'manuscript' }, taskId);
    this.repo.recordArtifact(artifact);
    return artifact;
  }

  exportPdf(project: ProjectRecord, title: string, markdown: string, taskId?: string): ArtifactRef {
    const bytes = pdf(title, markdown);
    const stored = this.storage.write(project.id, 'derived', 'pdf', bytes);
    const artifact = toArtifact(project.id, 'pdf_interior', stored, { title, format: 'pdf', generatedAt: now(), validationScope: 'basic text PDF structure' }, taskId);
    this.repo.recordArtifact(artifact);
    return artifact;
  }

  writeRendering(project: ProjectRecord, title: string, markdown: string, taskId?: string): ArtifactRef {
    const html = `<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui;max-width:760px;margin:3rem auto;padding:0 1rem;line-height:1.55}h1{font-size:2rem}pre{white-space:pre-wrap}</style></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(markdown)}</pre></body></html>`;
    const stored = this.storage.write(project.id, 'renderings', 'html', html);
    const artifact = toArtifact(project.id, 'rendering', stored, { title, format: 'html-preview', generatedAt: now(), reviewed: false }, taskId);
    this.repo.recordArtifact(artifact);
    return artifact;
  }

  writeTextArtifact(project: ProjectRecord, type: ArtifactRef['type'], area: 'originals' | 'sources' | 'derived' | 'reports' | 'social', content: string, metadata: Record<string, unknown>, taskId?: string): ArtifactRef {
    const stored = this.storage.write(project.id, area, 'md', content);
    const artifact = toArtifact(project.id, type, stored, { ...metadata, generatedAt: now(), contentKind: 'editable-text' }, taskId);
    this.repo.recordArtifact(artifact);
    return artifact;
  }

  createPackage(project: ProjectRecord, artifacts: ArtifactRef[], metadata: Record<string, unknown>, taskId?: string): ArtifactRef {
    const manifest = { projectId: project.id, projectTitle: project.title, generatedAt: now(), metadata, artifacts: artifacts.map((artifact) => ({ id: artifact.id, type: artifact.type, sha256: artifact.sha256, path: artifact.path, sizeBytes: artifact.sizeBytes })) };
    const files: Record<string, Uint8Array> = { 'MANIFEST.json': strToU8(JSON.stringify(manifest, null, 2)) };
    for (const artifact of artifacts) files[`artifacts/${artifact.id}-${artifact.type}`] = this.storage.read(artifact.path);
    const stored = this.storage.write(project.id, 'packages', 'zip', zipSync(files, { level: 0 }));
    const record = toArtifact(project.id, 'release_package', stored, { manifest, artifactIds: artifacts.map((artifact) => artifact.id), generatedAt: now() }, taskId);
    this.repo.recordArtifact(record);
    return record;
  }
}

function toArtifact(projectId: string, type: ArtifactRef['type'], stored: { relativePath: string; sha256: string; sizeBytes: number }, metadata: Record<string, unknown>, taskId?: string): ArtifactRef {
  return { id: id('artifact'), type, projectId, taskId, path: stored.relativePath, sha256: stored.sha256, sizeBytes: stored.sizeBytes, metadata };
}

function epub(title: string, author: string | undefined, markdown: string): Uint8Array {
  const safeTitle = escapeHtml(title);
  const safeAuthor = escapeHtml(author || 'Autor configurable');
  const body = markdownToXhtml(markdown);
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:${id('book')}</dc:identifier><dc:title>${safeTitle}</dc:title><dc:language>es-419</dc:language><dc:creator>${safeAuthor}</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`),
    'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="es-419"><head><title>${safeTitle}</title></head><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="chapter.xhtml">${safeTitle}</a></li></ol></nav></body></html>`),
    'OEBPS/chapter.xhtml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="es-419"><head><title>${safeTitle}</title></head><body><h1>${safeTitle}</h1>${body}</body></html>`),
  };
  return zipSync(files, { level: 0 });
}

function markdownToXhtml(markdown: string): string {
  return markdown.split(/\r?\n/).map((line) => {
    if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
    if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    if (!line.trim()) return '';
    return `<p>${escapeHtml(line)}</p>`;
  }).join('\n');
}

function pdf(title: string, markdown: string): Uint8Array {
  const lines = [`${title}`, '', ...markdown.replace(/\r/g, '').split('\n')].flatMap((line) => wrap(line, 92));
  const pages = [] as string[][];
  for (let i = 0; i < lines.length; i += 44) pages.push(lines.slice(i, i + 44));
  const objects: string[] = [];
  const pageIds: number[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const pageLines of pages.length ? pages : [['']]) {
    const content = ['BT', '/F1 10 Tf', '50 760 Td', ...pageLines.map((line, index) => `${index ? '0 -16 Td ' : ''}(${escapePdf(line)}) Tj`), 'ET'].join('\n');
    const contentId = objects.length + 1;
    objects.push(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`);
    const pageId = objects.length + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join(''), 'utf8'));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xref = Buffer.byteLength(chunks.join(''), 'utf8');
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new TextEncoder().encode(chunks.join(''));
}

function wrap(value: string, width: number): string[] {
  if (!value) return [''];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

function escapePdf(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)').replace(/[\u0000-\u001f\u007f-\u00ff]/g, '?');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function manifestJson(project: ProjectRecord, artifacts: ArtifactRef[], metadata: Record<string, unknown>): string {
  return json({ projectId: project.id, title: project.title, artifacts, metadata });
}

export interface DocumentValidation {
  ok: boolean;
  problems: string[];
}

export function validateEpub(bytes: Uint8Array): DocumentValidation {
  const problems: string[] = [];
  try {
    const files = unzipSync(bytes);
    const names = Object.keys(files);
    if (!names.includes('mimetype')) problems.push('Missing mimetype');
    else if (new TextDecoder().decode(files.mimetype) !== 'application/epub+zip') problems.push('Invalid mimetype content');
    for (const required of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml']) if (!names.includes(required)) problems.push(`Missing ${required}`);
  } catch {
    problems.push('Not a readable ZIP/EPUB container');
  }
  return { ok: problems.length === 0, problems };
}

export function validatePdf(bytes: Uint8Array): DocumentValidation {
  const text = new TextDecoder('latin1').decode(bytes);
  const problems: string[] = [];
  if (!text.startsWith('%PDF-')) problems.push('Missing PDF header');
  if (!text.includes('%%EOF')) problems.push('Missing PDF EOF marker');
  if (!text.includes('/Type /Catalog')) problems.push('Missing PDF catalog');
  return { ok: problems.length === 0, problems };
}
