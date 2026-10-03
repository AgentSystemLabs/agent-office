import { h, openModal } from '../../ui/dom';
import type { Ambience, AmbienceKind } from './engine';
import './ui.css';

export const SCENES: readonly { kind: AmbienceKind; emoji: string; label: string }[] = [
  { kind: 'ocean', emoji: '🌊', label: 'Ocean waves' },
  { kind: 'rain', emoji: '🌧️', label: 'Rain' },
  { kind: 'forest', emoji: '🌲', label: 'Forest' },
];

/** What the thinking spot is playing, in words. */
export function nowPlaying(kind: AmbienceKind | null): string {
  const s = SCENES.find((x) => x.kind === kind);
  return s ? `${s.emoji} ${s.label}` : 'Silence';
}

/** E at the thinking spot: pick the sound to think to. It keeps playing after the window closes. */
export function openAmbience(amb: Ambience) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const buttons = SCENES.map((s) => {
    const b = h('button.scene', { type: 'button', 'aria-pressed': 'false' }, h('span.emoji', {}, s.emoji), s.label);
    b.addEventListener('click', () => {
      amb.play(s.kind);
      paint();
    });
    return b;
  });
  const off = h('button.btn', { type: 'button' }, '🔇 Off');
  off.addEventListener('click', () => {
    amb.play(null);
    paint();
  });
  const now = h('p.now');
  const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Volume' });
  const pct = h('span.pct');
  const paint = () => {
    const cur = amb.current();
    SCENES.forEach((s, i) => {
      buttons[i].classList.toggle('on', s.kind === cur);
      buttons[i].setAttribute('aria-pressed', String(s.kind === cur));
    });
    off.classList.toggle('on', cur === null);
    now.textContent = `Now playing: ${nowPlaying(cur)}`;
    const v = Math.round(amb.volume() * 100);
    slider.value = String(v);
    slider.style.setProperty('--fill', `${v}%`);
    pct.textContent = `${v}%`;
  };
  slider.addEventListener('input', () => {
    amb.setVolume(Number(slider.value) / 100);
    paint();
  });
  const el = h(
    'div.modal.ambience',
    { role: 'dialog', 'aria-label': 'Thinking spot' },
    h('header', {}, h('h2', {}, '🎧 Thinking spot'), close),
    h('div.body', {}, h('div.scenes', {}, ...buttons), now, h('div.level', {}, off, slider, pct)),
    h('footer', {}, h('span.grow', {}, 'It keeps playing while you wander the roof, and stops when you go back inside.')),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  paint();
  setTimeout(() => (buttons.find((b) => b.classList.contains('on')) ?? buttons[0]).focus(), 30);
}
