/** Human checks are a separate checklist, never queue work or merge gates. */
export interface PlaytestInput {
  title: string;
  steps: string;
  expected: string;
  category: string;
  source: string;
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
}

export interface PlaytestState { items: Playtest[] }

export const PLAYTEST_HANDOFF = 'For manual checks the owner chooses to do later, add a human checklist entry with office-playtests add (JSON on stdin: title, category, steps, expected, source HTTPS URL). Use office-playtests list first to avoid duplicates. These are personal playtests, not worker queue tasks or merge gates. Never check off a human test yourself or claim hardware testing was performed. This does not waive technical checks or missing implementation.';

export function playtestMarkdown(items: Playtest[]): string {
  return ['# Playtest checklist', '', 'Personal checks; not worker tasks or merge requirements.', '', ...items.flatMap((t) => [
    `- [${t.done ? 'x' : ' '}] ${t.title.replace(/[\r\n]/g, ' ')} (${t.category})`,
    `  Steps: ${t.steps.replace(/\n/g, '\n  ')}`,
    `  Expected: ${t.expected.replace(/\n/g, '\n  ')}`,
    ...(t.source ? [`  Source: ${t.source}`] : []),
    ...(t.notes ? [`  Notes: ${t.notes.replace(/\n/g, '\n  ')}`] : []),
    '',
  ])].join('\n');
}
