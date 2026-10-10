import { testModes, testStyles, testOutcome, OUTCOME_LABELS } from './playtest-categories.js';
import type { PlaytestMode, PlayStyle, TestOutcome } from './playtest-categories.js';

/** Human checks are a separate checklist, never queue work or merge gates. */
export interface PlaytestInput {
  title: string;
  steps: string;
  expected: string;
  category: string;
  source: string;
  modes?: PlaytestMode[];
  playStyles?: PlayStyle[];
  setup?: string;
}

export interface Playtest extends PlaytestInput {
  id: string;
  revision: number;
  notes: string;
  done: boolean;
  createdAt: string;
  createdBy: string;
  checkedAt?: string;
  checkedBy?: string;
  outcome?: TestOutcome;
  build?: string;
  results?: { outcome: TestOutcome; build: string; at: string; by: string }[];
}

export interface PlaytestState { items: Playtest[] }

export const PLAYTEST_HANDOFF = 'For manual checks the owner chooses to do later, add a human checklist entry with office-playtests add (JSON on stdin: title, category, steps, expected, source HTTPS URL). Use office-playtests list first to avoid duplicates. Categorize modes as Allgemein, RB, RIFT, Rooftop, Safe Zone, Gas Station (multiple allowed); playStyles as solo, local-coop, online-coop. Keep category as the topic (Audio, Weapons, Zombies, etc.). Human/headset/play-session validation belongs ONLY here, never create development issues solely to wait for a human test. Mixed issues retain implementation, documentation and automated tests only; link their manual checks here. Apply this separation to new issues, meeting outcomes and PR completion, even when a human check is still pending. These are personal playtests, not worker queue tasks or merge gates. Never check off a human test yourself or claim hardware testing was performed. This does not waive technical checks or missing implementation.';

export function playtestMarkdown(items: Playtest[]): string {
  return ['# Playtest checklist', '', 'Personal checks; not worker tasks or merge requirements.', '', ...items.flatMap((t) => [
    `- [${t.done ? 'x' : ' '}] ${t.title.replace(/[\r\n]/g, ' ')} (${t.category})`,
    `  Bereiche: ${testModes(t).join(', ')}; Spielweise: ${testStyles(t).join(', ') || 'alle'}; Ergebnis: ${OUTCOME_LABELS[testOutcome(t)]}`,
    ...(t.setup ? [`  Vorbereitung: ${t.setup.replace(/\n/g, '\n  ')}`] : []),
    ...(t.build ? [`  Getesteter Build: ${t.build}`] : []),
    `  Steps: ${t.steps.replace(/\n/g, '\n  ')}`,
    `  Expected: ${t.expected.replace(/\n/g, '\n  ')}`,
    ...(t.source ? [`  Source: ${t.source}`] : []),
    ...(t.notes ? [`  Notes: ${t.notes.replace(/\n/g, '\n  ')}`] : []),
    '',
  ])].join('\n');
}
