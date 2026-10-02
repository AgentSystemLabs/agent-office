import { ROOF, ROOF_NAME } from '../../shared/rooftop';
import { store } from '../state';
import type { Voice } from '../voice';
import { $, h } from './dom';
import { whereabouts } from './whereabouts';
import { L } from '../i18n';

/** What the people list last showed, so it's only drawn again when something in it changed. */
let peopleKey = '';

/** The people list in the sidebar. Click yourself to change your character, or anyone else to walk over to them. */
export function renderPeople(voice: Voice, onEditProfile: () => void, onWalkTo: (id: string) => void, force = true) {
  const peers = [...store.peers.values()].sort((a, b) => (a.id === store.you ? -1 : b.id === store.you ? 1 : a.name.localeCompare(b.name)));
  // What each of them is up to changes as they walk about (onto the balcony, up the stairs).
  const doing = peers.map((p) => (p.id === store.you ? undefined : whereabouts(p, store.carOf(p.id))));
  const key = peers.map((p, i) => `${p.id}|${doing[i] ?? ''}`).join('\n');
  if (!force && key === peopleKey) return;
  peopleKey = key;
  const ul = $('people');
  ul.replaceChildren();
  peers.forEach((p, i) => {
    const you = p.id === store.you;
    const mic = !p.voice ? '' : p.muted ? '🔇' : '🎙️';
    const sub = doing[i];
    const li = h(
      'li',
      { 'data-peer': p.id, class: p.lite && !you ? undefined : 'walk', title: you ? L.hud.changeCharacter : p.lite ? L.hud.onLite(p.name) : `${store.onMyFloor(p) ? L.hud.walkTo(p.name) : L.hud.elevatorTo(p.name)}${sub ? ` (${sub})` : ''}` },
      h('span.dot', { style: `background:${p.color}` }),
      h('span.name', {}, p.name, sub ? h('span.sub', {}, sub) : null),
      p.account ? h('span.acct', { title: you ? L.hud.ownAccountYou : L.hud.ownAccount }, '✓') : null,
      you ? h('span.you', {}, L.hud.you) : null,
      // Somewhere else in the building: which floor.
      !you && !store.onMyFloor(p)
        ? p.floor === ROOF
          ? h('span.where', { title: L.hud.onRoof }, `🍸 ${ROOF_NAME}`)
          : h('span.where', { title: L.hud.otherFloor }, `🛗 ${store.floors.find((f) => f.id === p.floor)?.name ?? L.hud.lobby}`)
        : null,
      p.sharing ? h('span', { title: L.hud.sharing }, '🖥️') : null,
      h('span.mic', {}, mic),
    );
    li.addEventListener('click', () => (you ? onEditProfile() : onWalkTo(p.id)));
    ul.append(li);
  });
  $('people-count').textContent = String(peers.length);
  void voice;
}

export function updateSpeaking(voice: Voice) {
  for (const li of document.querySelectorAll<HTMLElement>('#people li[data-peer]')) {
    const lvl = voice.levelOf(li.dataset.peer!);
    li.classList.toggle('speaking', lvl > 0.04);
  }
}
