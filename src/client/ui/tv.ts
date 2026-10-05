import { checkTvUrl, positionAt, tvTitle } from '../../shared/tv';
import type { Net } from '../net';
import { store } from '../state';
import type { TvScreen } from '../tvscreen';
import { h, openModal, toast } from './dom';

/** Seconds into the video, as `12:34` or `1:02:03` once it's past the hour. */
function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const hours = Math.floor(t / 3600);
  const mins = Math.floor(t / 60) % 60;
  const secs = t % 60;
  return hours ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * The TV window: what's on it, play and pause, a scrubber everyone follows, the box to paste a
 * link into, and your own speakers — the picture itself is on the TV (see client/tvscreen.ts).
 * `share` offers the screen share the TV still shows in front of a link. `dance` is the dance
 * floor in front of the TV (see world/disco.ts): this window is where it's put out or brought back.
 */
export function openTv(net: Net, tvScreen: TvScreen, share: () => void, dance: { on(): boolean; set(on: boolean): void }) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const now = h('div.tv-now');
  const scrub = h('input', { type: 'range', min: '0', max: '60', step: '0.5', value: '0', 'aria-label': 'Where the video is' }) as HTMLInputElement;
  const time = h('span.tv-time', {}, '0:00');
  const open = h('a.tv-open', { target: '_blank', rel: 'noopener noreferrer' }, 'Open in a tab ↗');
  const url = h('input', { type: 'text', placeholder: 'https://… a YouTube link, an .mp4, anything with a player', 'aria-label': 'Video link', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const putOn = h('button.btn.primary', { type: 'button' }, '📺 Play');
  // Your own speakers, apart from everyone else's: the same row the ⚙️ Settings give the jukebox.
  const mute = h('button.btn', { type: 'button' });
  const level = h('input', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'TV volume' }) as HTMLInputElement;
  const pct = h('span.vol-pct');
  const sound = h('div.volume', {}, mute, level, pct);
  // The room, not your own: the switch on the wall by the TV, which everyone on the floor shares.
  const theatre = h('button.btn', { type: 'button' });

  // The dance floor with disco lights in front of the TV (see world/disco.ts). Each browser keeps
  // its own choice; this window is where it's put away or brought back.
  const danceRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Dance floor' });
  const danceNote = h('p.setting-note', {}, 'A lit dance floor and disco lights on the floor right in front of the TV. It’s yours to put away or bring back, and each person keeps their own choice (⚙️ Settings has the same switch).');
  const paintDance = () => {
    danceRow.replaceChildren(
      ...(
        [
          [true, '🪩 On'],
          [false, 'Off'],
        ] as const
      ).map(([on, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(dance.on() === on),
            class: dance.on() === on ? 'on' : '',
            onclick: () => {
              if (dance.on() === on) return;
              dance.set(on);
              paintDance();
            },
          },
          label,
        ),
      ),
    );
  };
  paintDance();

  const el = h(
    'div.modal.tv',
    { role: 'dialog', 'aria-label': 'Office TV' },
    h('header', {}, h('h2', {}, '📺 Office TV'), close),
    h(
      'div.body',
      {},
      now,
      h('div.volume.tv-scrub', {}, scrub, time, open),
      h('label', { style: 'margin-top:16px' }, 'The room'),
      h('div.volume', {}, theatre, h('span.setting-note', {}, "The switch by the TV: the office's own light goes down, and the picture stands out in the dark.")),
      h('label', { style: 'margin-top:16px' }, 'Your sound'),
      sound,
      h('label', { style: 'margin-top:16px' }, 'Put something on'),
      h('div.webhook', {}, url, putOn),
      h('p.setting-note', {}, 'Everyone on this floor sees it at the same moment; the sound is yours alone (⚙️ Settings has it too). YouTube, a direct .mp4, or any site that lets itself be framed.'),
      h('label', { style: 'margin-top:16px' }, 'Dance floor'),
      danceRow,
      danceNote,
    ),
    h('footer', {}, h('span.grow', {}, 'It plays on the TV itself, for everyone on this floor.'), h('button.btn', { type: 'button', onclick: share }, '🖥️ Share screen')),
  );

  const button = (label: string, title: string, send: () => void, primary = false) => h(primary ? 'button.btn.primary' : 'button.btn', { type: 'button', title, onclick: send }, label);

  /** The scrubber's own fill, which its track is drawn from (see .volume in style.css). */
  const fill = () => {
    const max = Number(scrub.max) || 1;
    scrub.style.setProperty('--fill', `${Math.min(100, (Number(scrub.value) / max) * 100)}%`);
  };

  /** Where the floor says it is, without disturbing a scrubber someone has hold of. */
  const tick = () => {
    const s = store.tv;
    const pos = s.on ? positionAt(s, store.officeNow()) : 0;
    const dur = tvScreen.duration();
    const max = dur > 0 ? dur : Math.max(60, Math.ceil(pos + 600));
    if (document.activeElement !== scrub) {
      scrub.max = String(max);
      scrub.value = String(Math.min(pos, max));
      fill();
    }
    time.textContent = dur > 0 ? `${clock(pos)} / ${clock(dur)}` : clock(pos);
    // The autoplay fallback can turn the sound down on its own, so this follows the player.
    paintSound();
  };

  /** What this window last put in the link box, so a link someone else puts on doesn't eat yours. */
  let boxed = '';

  const render = () => {
    const s = store.tv;
    const on = s.on && !!s.url;
    now.replaceChildren(
      h('span.jb-disc', {}, on ? (s.playing ? '▶️' : '⏸️') : '📺'),
      h(
        'div.svc-main',
        {},
        h('div.svc-title', {}, on ? tvTitle(s.url) : 'The TV is off'),
        h('div.svc-meta', {}, on ? [s.playing ? 'playing' : 'paused', s.by && `put on by ${s.by}`].filter(Boolean).join(' · ') : s.by ? `${s.by} turned it off` : 'Paste a link below to put something on'),
      ),
      on ? button(s.playing ? '⏸️ Pause' : '▶️ Play', s.playing ? 'Stop it where it is' : 'Carry on from there', () => net.send(s.playing ? { t: 'tv.pause' } : { t: 'tv.play' }), true) : s.url ? button('▶️ Play', `Put ${tvTitle(s.url)} back on`, () => net.send({ t: 'tv.play' }), true) : '',
      on ? button('⏹️ Stop', 'Turn the TV off', () => net.send({ t: 'tv.stop' })) : '',
    );
    if (s.url) open.href = s.url;
    open.style.display = s.url ? '' : 'none';
    if (url.value === boxed) {
      boxed = s.url ?? '';
      url.value = boxed;
    }
    theatre.textContent = s.theatre ? '💡 Lights back up' : '🎬 Lights down';
    theatre.title = s.theatre ? "Put the office's lights back on" : "Take the office's light down, so the picture stands out";
    theatre.setAttribute('aria-pressed', String(s.theatre));
    theatre.classList.toggle('primary', s.theatre);
    tick();
  };
  theatre.addEventListener('click', () => net.send({ t: 'tv.theatre', on: !store.tv.theatre }));

  const putOnUrl = () => {
    const found = checkTvUrl(url.value, window.location.origin);
    if ('error' in found) {
      toast(found.error, 'warn');
      return url.focus();
    }
    net.send({ t: 'tv.play', url: found.url });
    url.value = boxed = found.url;
  };
  putOn.addEventListener('click', putOnUrl);
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') putOnUrl();
  });

  scrub.addEventListener('input', () => {
    time.textContent = clock(Number(scrub.value));
    fill();
  });
  scrub.addEventListener('change', () => {
    if (store.tv.on) net.send({ t: 'tv.seek', position: Math.round(Number(scrub.value) * 10) / 10 });
  });

  /** The sound row, as it is on the player right now (see ⚙️ Settings' volume rows). */
  const paintSound = () => {
    const v = Math.round(tvScreen.volume * 100);
    level.value = String(v);
    level.style.setProperty('--fill', `${v}%`);
    pct.textContent = tvScreen.muted ? 'Muted' : `${v}%`;
    mute.textContent = tvScreen.muted ? '🔊 Unmute' : '🔇 Mute';
    mute.setAttribute('aria-pressed', String(tvScreen.muted));
    mute.classList.toggle('danger', tvScreen.muted);
    sound.classList.toggle('muted', tvScreen.muted);
  };
  const cantTake = () => toast('This player’s sound isn’t yours to turn down', 'warn');
  level.addEventListener('input', () => {
    // Dragging it turns the sound back on, like the ⚙️ sliders do.
    if (!tvScreen.setVolume(Number(level.value) / 100, false)) cantTake();
    paintSound();
  });
  mute.addEventListener('click', () => {
    if (!tvScreen.toggleMute()) cantTake();
    paintSound();
  });

  const timer = setInterval(tick, 250);
  const off = store.on('tv', render);
  const modal = openModal(el, {
    doing: '📺 at the TV',
    onClose: () => {
      clearInterval(timer);
      off();
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
}
