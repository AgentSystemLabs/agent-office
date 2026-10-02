import type { Net } from '../net';
import { store, type Settings } from '../state';
import { BROWSER_PERFORMANCE_CHOICES, DEFAULT_BROWSER_PERFORMANCE, PERFORMANCE_PRESETS, performancePreset, type BrowserPerformance } from '../shared/performance';
import { OFFICE_PERFORMANCE_CHOICES, type OfficePerformanceSettings } from '../../shared/performance';
import { h } from './dom';
import { OfficePerformanceEdits } from '../shared/office-performance';
import { setting } from './settings-fields';

const browserChoices: { [K in keyof BrowserPerformance]: readonly BrowserPerformance[K][] } = BROWSER_PERFORMANCE_CHOICES;
const officeChoices: { [K in keyof OfficePerformanceSettings]: readonly OfficePerformanceSettings[K][] } = OFFICE_PERFORMANCE_CHOICES;

const PRESET_LABELS = { economy: 'Economy', balanced: 'Balanced', quality: 'Quality' } as const;

/** Presets and individual controls use the modal's current settings, so switching panes cannot lose edits. */
export function performancePane(net: Net, current: () => Settings, change: (next: Settings) => void) {
  const painters: (() => void)[] = [];
  const update = (performance: BrowserPerformance) => { change({ ...current(), performance }); painters.forEach((paint) => paint()); };
  const preset = h('div.seg', { role: 'radiogroup', 'aria-label': 'Performance preset' });
  const custom = h('span.setting-note');
  const buttons = Object.entries(PRESET_LABELS).map(([name, label]) => {
    const key = name as keyof typeof PERFORMANCE_PRESETS;
    const button = h('button.btn', { type: 'button', role: 'radio', onclick: () => update({ ...PERFORMANCE_PRESETS[key] }) }, label);
    preset.append(button);
    return { key, button };
  });
  preset.append(custom);
  painters.push(() => {
    const selected = performancePreset(current().performance);
    for (const { key, button } of buttons) { button.classList.toggle('on', selected === key); button.setAttribute('aria-checked', String(selected === key)); }
    custom.textContent = selected === 'custom' ? 'Custom' : '';
  });

  const browserControl = <K extends keyof BrowserPerformance>(key: K, label: string, format: (value: BrowserPerformance[K]) => string) => {
    const choices: readonly BrowserPerformance[K][] = browserChoices[key];
    const input = h('select.performance-select', { 'aria-label': label }, ...choices.map((value) => h('option', { value: String(value) }, format(value))));
    input.addEventListener('change', () => {
      const value = choices.find((value) => String(value) === input.value);
      if (value !== undefined) update({ ...current().performance, [key]: value });
    });
    painters.push(() => { input.value = String(current().performance[key]); });
    return setting(label, 'you', input);
  };
  const advanced = h('details.performance-details', {}, h('summary', {}, 'Browser advanced'),
    browserControl('idleFps', 'Idle drawing', (value) => `${value} FPS`),
    browserControl('outlines', 'Outlines', (value) => value ? 'On' : 'Off'),
    browserControl('shadowSize', 'Shadows', (value) => value ? `${value} px` : 'Off'),
    browserControl('previewFps', 'Character preview', (value) => `${value} FPS`),
    browserControl('laptopWidth', 'Laptop resolution', (value) => `${value} px wide`),
    browserControl('laptopRefreshMs', 'Laptop refresh', (value) => `${value} ms`));

  const officePainters: (() => void)[] = [];
  const edits = new OfficePerformanceEdits(() => store.performance.settings);
  let recovery: ReturnType<typeof setTimeout> | undefined;
  const sendOffice = (settings: OfficePerformanceSettings | null) => {
    net.send({ t: 'performance.set', settings });
    clearTimeout(recovery);
    recovery = setTimeout(() => { edits.recover(); paintOffice(); }, 3000);
    paintOffice();
  };
  const officeControl = <K extends keyof OfficePerformanceSettings>(key: K, label: string, format: (value: OfficePerformanceSettings[K]) => string) => {
    const choices: readonly OfficePerformanceSettings[K][] = officeChoices[key];
    const input = h('select.performance-select', { 'aria-label': label }, ...choices.map((value) => h('option', { value: String(value) }, format(value))));
    input.addEventListener('change', () => {
      const value = choices.find((value) => String(value) === input.value);
      if (store.me.admin && value !== undefined) sendOffice(edits.set(key, value));
    });
    officePainters.push(() => { input.value = String(edits.value()[key]); input.disabled = !store.me.admin; });
    return setting(label, 'office', input);
  };
  const officeReset = h('button.btn', { type: 'button', onclick: () => { if (store.me.admin) { edits.reset(); sendOffice(null); } } }, 'Reset office defaults');
  const officeNote = h('p.setting-note');
  const office = h('details.performance-details', {}, h('summary', {}, 'Office refresh'), officeNote,
    officeControl('screenFps', 'Terminal thumbnails', (value) => `${value} FPS`),
    officeControl('serviceScanSeconds', 'Service discovery', (value) => `${value} seconds`),
    officeControl('changesPollSeconds', 'Changes refresh', (value) => `${value} seconds`),
    officeControl('usageScanSeconds', 'Usage refresh', (value) => `${value} seconds`), officeReset);
  const paintOffice = () => {
    officePainters.forEach((paint) => paint());
    officeReset.disabled = !store.me.admin;
    officeNote.textContent = store.me.admin ? 'Building-wide. Longer intervals reduce background work.' : 'Building-wide. Admins can change these controls.';
  };
  const reset = h('button.btn', { type: 'button', onclick: () => update({ ...DEFAULT_BROWSER_PERFORMANCE }) }, 'Reset browser defaults');
  const nodes = [setting('Preset', 'you', preset), browserControl('fps', 'Frame rate', (value) => value === 'display' ? 'Display refresh' : `${value} FPS`),
    browserControl('pixelRatio', 'Resolution scale', (value) => `${value}×`), advanced, office, reset];
  painters.forEach((paint) => paint());
  paintOffice();
  const off = [store.on('performance', () => {
    if (edits.acknowledge(store.performance.settings)) clearTimeout(recovery);
    paintOffice();
  }), store.on('me', () => { if (!store.me.admin) { edits.recover(); clearTimeout(recovery); } paintOffice(); })];
  return { nodes, dispose: () => { clearTimeout(recovery); off.forEach((dispose) => dispose()); } };
}
