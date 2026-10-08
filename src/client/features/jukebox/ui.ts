import './ui.css';
import { STREAM } from '../../../shared/jukebox';
import { recitationPlayer } from './video';
import { QURAN_SITE, RECITATION_VIDEOS, videoName, SURAHS, surahOf, surahUrl } from './quran';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';

/** The lounge's Quran player: Quran.com's recitation of any surah, for everyone on the floor. */
export function openJukebox(net: Net, openVolume: () => void) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const now = h('div.jb-now');
  const list = h('ul.svc-list');
  const find = h('input', {
    type: 'text',
    placeholder: 'Find a surah…',
    'aria-label': 'Find a surah',
    spellcheck: 'false',
    autocomplete: 'off',
  }) as HTMLInputElement;
  const site = h('a.btn', { href: QURAN_SITE, target: '_blank', rel: 'noopener' }, '📖 Open Quran.com');
  const watch = h('button.btn', { type: 'button' }, '▶️ Watch recitations');
  const video = h('div.jb-video');
  const volume = h('button.btn', { type: 'button' }, '🔈 Your volume');
  const el = h(
    'div.modal.jukebox',
    { role: 'dialog', 'aria-label': 'Quran' },
    h('header', {}, h('h2', {}, '📖 Quran'), close),
    h(
      'div.body',
      {},
      now,
      video,
      h('label', { style: 'margin-top:16px' }, 'Choose a surah'),
      find,
      list,
      h('p.setting-note', {}, 'Recitation by Mishari Alafasy, from Quran.com.'),
    ),
    h('footer', {}, h('span.grow', {}, 'Everyone on this floor hears the same recitation, louder the closer they are to the lounge.'), watch, site, volume),
  );

  const button = (label: string, title: string, send: () => void, primary = false) =>
    h(primary ? 'button.btn.primary' : 'button.btn', { type: 'button', title, onclick: send }, label);

  const render = () => {
    const j = store.jukebox;
    const cur = j.track === STREAM ? surahOf(j.url) : 0;
    const name = cur ? `${cur}. ${SURAHS[cur - 1]}` : 'Nothing playing';
    now.replaceChildren(
      h('span.jb-disc', { class: j.on && cur ? 'spin' : '' }, '📖'),
      h(
        'div.svc-main',
        {},
        h('div.svc-title', {}, j.on ? name : 'The Quran player is off'),
        h('div.svc-meta', {}, j.on && j.by ? `put on by ${j.by}` : 'Pick a surah to play it'),
      ),
      j.on ? button('⏹️ Stop', 'Stop the recitation', () => net.send({ t: 'jukebox.stop' })) : '',
    );
    const q = find.value.trim().toLowerCase();
    list.replaceChildren(
      ...SURAHS.map((title, i) => ({ title, n: i + 1 }))
        .filter(({ title, n }) => !q || title.toLowerCase().includes(q) || String(n) === q)
        .map(({ title, n }) => {
          const playing = j.on && cur === n;
          const li = h(
            'li',
            {
              class: playing ? 'on' : '',
              tabindex: 0,
              role: 'button',
              'aria-pressed': String(playing),
              title: playing ? 'Playing now' : `Play ${title}`,
            },
            h('span.jb-icon', {}, playing ? '🔊' : String(n)),
            h('div.svc-main', {}, h('div.svc-title', {}, title)),
          );
          const pick = () => {
            if (!playing) net.send({ t: 'jukebox.play', url: surahUrl(n) });
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
  find.addEventListener('input', render);
  // The recitation videos: a list, one video at a time, each with its own A-B repeat.
  let vp: ReturnType<typeof recitationPlayer> | null = null;
  const closeVideos = () => {
    vp?.destroy();
    vp = null;
    video.replaceChildren();
  };
  const playVideo = (id: string, title: string) => {
    vp?.destroy();
    vp = recitationPlayer(id);
    const back = h('button.btn', { type: 'button', onclick: showVideos }, '⬅️ All videos');
    video.replaceChildren(h('div.jb-vhead', {}, back, h('b', { dir: 'rtl' }, videoName(title))), vp.el);
  };
  const showVideos = () => {
    vp?.destroy();
    vp = null;
    const items = RECITATION_VIDEOS.map((r, i) => {
      const li = h(
        'li',
        { tabindex: 0, role: 'button', title: r.title },
        h('span.jb-icon', {}, String(i + 1)),
        h('div.svc-main', {}, h('div.svc-title', { dir: 'rtl' }, videoName(r.title))),
      );
      const pick = () => playVideo(r.id, r.title);
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
      return li;
    });
    video.replaceChildren(
      h('div.jb-vhead', {}, h('b', {}, '▶️ Recitation videos'), h('button.btn', { type: 'button', onclick: closeVideos }, '✕ Close')),
      h('ul.svc-list.jb-vlist', {}, ...items),
    );
  };
  watch.addEventListener('click', () => {
    if (video.firstChild) return closeVideos();
    net.send({ t: 'jukebox.stop' });
    showVideos();
  });

  const off = store.on('jukebox', render);
  const modal = openModal(el, {
    doing: '📖 listening to the Quran',
    onClose: () => {
      closeVideos();
      off();
    },
  });
  close.addEventListener('click', () => modal.close());
  volume.addEventListener('click', () => {
    modal.close();
    openVolume();
  });
  render();
}
