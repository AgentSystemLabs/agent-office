/**
 * Voice and screen sharing: V to join voice (then push to talk), M to mute, sharing your screen, the
 * shared screens' thumbnails, watching one full screen, and which of them is up on the office TV.
 */
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { $, h, openModal, toast } from '../../ui/dom';

export interface VoiceDeps {
  /** The office TV, which shows a screen someone's sharing (see features/tv). */
  tv: { show(stream: MediaStream | null): void };
}

/** Registers V and M, voice's messages, and listens for V coming up (captured) and the window losing focus. */
export function installVoice(ctx: Ctx, deps: VoiceDeps) {
  const { voice } = ctx;

  async function toggleVoice() {
    if (voice.inVoice) voice.leaveVoice();
    else await joinVoice();
  }

  async function joinVoice() {
    const err = await voice.joinVoice(ctx.settings.pushToTalk);
    if (err) toast(err, 'warn');
    else if (ctx.settings.pushToTalk && voice.inVoice) toast('🎙️ In voice, muted: hold V to talk');
  }
  ctx.keys.bind({
    code: 'KeyV',
    // Joins voice; in it, it's push to talk (let go and you're muted, see the keyup below).
    repeat: false,
    run: () => {
      if (voice.inVoice) voice.startTalking();
      else void joinVoice();
    },
  });
  // Letting go of V mutes you again, wherever the key comes up: a window or a terminal opened meanwhile,
  // or another app (the browser never says the key came up there).
  window.addEventListener('keyup', (e) => e.code === 'KeyV' && voice.stopTalking(), true);
  window.addEventListener('blur', () => voice.stopTalking());
  ctx.keys.bind({
    code: 'KeyM',
    run: () => {
      voice.toggleMute();
    },
  });

  async function toggleShare() {
    if (voice.sharing) voice.stopShare();
    else {
      const err = await voice.startShare();
      if (err) toast(err, 'warn');
    }
  }

  function currentShares(): [string, MediaStream][] {
    const out: [string, MediaStream][] = [];
    const local = voice.localScreen;
    if (local) out.push(['You', local]);
    for (const [id, s] of voice.remoteScreens()) {
      const peer = store.peers.get(id);
      // A screen shared on another floor is on that floor's TV.
      if (peer && !store.onMyFloor(peer)) continue;
      out.push([peer?.name ?? 'Someone', s]);
    }
    return out;
  }

  function refreshShares() {
    const shares = currentShares();
    // Remote shares win the TV; your own share is what others see anyway.
    const pick = shares.find(([who]) => who !== 'You') ?? shares[0];
    const stream = pick?.[1] ?? null;
    deps.tv.show(stream);
    const box = $('shares');
    box.replaceChildren(
      ...shares
        .filter(([who]) => who !== 'You')
        .map(([who, s]) => {
          const v = h('video', { autoplay: true, playsinline: true, muted: true }) as HTMLVideoElement;
          v.srcObject = s;
          return h('div.share-thumb', { onclick: () => watchShare(), title: 'Watch full screen' }, v, h('span.who', {}, `🖥️ ${who}`));
        }),
    );
    ctx.hint.invalidate();
  }

  /** Someone's shared screen, full screen: someone else's before your own. With nobody sharing, you share yours. */
  function watchShare() {
    const streams = currentShares();
    if (!streams.length) {
      void toggleShare();
      return;
    }
    const video = h('video', { autoplay: true, playsinline: true, muted: true }) as HTMLVideoElement;
    // What's on the TV: someone else's screen before your own.
    const [who, stream] = streams.find(([name]) => name !== 'You') ?? streams[0];
    video.srcObject = stream;
    const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
    const el = h('div.modal.viewer', { role: 'dialog', 'aria-label': 'Screen share' }, h('header', {}, h('h2', {}, `🖥️ ${who}'s screen`), close), video);
    const modal = openModal(el, { doing: `🖥️ watching ${who}'s screen`, onClose: () => (video.srcObject = null) });
    close.addEventListener('click', () => modal.close());
  }

  voice.onChange(() => {
    ctx.hud.refresh();
    refreshShares();
  });
  ctx.messages.on('peer.join', () => voice.syncPeers());
  ctx.messages.on('peer.leave', () => voice.syncPeers());
  ctx.messages.on('rtc', (msg) => void voice.handleSignal(msg.from, msg.data as never));

  return { toggleVoice, toggleShare, currentShares, refreshShares, watchShare };
}
