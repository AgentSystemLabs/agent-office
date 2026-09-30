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
 * `share` offers the screen share the TV still shows in front of a link.
 */
export function openTv(net: Net, tvScreen: TvScreen, share: () => void) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const now = h('div.tv-now');
  const scrub = h('input', { type: 'range', min: '0', max: '60', step: '0.5', value: '0', 'aria-label': 'Where the video is' }) as HTMLInputElement;
  const time = h('span.tv-time', {}, '0:00');
  const open = h('a.tv-open', { target: '_blank', rel: 'noopener noreferrer' }, 'Open in a tab ↗');
  const url = h('input', { type: 'text', placeholder: 'https://… a YouTube link, an .mp4, anything with a player', 'aria-label': 'Video link', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const putOn = h('button.btn.primary', { type: 'button' }, '📺 Play');
  const mute = h('button.btn', { type: 'button' }, '🔊 Your sound');
  const el = h(
    'div.modal.tv',
    { role: 'dialog', 'aria-label': 'Office TV' },
    h('header', {}, h('h2', {}, '📺 Office TV'), close),
    h(
      'div.body',
      {},
      now,
      h('div.volume.tv-scrub', {}, scrub, time, open),
      h('label', { style: 'margin-top:16px' }, 'Put something on'),
      h('div.webhook', {}, url, putOn),
      h('p.setting-note', {}, 'Everyone on this floor sees it at the same moment. YouTube, a direct .mp4, or any site that lets itself be framed.'),
    ),
    h('footer', {}, h('span.grow', {}, 'It plays on the TV itself, for everyone on this floor.'), h('button.btn', { type: 'button', onclick: share }, '🖥️ Share screen'), mute),
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
    tick();
  };

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

  const muteLabel = () => (mute.textContent = tvScreen.muted ? '🔇 Your sound' : '🔊 Your sound');
  mute.addEventListener('click', () => {
    if (!tvScreen.toggleMute()) toast('This player’s sound isn’t yours to turn down', 'warn');
    muteLabel();
  });
  tvScreen.onMute = muteLabel;

  const timer = setInterval(tick, 250);
  const off = store.on('tv', render);
  const modal = openModal(el, {
    doing: '📺 at the TV',
    onClose: () => {
      clearInterval(timer);
      off();
      tvScreen.onMute = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  muteLabel();
}
