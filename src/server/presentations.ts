import { readFileSync, statSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { Presentation, ArchivedPresentation, WorkerInfo } from '../shared/protocol.js';

export function presentationBrief(id: string): string {
  return `Office TV: when you finish meaningful work, lean toward presenting it. Write .agent-office/presentations/${id}.json in your working directory before ending your turn. Build the presentation with HTML + CSS + JavaScript if needed; libraries are welcome when bundled into the artifact. The JSON file is only the publishing envelope: use {"title":"…","summary":"…","html":"…"}, with your HTML document in the html field. Include optional links: [{"label":"PR #123 or Issue #456","url":"https://github.com/owner/repo/pull/123"}] for source context. Make a self-contained HTML artifact using the project's design language: show the result, comparisons or a working interactive prototype, evidence/checks, and useful next decisions. Prefer visual explanations over a wall of text. Bundle styles, scripts and any libraries inline so the artifact works in the TV viewer, which blocks network requests. Links can open in a new tab. Keep under 100 KB. Do not publish secrets. Skip trivial replies, unfinished work and work without a useful artifact. The office publishes the file automatically on completion; replace it for each new result.`;
}

export function readPresentation(cwd: string, id: string, after: number): Presentation | undefined {
  try {
    const file = path.join(cwd, '.agent-office', 'presentations', `${id}.json`);
    const stat = statSync(file);
    if (stat.size > 100_000 || stat.mtimeMs <= after) return;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof value.title !== 'string' || typeof value.summary !== 'string' || typeof value.html !== 'string' || !value.html.trim()) return;
    return { title: value.title.slice(0, 120), summary: value.summary.slice(0, 1000), html: value.html, at: stat.mtimeMs, links: presentationLinks(value.links) };
  } catch { return; }
}

/** Only web links leave the sandbox; reject executable and local URL schemes. */
export function presentationLinks(value: unknown): { label: string; url: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(v => v && typeof v.label === 'string' && typeof v.url === 'string' && /^https?:\/\//i.test(v.url))
    .slice(0, 12).map(v => ({ label: v.label.slice(0, 120), url: v.url.slice(0, 2048) }));
}

/** Immutable versions survive worker departures and office restarts. */
export class PresentationArchive {
  items: ArchivedPresentation[] = [];
  private file: string;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'presentation-archive.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      if (Array.isArray(saved)) this.items = saved.filter(v => typeof v.id === 'string' && typeof v.workerId === 'string' && typeof v.name === 'string' && v.presentation && typeof v.presentation.html === 'string' && typeof v.presentation.title === 'string' && typeof v.presentation.summary === 'string' && Number.isFinite(v.presentation.at))
        .map(v => ({ ...v, presentation: { ...v.presentation, links: presentationLinks(v.presentation.links) } }));
    } catch { /* First run. */ }
  }
  capture(worker: WorkerInfo, links: { label: string; url: string }[] = []): boolean {
    if (!worker.presentation) return false;
    const id = worker.id + ':' + worker.presentation.at;
    const existing = this.items.find(v => v.id === id);
    // PR discovery can finish after the completion hook. Fill missing context without replacing it.
    if (existing) {
      const previous = existing.presentation.links ?? [];
      const additions = presentationLinks(links).filter(link => !previous.some(p => p.url === link.url || p.label === link.label));
      if (!additions.length) return false;
      const items = this.items.map(item => item.id === id ? { ...item, presentation: { ...item.presentation, links: [...previous, ...additions].slice(0, 12) } } : item);
      this.save(items);
      return true;
    }
    const presentation = { ...worker.presentation, links: presentationLinks([...(worker.presentation.links ?? []), ...links]) };
    const items = [{ id, workerId: worker.id, name: worker.name, presentation }, ...this.items].sort((a, b) => b.presentation.at - a.presentation.at);
    this.save(items);
    return true;
  }
  private save(items: ArchivedPresentation[]) {
    writeFileSync(this.file + '.tmp', JSON.stringify(items), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
    this.items = items;
  }
}
