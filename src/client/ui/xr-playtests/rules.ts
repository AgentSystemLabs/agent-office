import { h } from '../dom';
import { XR_PHASES } from '../../../shared/xr-playtests';
import type { XrRule } from '../../../shared/xr-session';
import type { Playtest } from '../../../shared/playtests';
export function ruleEditor(test: Playtest, rule: XrRule | undefined, signals: string[], save: (body: unknown) => Promise<void>) {
  const phases = XR_PHASES.map(phase => {
    const box = h('input', { type: 'checkbox' }); box.checked = !!rule?.phases?.includes(phase);
    return { phase, box, label: h('label', {}, box, ({ lobby: 'Lobby', playing: 'Runde', break: 'Pause / Shop', 'game-over': 'Spielende' })[phase]) };
  });
  const role = h('select', { 'aria-label': 'Spielerrolle' }, h('option', { value: '' }, 'Jede Rolle'), h('option', { value: 'host' }, 'Host'), h('option', { value: 'guest' }, 'Gast')); role.value = rule?.role ?? '';
  const two = h('input', { type: 'checkbox' }); two.checked = rule?.twoDevices ?? false;
  const signal = h('select', { 'aria-label': 'Technisches Kriterium' }, h('option', { value: '' }, 'Manuell beurteilen'), ...[...new Set([...signals, ...(rule?.signal ? [rule.signal] : [])])].sort().map(s => h('option', { value: s }, s))); signal.value = rule?.signal ?? '';
  const expected = h('input', { 'aria-label': 'Erwarteter Wert', placeholder: 'z. B. true, 0 oder "Off"', value: rule?.equals === undefined ? '' : JSON.stringify(rule.equals) });
  const error = h('p.xr-error', { role: 'alert' });
  const form = h('form.xr-rule', {}, h('h4', {}, 'Voraussetzungen und technisches Kriterium'),
    rule && rule.revision !== test.revision ? h('p', {}, 'Test wurde geändert. Voraussetzungen prüfen und erneut speichern.') : null,
    h('p', {}, 'Keine Phase ausgewählt bedeutet alle Phasen. Ein Kriterium vergleicht nur den benannten Messwert; es bestätigt nicht den gesamten Test.'),
    ...phases.map(p => p.label), role, h('label', {}, two, 'Zwei Headsets mit Host/Gast und gleichem Build erforderlich'), signal, expected, error,
    h('button.btn', { type: 'submit' }, 'Voraussetzungen speichern'));
  form.onsubmit = e => { e.preventDefault(); error.textContent = ''; let equals;
    try { equals = signal.value ? JSON.parse(expected.value) : undefined; } catch { error.textContent = 'Wert als Zahl, true/false oder Text in Anführungszeichen eingeben.'; return; }
    void save({ action: 'rule', testId: test.id, rule: { revision: test.revision, phases: phases.filter(p => p.box.checked).map(p => p.phase), role: role.value || undefined, twoDevices: two.checked, signal: signal.value || undefined, equals } });
  };
  return form;
}
