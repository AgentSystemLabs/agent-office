export const PLAYTEST_MODES = ['Allgemein', 'RB', 'RIFT', 'Rooftop', 'Safe Zone', 'Gas Station'] as const;
export type PlaytestMode = typeof PLAYTEST_MODES[number];
export const PLAY_STYLES = ['solo', 'local-coop', 'online-coop'] as const;
export type PlayStyle = typeof PLAY_STYLES[number];
export const STYLE_LABELS: Record<PlayStyle, string> = { solo: 'Solo', 'local-coop': 'Lokaler Koop', 'online-coop': 'Online-Koop' };
export const TEST_OUTCOMES = ['open', 'passed', 'failed', 'blocked'] as const;
export type TestOutcome = typeof TEST_OUTCOMES[number];
export const OUTCOME_LABELS: Record<TestOutcome, string> = { open: 'Offen', passed: 'Bestanden', failed: 'Fehler gefunden', blocked: 'Nicht testbar' };

/** Deterministic defaults for old entries; explicit human categorization always wins. */
export function inferModes(text: string): PlaytestMode[] {
  const modes: PlaytestMode[] = [];
  if (/\b(reality\s*breach|real[iy]\s*breach|RB)\b/i.test(text)) modes.push('RB');
  if (/\b(rift|hellgate)\b/i.test(text)) modes.push('RIFT');
  if (/\brooftop\b/i.test(text)) modes.push('Rooftop');
  if (/\bsafe[ -]?zone\b/i.test(text)) modes.push('Safe Zone');
  if (/\bgas[ -]?station\b/i.test(text)) modes.push('Gas Station');
  if (!modes.length && /\bVR\b/i.test(text)) modes.push('Rooftop', 'Safe Zone', 'Gas Station');
  return modes.length ? modes : ['Allgemein'];
}
export function inferStyles(text: string): PlayStyle[] {
  const styles: PlayStyle[] = [];
  if (/\bsolo\b/i.test(text)) styles.push('solo');
  if (/\b(lokal\w*|local|colocat\w*)\b/i.test(text)) styles.push('local-coop');
  if (/\bonline\b/i.test(text)) styles.push('online-coop');
  if (!styles.length && /ko[ -]?op|co[ -]?op|headsets|mitspieler|guest|gast/i.test(text)) styles.push('local-coop', 'online-coop');
  return styles;
}
export function testModes(t: { modes?: PlaytestMode[]; title: string; category: string; steps: string; expected: string }): PlaytestMode[] {
  if (t.modes?.length) return t.modes;
  const inferred = inferModes(`${t.category} ${t.title} ${t.steps} ${t.expected}`);
  return /audio|sound/i.test(t.category) && !inferred.includes('Allgemein') ? ['Allgemein', ...inferred] : inferred;
}
export function testStyles(t: { playStyles?: PlayStyle[]; title: string; steps: string }): PlayStyle[] {
  return t.playStyles ?? inferStyles(`${t.title} ${t.steps}`);
}
export function testOutcome(t: { outcome?: TestOutcome; done: boolean }): TestOutcome { return t.outcome ?? (t.done ? 'passed' : 'open'); }
