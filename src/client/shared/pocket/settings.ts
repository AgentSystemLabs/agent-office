import type { Settings, ViewMode } from '../../state';
import { h, openModal } from '../../ui/dom';
import { openPocketElevator } from '../../ui/pocket-elevator';
import { pocketRuntime } from './runtime';

/** Pocket settings are local preferences. Opening this dialog never sends a runtime request. */
export function openPocketSettings(settings: Settings, onChange: (settings: Settings) => void, onCharacter: () => void): boolean {
  if (!pocketRuntime()) return false;
  const change = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    onChange(settings);
  };
  const camera = h('div.seg', { role: 'radiogroup', 'aria-label': 'Camera view' });
  const paintCamera = () => camera.replaceChildren(...([['first', 'First person'], ['third', 'Third person']] as [ViewMode, string][]).map(([view, label]) =>
    h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(settings.view === view), class: settings.view === view ? 'on' : '', onclick: () => { change({ view }); paintCamera(); } }, label),
  ));
  paintCamera();
  const volume = (label: string, level: 'volume' | 'music', muted: 'muted' | 'musicMuted') => {
    const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': label });
    const mute = h('button.btn', { type: 'button' });
    const percent = h('span.vol-pct');
    const paint = () => {
      const value = Math.round(settings[level] * 100);
      slider.value = String(value);
      slider.style.setProperty('--fill', `${value}%`);
      percent.textContent = settings[muted] ? 'Muted' : `${value}%`;
      mute.textContent = settings[muted] ? 'Unmute' : 'Mute';
      mute.setAttribute('aria-label', `${settings[muted] ? 'Unmute' : 'Mute'} ${label}`);
      mute.setAttribute('aria-pressed', String(settings[muted]));
    };
    slider.addEventListener('input', () => { change({ [level]: Number(slider.value) / 100, [muted]: false }); paint(); });
    mute.addEventListener('click', () => { change({ [muted]: !settings[muted] }); paint(); });
    paint();
    return h('div.volume', {}, mute, slider, percent);
  };
  const section = (title: string, ...children: Node[]) => h('section.setting', {}, h('div.setting-head', {}, h('h4', {}, title)), ...children);
  const character = h('button.btn', { type: 'button' }, 'Change avatar');
  const workspace = h('button.btn', { type: 'button' }, 'Switch workspace');
  const el = h('div.modal.pocket-settings', { role: 'dialog', 'aria-label': 'Pocket room settings' },
    h('header', {}, h('h2', {}, 'Room settings')),
    h('div.body', {},
      section('Camera', camera),
      section('Office sounds', volume('Office sounds volume', 'volume', 'muted')),
      section('Music preference', volume('Music volume', 'music', 'musicMuted'), h('p.setting-note', {}, 'This is a local playback preference. Shared jukebox controls are not connected in Pocket.')),
      section('Your room', h('div.seg', {}, character, workspace)),
      h('p.setting-note', {}, 'Click a worker or the Master desk for its live Pocket conversation, prompts, tools, and approvals inside the office. GitHub is not connected.'),
    ),
  );
  const modal = openModal(el);
  character.addEventListener('click', () => { modal.close(); onCharacter(); });
  workspace.addEventListener('click', () => { modal.close(); openPocketElevator(); });
  return true;
}
