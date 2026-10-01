import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Presentation } from '../shared/protocol.js';

export function presentationBrief(id: string): string {
  return `Office TV: when you finish meaningful work, lean toward presenting it. Write .agent-office/presentations/${id}.json in your working directory before ending your turn. Use {"title":"…","summary":"…","html":"…"}. Make a self-contained HTML artifact using the project's design language: show the result, comparisons or a working interactive prototype, evidence/checks, and useful next decisions. Prefer visual explanations over a wall of text. Inline CSS/JS only, no external resources. Keep under 100 KB. Do not publish secrets. Skip trivial replies, unfinished work and work without a useful artifact. The office publishes the file automatically on completion; replace it for each new result.`;
}

export function readPresentation(cwd: string, id: string, after: number): Presentation | undefined {
  try {
    const file = path.join(cwd, '.agent-office', 'presentations', `${id}.json`);
    const stat = statSync(file);
    if (stat.size > 100_000 || stat.mtimeMs <= after) return;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof value.title !== 'string' || typeof value.summary !== 'string' || typeof value.html !== 'string' || !value.html.trim()) return;
    return { title: value.title.slice(0, 120), summary: value.summary.slice(0, 1000), html: value.html, at: Date.now() };
  } catch { return; }
}
