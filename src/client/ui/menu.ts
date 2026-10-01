import './menu.css';
import { store, type HudPanel, type Settings, type Topic } from '../state';
import { waitingOnSomeone } from '../notify';
import { DESK_BY_ID } from '../../shared/layout';
import { $, h, openModal, type Modal } from './dom';

/** One thing the ☰ menu does. Any of them can be pinned to the top bar. */
export interface HudAction {
  /** Pins are saved by it, so it never changes. */
  id: string;
  icon: string | (() => string);
  label: string | (() => string);
  section: 'Open' | 'Together' | 'Office';
  /** Its keyboard shortcut, if it has one (now). */
  key?: string | (() => string | undefined);
  /** A number worth knowing before you open it: open issues, tasks waiting… */
  count?: () => number;
  /** Pressed, like voice while you're in it. */
  on?: () => boolean;
  /** Stands out: an update to install, a muted mic. */
  tone?: () => 'primary' | 'danger' | undefined;
  /** Only offered some of the time (Invite, Accounts, Upgrade). */
  shown?: () => boolean;
  /** Up on the top bar by itself while true, pinned or not: you're sharing your screen, an update is out. */
  status?: () => boolean;
  /** Its words on the top bar while `status` put it there; a pinned one is just its icon. */
  chip?: () => string;
  /** Why it can't work here: it's greyed out and says so. */
  blocked?: () => string | undefined;
  title?: () => string;
  run: () => void;
}

const PANELS: { id: HudPanel; icon: string; label: string; what: string }[] = [
  { id: 'workers', icon: '🤖', label: 'Workers', what: 'Every desk and what it’s up to' },
  { id: 'people', icon: '👥', label: 'People', what: 'Who’s here, on which floor' },
  { id: 'spend', icon: '💸', label: 'Spend', what: 'Today, the budget, all time' },
  { id: 'limits', icon: '⏳', label: 'Claude limits', what: 'The plan’s 5-hour and week' },
  { id: 'chat', icon: '💬', label: 'Chat', what: 'T opens it either way' },
  { id: 'floor', icon: '🏢', label: 'Floor details', what: 'Branch, folder, default agent' },
];

/** The element each panel is. */
const PANEL_EL: Record<HudPanel, string> = { workers: 'workers-panel', people: 'people-panel', spend: 'spend', limits: 'limits', chat: 'chat', floor: 'project-meta' };

const PIN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5a3 3 0 0 1-3 3v2h5.97v7l1 1 1-1v-7H19v-2a3 3 0 0 1-3-3z"/></svg>';

/** The ✕ in a panel's heading, which hides it until you turn it back on from the ☰ menu. */
export function panelHide(id: HudPanel): HTMLElement {
  return h('button.panel-x', { type: 'button', 'data-hud': id, 'aria-label': 'Hide', title: 'Hide (☰ brings it back)' }, '✕');
}

export interface Hud {
  /** Redraws the top bar for a change the store doesn't announce (voice, hanging a picture). */
  refresh(): void;
  toggleMenu(): void;
}

/**
 * The HUD: the top bar's dock (what you pinned, what needs you now, the workers and the ☰ menu),
 * and the panels you choose to show. Everything else waits in the menu, so the office stays in view.
 */
export function mountHud(actions: HudAction[], settings: Settings, save: () => void): Hud {
  const dock = $('dock');
  const labelOf = (a: HudAction) => (typeof a.label === 'string' ? a.label : a.label());
  const iconOf = (a: HudAction) => (typeof a.icon === 'string' ? a.icon : a.icon());
  const keyOf = (a: HudAction) => (typeof a.key === 'function' ? a.key() : a.key);
  const classOf = (a: HudAction, blocked?: string) => [a.on?.() && 'on', a.tone?.(), blocked && 'dim'].filter(Boolean).join(' ');
  const offered = (a: HudAction) => a.shown?.() ?? true;
  const pinned = (a: HudAction) => settings.pins.includes(a.id);
  let menu: Modal | null = null;

  const menuBtn = h('button.btn.dock-btn.dock-menu', { type: 'button', 'aria-label': 'Menu', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Menu: everything else, and what shows on screen (Tab)' }, h('span.burger', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  menuBtn.addEventListener('click', () => toggleMenu());

  function applyPanels() {
    for (const p of PANELS) $(PANEL_EL[p.id]).classList.toggle('hud-off', !settings.hud[p.id]);
  }

  function setPanel(id: HudPanel, on: boolean) {
    settings.hud = { ...settings.hud, [id]: on };
    save();
    applyPanels();
    render();
  }

  function togglePin(a: HudAction) {
    settings.pins = pinned(a) ? settings.pins.filter((p) => p !== a.id) : [...settings.pins, a.id];
    save();
    render();
  }

  const badge = (n: number | undefined) => (n ? h('span.svc-count', {}, String(n)) : null);

  /** An action up on the top bar. */
  function dockButton(a: HudAction): HTMLElement {
    const chip = pinned(a) ? '' : a.chip?.();
    const blocked = a.blocked?.();
    return h(
      'button.btn.dock-btn',
      {
        type: 'button',
        class: classOf(a, blocked),
        'aria-label': labelOf(a),
        title: blocked ?? a.title?.() ?? `${labelOf(a)}${keyOf(a) ? ` (${keyOf(a)})` : ''}`,
        onclick: () => a.run(),
      },
      iconOf(a),
      chip ? h('span.lbl', {}, chip) : null,
      badge(a.count?.()),
    );
  }

  /** Shows or hides a panel, with what it's about at a glance. */
  function panelChip(id: HudPanel, icon: string, label: string, n: number, title: string): HTMLElement {
    const on = settings.hud[id];
    return h(
      'button.btn.dock-btn.dock-panel',
      { type: 'button', 'aria-pressed': String(on), title: `${title}${on ? ' · click to hide' : ' · click to show'}`, onclick: () => setPanel(id, !settings.hud[id]) },
      icon,
      h('span.lbl', {}, label),
      n ? h('span.n', {}, String(n)) : null,
    );
  }

  function render() {
    const items: HTMLElement[] = actions.filter((a) => offered(a) && (pinned(a) || a.status?.())).map(dockButton);
    const people = store.peers.size;
    if (people > 1 || settings.hud.people) items.push(panelChip('people', '👥', 'People', people, `${people} in the office`));
    const workers = [...store.workers.values()];
    // Hired onto desks, bean bags and the meeting room's table; the board agents at their kiosks don't count.
    const hired = workers.filter((w) => !DESK_BY_ID.get(w.deskId)?.station).length;
    const waiting = workers.filter(waitingOnSomeone).length;
    const workersTitle = hired || waiting ? `${hired} worker${hired === 1 ? '' : 's'} on this floor${waiting ? `, ${waiting} waiting on someone` : ''}` : 'No workers on this floor yet';
    // Who's waiting has its own button on the bar (the 'waiting' action), so this just counts them.
    items.push(panelChip('workers', '🤖', 'Workers', hired, workersTitle));
    // Redrawn only when it looks different, so a busy worker's updates don't swap a button out from under a click.
    const next = h('div', {}, ...items);
    if (next.innerHTML !== [...dock.children].filter((c) => c !== menuBtn).map((c) => c.outerHTML).join('')) dock.replaceChildren(...items, menuBtn);
    else if (!menuBtn.isConnected) dock.append(menuBtn);
  }

  function toggleMenu() {
    if (menu) menu.close();
    else openMenu();
  }

  function openMenu() {
    const row = (a: HudAction) => {
      const blocked = a.blocked?.();
      const item = h(
        'button.menu-item',
        {
          type: 'button',
          role: 'menuitem',
          class: classOf(a, blocked),
          title: blocked ?? a.title?.(),
          onclick: () => {
            menu?.close();
            a.run();
          },
        },
        h('span.mi-icon', {}, iconOf(a)),
        h('span.mi-label', {}, labelOf(a)),
        badge(a.count?.()),
        keyOf(a) ? h('kbd.mi-key', {}, keyOf(a)!) : null,
      );
      const pin = h('button.menu-pin', { type: 'button' });
      pin.innerHTML = PIN_SVG;
      const paintPin = () => {
        pin.setAttribute('aria-pressed', String(pinned(a)));
        pin.setAttribute('aria-label', `Pin ${labelOf(a)} to the top bar`);
        pin.title = pinned(a) ? 'Unpin from the top bar' : 'Pin to the top bar';
      };
      paintPin();
      pin.addEventListener('click', () => {
        togglePin(a);
        paintPin();
      });
      return h('div.menu-row', {}, item, pin);
    };
    const toggle = (p: (typeof PANELS)[number]) => {
      const item = h(
        'button.menu-item.menu-toggle',
        { type: 'button', role: 'menuitemcheckbox' },
        h('span.mi-icon', {}, p.icon),
        h('span.mi-label', {}, p.label, h('small', {}, p.what)),
        h('span.switch', { 'aria-hidden': 'true' }),
      );
      const paint = () => item.setAttribute('aria-checked', String(settings.hud[p.id]));
      paint();
      item.addEventListener('click', () => {
        setPanel(p.id, !settings.hud[p.id]);
        paint();
      });
      return item;
    };
    const section = (name: string, rows: HTMLElement[]) => (rows.length ? [h('div.menu-sec', {}, name), ...rows] : []);
    const rows = (s: HudAction['section']) => actions.filter((a) => a.section === s && offered(a)).map(row);
    const el = h(
      'div.hud-menu',
      { role: 'menu', 'aria-label': 'Menu' },
      h('div.menu-col', {}, ...section('Open', rows('Open')), ...section('Together', rows('Together'))),
      h('div.menu-col', {}, ...section('Show on screen', PANELS.map(toggle)), ...section('Office', rows('Office'))),
      h('p.menu-foot', {}, 'Pin what you use most to keep it on the top bar. ', h('kbd', {}, 'Tab'), ' opens and closes this menu.'),
    );
    // On the window, so the keys work wherever focus is while the menu is up.
    const onKey = (e: KeyboardEvent) => menuKey(el, e);
    menu = openModal(el, {
      // A dropdown under ☰, which closes it again, like a click anywhere else.
      closeButton: false,
      onClose: () => {
        menu = null;
        menuBtn.setAttribute('aria-expanded', 'false');
        window.removeEventListener('keydown', onKey, true);
      },
    });
    window.addEventListener('keydown', onKey, true);
    menu.backdrop.classList.add('menu-backdrop');
    menuBtn.setAttribute('aria-expanded', 'true');
    // Hangs under the ☰ button.
    const r = menuBtn.getBoundingClientRect();
    el.style.top = `${r.bottom + 8}px`;
    el.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    el.style.maxHeight = `${window.innerHeight - r.bottom - 20}px`;
    el.querySelector<HTMLElement>('.menu-item')?.focus();
  }

  /** Arrows walk the menu, → reaches a row's pin, and Tab closes it like Esc. */
  function menuKey(el: HTMLElement, e: KeyboardEvent) {
    const items = [...el.querySelectorAll<HTMLElement>('.menu-item')];
    const at = document.activeElement as HTMLElement | null;
    const onPin = !!at?.classList.contains('menu-pin');
    const i = items.indexOf((onPin ? at!.previousElementSibling : at) as HTMLElement);
    let next: Element | null | undefined;
    switch (e.key) {
      case 'ArrowDown':
        next = items[(i + 1) % items.length];
        break;
      case 'ArrowUp':
        next = items[(i < 0 ? items.length : i) - 1] ?? items[items.length - 1];
        break;
      case 'Home':
        next = items[0];
        break;
      case 'End':
        next = items[items.length - 1];
        break;
      case 'ArrowRight':
        next = onPin ? null : at?.nextElementSibling;
        break;
      case 'ArrowLeft':
        next = onPin ? at?.previousElementSibling : null;
        break;
      case 'Tab':
        // Not on to the office's own Tab, which would open it again, or past the menu to what's behind it.
        e.preventDefault();
        e.stopPropagation();
        menu?.close();
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (next instanceof HTMLElement) next.focus();
  }

  // A panel's ✕, before the panel's own click (the limits panel reads them again on a click).
  $('hud').addEventListener(
    'click',
    (e) => {
      const x = (e.target as HTMLElement).closest<HTMLElement>('.panel-x');
      if (!x) return;
      e.stopPropagation();
      setPanel(x.dataset.hud as HudPanel, false);
    },
    true,
  );
  for (const t of ['workers', 'peers', 'issues', 'pulls', 'services', 'queue', 'meeting', 'upgrade', 'me', 'floors', 'signins'] as Topic[]) store.on(t, render);
  applyPanels();
  render();
  return { refresh: render, toggleMenu };
}
