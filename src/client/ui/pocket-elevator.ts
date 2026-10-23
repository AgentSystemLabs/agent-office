import { floorPalette } from '../../shared/floors';
import { pocketFloorId, type PocketFloor } from '../shared/pocket/floors';
import { listPocketFloors, switchPocketFloor } from '../shared/pocket/native';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';

let current: Modal | null = null;
export function pocketElevatorOpen(): boolean { return !!current; }

/** The original elevator appearance, with authorized root chats instead of repository actions. */
export function openPocketElevator(): void {
  if (current) return;
  let closed = false;
  let loading = false;
  let switching = false;
  let floors: PocketFloor[] = [];
  const list = h('div.floors');
  const status = h('p.note', { role: 'status', 'aria-live': 'polite' }, 'Loading chat floors…');
  const search = h('input', { type: 'search', placeholder: 'Search chat titles', 'aria-label': 'Search chat floors' });
  const refresh = h('button.btn', { type: 'button' }, '↻ Refresh');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');

  const render = () => {
    const query = search.value.trim().toLocaleLowerCase();
    list.replaceChildren(...floors.filter(f => f.title.toLocaleLowerCase().includes(query)).map((f) => {
      const here = store.floor === pocketFloorId(f.id);
      const row = h('button.floor-btn', {
        type: 'button', class: here ? 'here' : '', disabled: here || switching,
        title: here ? 'You are on this chat floor' : `Ride to ${f.title}`,
      },
      h('span.floor-no', { style: `background:${floorPalette(f.id).trim}` }, String(floors.indexOf(f) + 1)),
      h('span.floor-text', {},
        h('span.floor-name', { style: 'white-space:normal;overflow:visible;text-overflow:clip' }, f.title,
          here ? h('span.here-tag', {}, 'you are here') : null),
        h('span.floor-sub', {}, f.cwd)),
      h('span.floor-stats', {}, f.busy ? h('span', { title: 'Root chat is busy' }, 'Working') : ''));
      row.addEventListener('click', () => {
        if (here || switching) return;
        switching = true;
        status.textContent = `Opening ${f.title}…`;
        render();
        void switchPocketFloor(f.id).then(() => {
          // A successful switch replaces the iframe, not the scene inside this old iframe.
          if (!closed) modal.close();
        }).catch(error => {
          if (closed) return;
          switching = false;
          status.textContent = error instanceof Error ? error.message : String(error);
          render();
        });
      });
      return row;
    }).reverse());
    if (!list.children.length && !loading) list.append(h('p.empty', {}, floors.length ? 'No chat titles match.' : 'No root chat floors are available.'));
    refresh.disabled = loading || switching;
    search.disabled = switching;
  };
  const load = async () => {
    if (loading || switching) return;
    loading = true;
    status.textContent = 'Loading chat floors…';
    render();
    try {
      const next = await listPocketFloors();
      if (closed) return;
      floors = next;
      status.textContent = 'Each floor is a Pocket root chat. Workers stay on their own floor.';
    } catch (error) {
      if (!closed) status.textContent = error instanceof Error ? error.message : String(error);
    } finally { loading = false; if (!closed) render(); }
  };
  const el = h('div.modal.elevator', { role: 'dialog', 'aria-label': 'Elevator' },
    h('header', {}, h('h2', {}, '🛗 Elevator'), close),
    h('div.body', {}, h('div.repo-search', {}, search, refresh), status, list),
    h('footer', {}, h('span.grow', {}, 'Pick a chat floor · Esc to stay here')));
  const modal = openModal(el, { doing: '🛗 at the elevator', onClose: () => { closed = true; current = null; } });
  current = modal;
  close.addEventListener('click', () => modal.close());
  refresh.addEventListener('click', () => { void load(); });
  search.addEventListener('input', render);
  void load();
}
