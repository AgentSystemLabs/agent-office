import { LOBBY, LOBBY_DESCRIPTION, floorNumber } from '../../shared/lobby';
import './floormenu.css';
import { cloneLabel, floorPalette } from '../../shared/floors';
import { ROOF, ROOF_NAME } from '../../shared/rooftop';
import type { FloorInfo } from '../../shared/protocol';
import { store } from '../state';
import { h } from './dom';

// The floor list that drops down from the project in the corner: every floor of the building, top
// floor first. Picking one takes you straight there, to the same spot in the office you're standing
// in now (from outside it, into that floor's elevator). Adding a project is still the elevator's job.

export interface FloorMenuOptions {
  /** Go to that floor, staying where you are in the office (from outside it, by elevator). */
  go(floorId: string): void;
  /** Whether you're inside the office, where going to a floor keeps you on the same spot. */
  indoors(): boolean;
  /** Open the elevator's panel, to add a project. */
  elevator(): void;
  /** Up to the rooftop bar, by elevator; null on a map with no roof to go up to. */
  roof: (() => void) | null;
}

let current: { el: HTMLElement; close(): void } | null = null;

export function floorMenuOpen(): boolean {
  return !!current;
}

export function closeFloorMenu() {
  current?.close();
}

/** Opens the floor list under `anchor`, or closes it if it's open. */
export function toggleFloorMenu(anchor: HTMLElement, opts: FloorMenuOptions): void {
  if (current) return current.close();
  const el = h('div.floor-menu.panel', { role: 'menu', 'aria-label': 'Floors' });

  const item = (f: FloorInfo, i: number, here: number) => {
    const isHere = f.id === store.floor;
    const p = floorPalette(f.palette);
    const n = Math.abs(i - here);
    const where = isHere ? 'you are here' : here < 0 ? '' : `${i > here ? '⬆' : '⬇'} ${n} floor${n === 1 ? '' : 's'} ${i > here ? 'up' : 'down'}`;
    const stats: HTMLElement[] = [];
    if (f.cloning) stats.push(h('span', { title: f.clone?.detail ?? 'Being cloned' }, cloneLabel(f.clone)));
    else {
      if (f.waiting) stats.push(h('span.waiting', { title: 'Workers waiting on someone' }, `🙋 ${f.waiting}`));
      if (f.busy) stats.push(h('span', { title: 'Working' }, `👷 ${f.busy}`));
      if (f.id !== LOBBY) stats.push(h('span', { title: 'Workers at desks' }, `💻 ${f.workers}`));
      if (f.people) stats.push(h('span', { title: 'People on this floor' }, `🧑 ${f.people}`));
    }
    const btn = h(
      'button.floor-item',
      { type: 'button', role: 'menuitem', class: isHere ? 'here' : '', disabled: isHere || f.cloning, title: isHere ? "You're on this floor" : f.cloning ? 'Still being cloned' : opts.indoors() ? `Go to ${f.name}, right where you're standing` : `Go to ${f.name}, in its elevator` },
      h('span.floor-no', { style: `background:${p.trim}` }, floorNumber(f, i)),
      h('span.floor-text', {}, h('span.floor-name', {}, f.name), h('span.floor-sub', {}, where || (f.id === LOBBY ? LOBBY_DESCRIPTION : f.repo ?? f.dir))),
      h('span.floor-stats', {}, ...stats),
    );
    btn.addEventListener('click', () => {
      if (isHere || f.cloning) return;
      close();
      opts.go(f.id);
    });
    return btn;
  };

  const render = () => {
    const floors = store.floors;
    const here = floors.findIndex((f) => f.id === store.floor);
    const add = h('button.floor-item.add', { type: 'button', role: 'menuitem', title: 'The elevator: add another project as a floor' }, h('span.floor-no', {}, '🛗'), h('span.floor-text', {}, h('span.floor-name', {}, 'Elevator'), h('span.floor-sub', {}, 'Add a project…')));
    add.addEventListener('click', () => {
      close();
      opts.elevator();
    });
    // Top floor first, the way a building's directory reads, and the roof over them.
    const items = floors.map((f, i) => item(f, i, here)).reverse();
    const onRoof = store.floor === ROOF;
    const people = [...store.peers.values()].filter((p) => p.floor === ROOF).length;
    const roof = h(
      'button.floor-item',
      { type: 'button', role: 'menuitem', class: onRoof ? 'here' : '', disabled: onRoof, title: onRoof ? "You're up on the roof" : 'Take the elevator up to the roof' },
      h('span.floor-no', { style: 'background:#2b2d42' }, '🍸'),
      h('span.floor-text', {}, h('span.floor-name', {}, ROOF_NAME), h('span.floor-sub', {}, onRoof ? 'you are here' : 'A DJ, drinks and the city')),
      h('span.floor-stats', {}, people ? h('span', { title: 'People up there' }, `🧑 ${people}`) : ''),
    );
    roof.addEventListener('click', () => {
      if (onRoof) return;
      close();
      opts.roof?.();
    });
    el.replaceChildren(h('div.floor-menu-head', {}, `🏢 ${floors.length} floor${floors.length === 1 ? '' : 's'}`), ...(floors.length && opts.roof ? [roof] : []), ...items, add);
  };

  const place = () => {
    const r = anchor.getBoundingClientRect();
    el.style.left = `${r.left}px`;
    el.style.top = `${r.bottom + 8}px`;
  };

  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!el.contains(t) && !anchor.contains(t)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const offs = [store.on('floors', render), store.on('floor', render)];
  const close = () => {
    if (current?.el !== el) return;
    current = null;
    el.remove();
    anchor.classList.remove('open');
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    for (const off of offs) off();
  };
  render();
  document.body.append(el);
  place();
  anchor.classList.add('open');
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  current = { el, close };
}
