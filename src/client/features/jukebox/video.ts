import { h } from '../../ui/dom';

/** The slice of the YouTube IFrame API used here. */
interface YTPlayer {
  getCurrentTime(): number;
  seekTo(s: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  destroy(): void;
}
interface YTApi {
  Player: new (
    el: HTMLElement,
    opts: {
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: { onReady: () => void };
    },
  ) => YTPlayer;
}

let apiReady: Promise<YTApi> | null = null;
function loadApi(): Promise<YTApi> {
  const w = window as unknown as {
    YT?: YTApi;
    onYouTubeIframeAPIReady?: () => void;
  };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  return (apiReady ??= new Promise((resolve) => {
    w.onYouTubeIframeAPIReady = () => resolve(w.YT!);
    document.head.append(h('script', { src: 'https://www.youtube.com/iframe_api' }));
  }));
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A recitation player with an A–B repeat: set a start and an end, and it plays that part nonstop. */
export function recitationPlayer(videoId: string) {
  const root = h('div.jb-video');
  const screen = h('div.jb-screen');
  const a = h('button.btn', { type: 'button', title: 'Mark where the repeat starts' }, '🅰️ Set A');
  const b = h('button.btn', { type: 'button', title: 'Mark where the repeat ends' }, '🅱️ Set B');
  const loop = h('button.btn', { type: 'button', title: 'Repeat from A to B nonstop' }, '🔁 Loop off');
  const clear = h('button.btn', { type: 'button', title: 'Forget A and B' }, '✖ Clear');
  const info = h('span.setting-note', {}, 'Set A and B while it plays, then turn the loop on.');
  root.append(screen, h('div.jb-ab', {}, a, b, loop, clear, info));

  let player: YTPlayer | null = null;
  let pa: number | null = null;
  let pb: number | null = null;
  let looping = false;
  let timer = 0;

  const show = () => {
    a.textContent = pa === null ? '🅰️ Set A' : `🅰️ A ${clock(pa)}`;
    b.textContent = pb === null ? '🅱️ Set B' : `🅱️ B ${clock(pb)}`;
    loop.textContent = looping ? '🔁 Loop on' : '🔁 Loop off';
    loop.classList.toggle('primary', looping);
  };
  a.addEventListener('click', () => {
    if (!player) return;
    pa = player.getCurrentTime();
    if (pb !== null && pb <= pa) pb = null;
    show();
  });
  b.addEventListener('click', () => {
    if (!player) return;
    const t = player.getCurrentTime();
    if (pa === null || t <= pa) {
      info.textContent = 'Set A first, then B a little later.';
      return;
    }
    pb = t;
    info.textContent = 'Turn the loop on to repeat it.';
    show();
  });
  loop.addEventListener('click', () => {
    if (pa === null || pb === null) {
      info.textContent = 'Set both A and B first.';
      return;
    }
    looping = !looping;
    if (looping) player?.seekTo(pa, true);
    show();
  });
  clear.addEventListener('click', () => {
    pa = pb = null;
    looping = false;
    show();
  });

  void loadApi().then((YT) => {
    if (!root.isConnected && !root.parentElement) return;
    const target = h('div');
    screen.append(target);
    player = new YT.Player(target, {
      width: '100%',
      height: '100%',
      playerVars: {
        listType: 'playlist',
        rel: 0,
        playsinline: 1,
        enablejsapi: 1,
      },
      events: { onReady: () => {} },
    });
    timer = window.setInterval(() => {
      if (looping && player && pa !== null && pb !== null && player.getCurrentTime() >= pb) player.seekTo(pa, true);
    }, 200);
  });
  show();

  return {
    el: root,
    destroy() {
      window.clearInterval(timer);
      player?.destroy();
      player = null;
    },
  };
}
