import type { Coworker } from './cast';

export interface Preferences { enabled: boolean; quiet: boolean }
const PREF_KEY = 'agent-office.ambient.preferences';
export function readPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
    return { enabled: p?.enabled !== false, quiet: p?.quiet === true };
  } catch { return { enabled: true, quiet: false }; }
}
export function savePreferences(p: Preferences) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* Browser storage can be blocked. */ }
}
const noteKey = (floor: string) => `agent-office.ambient.notes.${floor}`;
export function readNotes(floor: string): string {
  try { return (localStorage.getItem(noteKey(floor)) ?? '').slice(0, 12000); } catch { return ''; }
}
export function saveNotes(floor: string, value: string): boolean {
  try { localStorage.setItem(noteKey(floor), value.slice(0, 12000)); return true; } catch { return false; }
}

/** An actual local task organizer, not an assertion that an external action happened. */
export function checklist(text: string): string {
  return text.split('\n').map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)]|\[[ xX]\])\s*/, '').trim())
    .filter(Boolean).map((line) => `☐ ${line}`).join('\n');
}

/** Prepare a handoff the user can copy to an existing worker. No pretend AI answer. */
export function workBrief(p: Coworker, text: string): string {
  return `Work brief · ${p.utility}\n\nRequest:\n${text.trim()}\n\nApproach:\n${p.id === 'dwight' ? 'Turn the request into an ordered checklist. Check prerequisites, missing information and completion criteria.' : p.id === 'jim' ? 'Use concise, plain language. State the main point and concrete next steps.' : p.id === 'oscar' ? 'Separate facts from assumptions. Show calculations and identify missing inputs.' : p.id === 'angela' ? 'Check categories, consistent formatting and required records. Flag uncertain entries.' : p.id === 'stanley' ? 'Keep the review focused. Identify only the changes needed to finish the task.' : p.id === 'toby' || p.id === 'holly' ? 'Use considerate language, protect private information and ask about relevant policy rather than inventing it.' : p.id === 'darryl' ? 'List dependencies, owners, deadlines and a practical order of operations.' : p.id === 'creed' ? 'Explore unusual creative ideas. Label speculation; do not treat this as compliance advice.' : p.id === 'kevin' ? 'Simplify the idea into a few approachable steps. Keep this low-stakes; do not use it as financial advice.' : p.id === 'ryan' ? 'Explore marketing concepts and pitches. Verify factual claims before using them.' : p.id === 'david' ? 'Clarify the decision, priorities, tradeoffs and the evidence that would change the recommendation.' : p.id === 'andy' ? 'Prepare a concise presentation outline and rehearsal questions. Check that the pitch matches the evidence.' : `Prepare a practical draft using ${p.utility.toLowerCase()}. Ask for missing details.`}\n\nExternal actions require a connected worker and your authorization. This scratchpad has not sent messages, scheduled events or changed external records.`;
}
