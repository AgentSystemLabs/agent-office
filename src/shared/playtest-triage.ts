import { inferModes, inferStyles } from './playtest-categories.js';
import type { PlaytestInput } from './playtests.js';

export interface TriageIssue { number: number; title: string; body: string; url: string; updatedAt: string; state: string; }
export interface TriageCheck { line: number; text: string; kind: 'manual' | 'development' | 'unclear'; test?: PlaytestInput; }
export interface TriageProposal {
  issue: TriageIssue; checks: TriageCheck[]; kind: 'manual' | 'mixed' | 'unclear'; close: boolean; fingerprint?: string;
}
const manualTitle = /(?:headsets?.*(?:test|prüf|abhör)|(?:test|prüf).*headsets?|playtest|spieltest|VR.*abnahme|co.?op.*testen|manuell.*prüfen|quest.*prüfen)/i;
const technical = /\b(doku\w*|docs?\/|implement\w*|umsetz\w*|einbau\w*|ergänz\w*|automatis\w*|editmode|playmode|unit.?test|regressionstest|assert\w*|mock\w*|testfixture|build.?pipeline|codeänder\w*|fix\w*|beheb\w*|profil\w*|messplan|entscheid\w*)\b/i;
const manual = /\b(headsets?|quest|controller|mitspieler|im spiel|manuell|lokale[rmn]?\s+ko[ -]?op|zwei spieler|beide spieler|spielrunde|haptik)\b/i;
const production = /(?:erstell|aufnehm|exportier|hochlad|upload|nachstell|anpass|konfigurier|einricht|produzier|bereitstell|aktualisier|dokumentier)/i;
const testAction = /(?:testen|prüfen|ausprobieren|abhören|verifizieren|testlauf|spieltest|playtest)/i;

/** Conservative preview: prose or uncertain criteria can never be silently discarded. */
export function classifyPlaytestIssue(issue: TriageIssue): TriageProposal | null {
  const titleIsManual = manualTitle.test(issue.title);
  const lines = issue.body.split('\n');
  const checks: TriageCheck[] = [];
  let fenced = false;
  for (let line = 0; line < lines.length; line++) {
    if (/^\s*```/.test(lines[line])) { fenced = !fenced; continue; }
    if (fenced) continue;
    const match = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(lines[line]);
    if (!match || match[1] !== ' ') continue;
    const text = match[2];
    // Continuation lines need human interpretation; do not detach half of a criterion.
    const continued = /^\s{2,}\S/.test(lines[line + 1] ?? '') && !/^\s*[-*]\s+\[/.test(lines[line + 1] ?? '');
    const kind = technical.test(text) || production.test(text) ? 'development' : !continued && (titleIsManual || (manual.test(text) && testAction.test(text))) ? 'manual' : 'unclear';
    const context = `${issue.title} ${text}`;
    checks.push({ line, text, kind, ...(kind === 'manual' ? { test: {
      title: text.slice(0, 175), steps: `Prüfe im Spiel: ${text}`, expected: text,
      setup: titleIsManual ? issue.title : 'Passenden Spielmodus starten; benötigte Geräte und Mitspieler vorbereiten.',
      category: /audio|sound|ton|hören/i.test(context) ? 'Audio' : /waffe|pistol|schuss|weapon/i.test(context) ? 'Waffen' : /zombie|ragdoll/i.test(context) ? 'Zombies' : 'Spielablauf',
      modes: inferModes(context), playStyles: inferStyles(`${context} ${issue.body}`), source: issue.url,
    } } : {}) });
  }
  if (!checks.some(c => c.kind === 'manual') && !titleIsManual) return null;
  const outside = lines.filter((_, i) => !checks.some(c => c.line === i)).join('\n');
  // Explicit implementation requests outside the checkbox list keep the issue open too.
  const proseWork = /(?:bitte|muss|soll|noch|TODO|offen)[^\n]{0,80}(?:implementier|einbau|beheb|entwickel|ergänz|dokumentier)|^\s*(?:implement|fix|add|repair|implementiere|behebe|ergänze)\b/im.test(outside);
  const close = titleIsManual && checks.length > 0 && checks.every(c => c.kind === 'manual') && !proseWork;
  const kind = close ? 'manual' : checks.some(c => c.kind === 'development') ? 'mixed' : 'unclear';
  return { issue, checks, kind, close };
}

export function transferredIssueBody(proposal: TriageProposal, tests: { line: number; id: string }[]): string {
  const lines = proposal.issue.body.split('\n');
  for (const test of tests) {
    const check = proposal.checks.find(c => c.line === test.line && c.kind === 'manual');
    if (check) lines[test.line] = `- ↪ **Playtest ausstehend:** ${check.text} — Agent Office Playtest-ID: \`${test.id}\``;
  }
  return `${lines.join('\n')}\n\n<!-- office-playtest-transfer:${proposal.issue.number} -->\n**Manuelle Tests übertragen:** Die oben verlinkten Prüfungen stehen in der Playtest-Checkliste von Agent Office. Sie wurden damit nicht als bestanden markiert. ${proposal.close ? 'Dieses reine Test-Issue wird geschlossen; die Spieltests bleiben offen.' : 'Implementierung, Dokumentation und automatisierte Prüfungen bleiben Aufgaben dieses Issues.'}\n`;
}
