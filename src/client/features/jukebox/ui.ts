import './ui.css';
import { JUKEBOX_TUNES, STREAM, checkStreamUrl, trackTitle, tuneById } from '../../../shared/jukebox';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';
import { L } from '../../i18n';

/** A tune's mood in the page's language (shared/jukebox.ts names it in English). */
function moodOf(track: string): string | undefined {
  return L.jukebox.moods[track] ?? tuneById(track)?.mood;
}

/** The jukebox: what's on, the tunes to pick from, skip and stop, and a box for a stream. */
export function openJukebox(net: Net, openVolume: () => void) {
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const now = h('div.jb-now');
  const list = h('ul.svc-list');
  const url = h('input', { type: 'text', placeholder: L.jukebox.urlPlaceholder, 'aria-label': L.jukebox.urlLabel, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const playUrl = h('button.btn.primary', { type: 'button' }, L.jukebox.playUrl);
  const volume = h('button.btn', { type: 'button' }, L.jukebox.volume);
  const el = h(
    'div.modal.jukebox',
    { role: 'dialog', 'aria-label': 'Jukebox' },
    h('header', {}, h('h2', {}, '🎵 Jukebox'), close),
    h(
      'div.body',
      {},
      now,
      h('label', { style: 'margin-top:16px' }, L.jukebox.putTune),
      list,
      h('label', { style: 'margin-top:16px' }, L.jukebox.orStream),
      h('div.webhook', {}, url, playUrl),
      h('p.setting-note', {}, L.jukebox.streamNote),
    ),
    h('footer', {}, h('span.grow', {}, L.jukebox.foot), volume),
  );

  const button = (label: string, title: string, send: () => void, primary = false) => h(primary ? 'button.btn.primary' : 'button.btn', { type: 'button', title, onclick: send }, label);

  const render = () => {
    const j = store.jukebox;
    const stream = j.track === STREAM;
    now.replaceChildren(
      h('span.jb-disc', { class: j.on ? 'spin' : '' }, stream ? '📻' : '💿'),
      h(
        'div.svc-main',
        {},
        h('div.svc-title', {}, j.on ? trackTitle(j, L) : L.jukebox.off),
        h('div.svc-meta', {}, j.on ? [stream ? L.jukebox.aStream : moodOf(j.track), j.by && L.jukebox.putOnBy(j.by)].filter(Boolean).join(' · ') : j.by ? L.jukebox.turnedOff(j.by) : L.jukebox.pick),
      ),
      j.on ? button(L.jukebox.skip, L.jukebox.skipTip, () => net.send({ t: 'jukebox.skip' })) : button(L.jukebox.play, L.jukebox.playTip(trackTitle(j, L)), () => net.send({ t: 'jukebox.play' }), true),
      j.on ? button(L.jukebox.stop, L.jukebox.stopTip, () => net.send({ t: 'jukebox.stop' })) : '',
    );
    list.replaceChildren(
      ...JUKEBOX_TUNES.map((t) => {
        const playing = j.on && j.track === t.id;
        const li = h(
          'li',
          { class: playing ? 'on' : '', tabindex: 0, role: 'button', 'aria-pressed': String(playing), title: playing ? L.jukebox.playingNow : L.jukebox.putOn(t.title) },
          h('span.jb-icon', {}, playing ? '🔊' : '🎵'),
          h('div.svc-main', {}, h('div.svc-title', {}, t.title), h('div.svc-meta', {}, t.mood)),
        );
        const pick = () => {
          if (!playing) net.send({ t: 'jukebox.play', track: t.id });
        };
        li.addEventListener('click', pick);
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        });
        return li;
      }),
    );
  };

  const play = () => {
    const u = checkStreamUrl(url.value);
    if ('error' in u) {
      toast(u.error, 'warn');
      return url.focus();
    }
    net.send({ t: 'jukebox.play', url: u.url });
    url.value = '';
  };
  playUrl.addEventListener('click', play);
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') play();
  });

  const modal = openModal(el, { doing: L.jukebox.doing, onClose: store.on('jukebox', render) });
  close.addEventListener('click', () => modal.close());
  volume.addEventListener('click', () => {
    modal.close();
    openVolume();
  });
  render();
}
