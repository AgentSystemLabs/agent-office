import { LOBBY, LOBBY_NAME } from '../../shared/lobby';
/** The tab's title, the same in the 3D office and the 2D view (/lite). No three.js here: the 2D view imports it. */
import { waitingOnSomeone } from '../notify';
import { store } from '../state';

/** The tab title counts the workers waiting on someone, on every floor, so you can see them from another tab. */
export function renderTitle() {
  const name = store.floor === LOBBY ? LOBBY_NAME : store.project?.name;
  const elsewhere = store.floors.reduce((n, f) => n + (f.id === store.floor ? 0 : f.waiting), 0);
  const waiting = [...store.workers.values()].filter(waitingOnSomeone).length + elsewhere;
  document.title = `${waiting ? `(${waiting}) ` : ''}${name ? `${name} · ` : ''}Agent Office`;
}
