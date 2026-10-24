// Making a new series in three steps: what it's about, how it looks and sounds, and where and how
// often it posts. The last step can hire the AI crew for it too, so it starts making videos at once.
// What's picked is kept while the page is open, so going back a step loses nothing.

import { h } from '../ui/dom';
import { PLATFORMS, type Platform, type Series } from './api';
import { FREQUENCIES, NICHES, STYLES, VOICES, styleFor } from './presets';
import type { Page } from './main';

interface Draft {
  step: 1 | 2 | 3;
  niche: string;
  name: string;
  custom: string;
  style: string;
  voice: string;
  tone: string;
  platforms: Platform[];
  perDay: number;
  cta: string;
  hashtags: string;
  hire: boolean;
}

const fresh = (): Draft => ({ step: 1, niche: '', name: '', custom: '', style: STYLES[0].id, voice: VOICES[0].id, tone: '', platforms: ['tiktok', 'youtube'], perDay: 1, cta: '', hashtags: '', hire: true });
let draft = fresh();

const STEPS = ['Pick a niche', 'Make it yours', 'Post it'];

function stepper(at: number): HTMLElement {
  return h('ol.rs-steps', {}, ...STEPS.map((label, i) => h('li', { class: i + 1 < at ? 'done' : i + 1 === at ? 'on' : undefined }, h('span.rs-step-n', {}, i + 1 < at ? '✓' : i + 1), h('span', {}, label))));
}

/** A grid of tiles to pick one of. */
function tiles<T>(items: T[], selected: (t: T) => boolean, pick: (t: T) => void, body: (t: T) => (HTMLElement | string)[], cls = ''): HTMLElement {
  return h(
    `div.rs-tiles${cls}` as 'div',
    { role: 'radiogroup' },
    ...items.map((t) => h('button.rs-tile', { type: 'button', role: 'radio', 'aria-checked': selected(t) ? 'true' : 'false', class: selected(t) ? 'on' : undefined, onclick: () => pick(t) }, ...body(t))),
  );
}

function stepNiche(p: Page, redraw: () => void): HTMLElement[] {
  const custom = draft.niche === 'custom';
  const area = h('textarea.rs-input', { rows: 3, placeholder: 'e.g. short true stories about animals that saved people', 'aria-label': 'Your own niche' });
  area.value = draft.custom;
  area.addEventListener('input', () => (draft.custom = area.value));
  const name = h('input.rs-input', { value: draft.name, placeholder: 'e.g. Dark History Daily', 'aria-label': 'Series name' });
  name.addEventListener('input', () => (draft.name = name.value));
  return [
    h('h2.rs-q', {}, 'What should your videos be about?'),
    h('p.rs-sub', {}, 'Pick one to start: your crew comes up with the stories. You can change everything later.'),
    tiles(
      [...NICHES, { id: 'custom', emoji: '✏️', name: 'Something else' } as (typeof NICHES)[number]],
      (n) => draft.niche === n.id,
      (n) => {
        draft.niche = n.id;
        if (n.id !== 'custom') {
          draft.style = n.style;
          draft.tone = n.tone;
          draft.cta = n.cta;
          draft.hashtags = n.hashtags;
          if (!draft.name || NICHES.some((x) => x.name === draft.name)) draft.name = n.name;
        }
        redraw();
      },
      (n) => [h('span.rs-tile-emoji', {}, n.emoji), h('b', {}, n.name)],
      '.niches',
    ),
    custom ? h('label.rs-field', {}, h('span', {}, 'Describe your niche'), area) : null,
    h('label.rs-field', {}, h('span', {}, 'Series name'), name),
  ].filter(Boolean) as HTMLElement[];
}

function stepLook(redraw: () => void): HTMLElement[] {
  const tone = h('input.rs-input', { value: draft.tone, placeholder: 'calm, low, suspenseful', 'aria-label': 'How it reads' });
  tone.addEventListener('input', () => (draft.tone = tone.value));
  return [
    h('h2.rs-q', {}, 'How should it look?'),
    h('p.rs-sub', {}, 'Every picture in every video is drawn in this style.'),
    tiles(STYLES, (s) => draft.style === s.id, (s) => ((draft.style = s.id), redraw()), (s) => [h('span.rs-swatch', { style: `background:${s.swatch}` }, s.emoji), h('b', {}, s.name)], '.styles'),
    h('h2.rs-q', {}, 'Who tells the story?'),
    tiles(VOICES, (v) => draft.voice === v.id, (v) => ((draft.voice = v.id), redraw()), (v) => [h('span.rs-voice-icon', {}, '🎙️'), h('b', {}, v.name), h('small', {}, v.what)], '.voices'),
    h('label.rs-field', {}, h('span', {}, 'How it’s read (optional)'), tone),
  ];
}

function stepPost(p: Page, redraw: () => void): HTMLElement[] {
  const cta = h('input.rs-input', { value: draft.cta, placeholder: 'Follow for part 2', 'aria-label': 'Call to action' });
  cta.addEventListener('input', () => (draft.cta = cta.value));
  const tags = h('input.rs-input', { value: draft.hashtags, placeholder: 'history mystery truestory', 'aria-label': 'Hashtags' });
  tags.addEventListener('input', () => (draft.hashtags = tags.value));
  const label: Record<Platform, string> = { tiktok: 'TikTok', instagram: 'Instagram Reels', youtube: 'YouTube Shorts' };
  const hire = h('input', { type: 'checkbox', checked: draft.hire });
  hire.addEventListener('change', () => (draft.hire = hire.checked));
  return [
    h('h2.rs-q', {}, 'Where should it post?'),
    tiles(
      PLATFORMS,
      (pl) => draft.platforms.includes(pl),
      (pl) => {
        draft.platforms = draft.platforms.includes(pl) ? draft.platforms.filter((x) => x !== pl) : [...draft.platforms, pl];
        redraw();
      },
      (pl) => [h('span.rs-pf.big', { class: { tiktok: 'tt', instagram: 'ig', youtube: 'yt' }[pl] }, label[pl]), h('small', {}, p.data.connected.includes(pl) ? '✓ Connected' : 'Connect it later')],
      '.platforms',
    ),
    h('h2.rs-q', {}, 'How often?'),
    tiles(FREQUENCIES, (f) => draft.perDay === f.perDay, (f) => ((draft.perDay = f.perDay), redraw()), (f) => [h('b', {}, f.label), h('small', {}, f.what)], '.freq'),
    h('div.rs-two', {}, h('label.rs-field', {}, h('span', {}, 'Call to action'), cta), h('label.rs-field', {}, h('span', {}, 'Hashtags'), tags)),
    h('label.rs-check-row', {}, hire, h('span', {}, h('b', {}, 'Hire the AI crew for it'), h('small', {}, 'A scout, a writer, an editor and an analyst start at desks in the office and get to work right away.'))),
  ];
}

/** Why the step can't go on yet, if it can't. */
function blocked(): string | undefined {
  if (draft.step === 1) {
    if (!draft.niche) return 'Pick a niche';
    if (draft.niche === 'custom' && draft.custom.trim().length < 8) return 'Describe your niche';
    if (!draft.name.trim()) return 'Give it a name';
  }
  if (draft.step === 3 && !draft.platforms.length) return 'Pick at least one place to post';
  return undefined;
}

async function launch(p: Page, btn: HTMLButtonElement) {
  const preset = NICHES.find((n) => n.id === draft.niche);
  btn.disabled = true;
  btn.textContent = 'Launching…';
  const s = await p.act<Series>(
    '/series',
    {
      name: draft.name.trim(),
      niche: preset ? preset.niche : draft.custom.trim(),
      style: styleFor(draft.style).prompt,
      voice: draft.voice,
      tone: draft.tone.trim(),
      platforms: draft.platforms,
      postsPerDay: draft.perDay,
      cta: draft.cta.trim(),
      hashtags: draft.hashtags,
    },
    `🎉 ${draft.name.trim()} is live`,
  );
  if (!s) {
    btn.disabled = false;
    btn.textContent = '🚀 Launch series';
    return;
  }
  if (draft.hire && p.data.floors.length) await p.act('/crew', { series: s.id, floor: p.data.floors[0].id }, 'Your AI crew is getting to work');
  draft = fresh();
  p.go(`/series/${s.id}`);
}

export function createPage(p: Page): HTMLElement {
  const root = h('section.rs-page.rs-create');
  const redraw = () => root.replaceChildren(...body());
  const body = (): HTMLElement[] => {
    const why = blocked();
    const back = h('button.rs-btn.ghost', { type: 'button', onclick: () => ((draft.step = (draft.step - 1) as Draft['step']), redraw()) }, '← Back');
    const next = h('button.rs-btn.primary', { type: 'button', disabled: !!why, title: why }, draft.step === 3 ? '🚀 Launch series' : 'Continue →');
    next.addEventListener('click', () => {
      if (blocked()) return;
      if (draft.step === 3) return void launch(p, next);
      draft.step = (draft.step + 1) as Draft['step'];
      redraw();
      window.scrollTo(0, 0);
    });
    const content = draft.step === 1 ? stepNiche(p, redraw) : draft.step === 2 ? stepLook(redraw) : stepPost(p, redraw);
    return [
      h('header.rs-page-head', {}, h('div', {}, h('h1', {}, 'Create a series'), h('p.rs-sub', {}, `Step ${draft.step} of 3`)), h('a.rs-btn.ghost', { href: '#/', onclick: () => (draft = fresh()) }, 'Cancel')),
      stepper(draft.step),
      h('div.rs-panel', {}, ...content),
      h('footer.rs-wizard-foot', {}, draft.step > 1 ? back : h('span'), h('div.rs-row', {}, why ? h('span.rs-why', {}, why) : null, next)),
    ];
  };
  redraw();
  // Typing changes what's needed to go on: keep the button up to date without drawing the step again.
  root.addEventListener('input', () => {
    const btn = root.querySelector<HTMLButtonElement>('.rs-wizard-foot .primary');
    const why = blocked();
    if (btn) {
      btn.disabled = !!why;
      btn.title = why ?? '';
    }
    const note = root.querySelector('.rs-why');
    if (note) note.textContent = why ?? '';
  });
  return root;
}
