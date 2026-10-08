// The coordinator's board, parsed: the phase plan a project's coordinator keeps in its `plans/`
// folder (see the coordinator skill). Pure, so the office can render it and tests can pin it.

import type { CoordinatorChapter, CoordinatorState, CoordinatorSummary, SubplanCard, SubplanStatus, TimelineEvent } from './protocol.js';

/** A floor with no plan: the office says so in words rather than drawing an empty board. */
export const EMPTY_COORDINATOR: CoordinatorState = {
  phase: null,
  goal: null,
  chapters: [],
  cards: [],
  summary: { inFlight: '', planned: '', ready: '', resume: '' },
  timeline: [],
  at: 0,
};

/** The statuses the coordinator's board uses, in the order the skill lists them. */
const STATUSES: readonly SubplanStatus[] = ['Pending', 'Ready', 'Planned', 'In flight', 'Blocked', 'Done'];

/** The phase `plans/current.md` points at. */
export function parsePhase(current: string): string | null {
  const m = /^Current phase:\s*(.+?)\s*$/m.exec(current);
  return m ? m[1] : null;
}

/** The goal and chapters of a phase's master plan. */
export function parseMasterplan(md: string): { goal: string | null; chapters: CoordinatorChapter[] } {
  return { goal: section(md, 'Goal'), chapters: chaptersOf(md) };
}

/** The board's header and cards, from a phase's checklist. */
export function parseChecklist(md: string): { summary: CoordinatorSummary; cards: SubplanCard[] } {
  const summary: CoordinatorSummary = {
    inFlight: header(md, 'In flight'),
    planned: header(md, 'Planned'),
    ready: header(md, 'Ready'),
    resume: header(md, 'Resume'),
  };
  const cards: SubplanCard[] = [];
  let chapter = '';
  for (const line of md.split('\n')) {
    const h = /^##\s+(\S+)\s*[—–-]\s*(.+?)\s*$/.exec(line);
    if (h) {
      chapter = h[1];
      continue;
    }
    const c = /^-\s*\[( |x|X)\]\s*(\d+(?:\.\d+)+)-(\S+)\s*[—–-]\s*(.+?)\s*$/.exec(line);
    if (!c) continue;
    const text = c[4];
    const owner = /owner:\s*([^)]+)\)/.exec(text)?.[1]?.trim();
    const note = /awaiting user:\s*([^)]+)\)/.exec(text)?.[1]?.trim();
    cards.push({
      id: c[2],
      name: c[3],
      chapter,
      status: statusOf(text, c[1].toLowerCase() === 'x'),
      statusText: text.split('(')[0].trim() || text.trim(),
      ...(owner ? { owner } : {}),
      ...(note ? { note } : {}),
    });
  }
  return { summary, cards };
}

/** Every event a phase's timeline holds, oldest first. */
export function parseTimeline(md: string): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const line of md.split('\n')) {
    const m = /^-\s*(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})\s*[—–-]\s*(.+?)\s*$/.exec(line);
    if (m) out.push({ date: m[1], time: m[2], text: m[3] });
  }
  return out;
}

/** The day as YYYY-MM-DD, in the reader's own time zone (the boards show today's events). */
export function localDay(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The body of a `## <name>` section, up to the next level-2 heading. */
function section(md: string, name: string): string | null {
  const m = new RegExp(`^##\\s+${name}\\s*$`, 'm').exec(md);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  const end = rest.search(/^##\s/m);
  const body = (end < 0 ? rest : rest.slice(0, end)).trim();
  return body || null;
}

/** The chapters a master plan lists (`### NN — <title>`, with its `- Core question:`). */
function chaptersOf(md: string): CoordinatorChapter[] {
  const out: CoordinatorChapter[] = [];
  let current: CoordinatorChapter | null = null;
  for (const line of md.split('\n')) {
    const h = /^###\s+(\S+)\s*[—–-]\s*(.+?)\s*$/.exec(line);
    if (h) {
      current = { n: h[1], title: h[2] };
      out.push(current);
      continue;
    }
    if (/^#{1,2}\s/.test(line)) {
      current = null;
      continue;
    }
    const q = /^-\s*Core question:\s*(.+?)\s*$/.exec(line);
    if (q && current) current.question = q[1];
  }
  return out;
}

/** One of the checklist's header lines ("In flight: …"), or ''. */
function header(md: string, label: string): string {
  const m = new RegExp(`^${label}:\\s*(.*?)\\s*$`, 'm').exec(md);
  return m ? m[1] : '';
}

/** The status a card's text names, or `checked`/Pending when it names none. */
function statusOf(text: string, checked: boolean): SubplanStatus {
  const lower = text.toLowerCase();
  return STATUSES.find((s) => lower.startsWith(s.toLowerCase())) ?? (checked ? 'Done' : 'Pending');
}
