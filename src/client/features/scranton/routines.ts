import { SCRANTON, HOMES, WORKSTATIONS, CONFERENCE_CHAIRS, ROOMS, point } from '../../../shared/scranton';
import type { NavGrid, Pt } from '../../../shared/nav';
import type { Snapshot } from '../ambient-office/simulation';
import type { AmbientSpace } from '../ambient-office/world';

const PLACES = {
  reception: point(4.6, 5.8), bullpen: point(7.5, 11.1), kitchen: point(18.8, 9.1),
  meeting: ROOMS.conference.at, annex: point(25, 10.5),
};

/** Adapt the ambient simulator through its space dependency; no worker seats are reused. */
export function scrantonRoutines(nav: NavGrid): AmbientSpace {
  return { nav, homes: HOMES, adapt: (snapshot: Snapshot): Snapshot => {
    const members = snapshot.scene ? [...new Set(snapshot.scene.beats.map((b) => b.who))] : [];
    return { ...snapshot, people: snapshot.people.map((state) => {
      const p = state.person;
      const home = HOMES[p.id];
      const member = members.indexOf(p.id);
      const routine = state.target[0] === p.home[0] && state.target[1] === p.home[1];
      let target: Pt = home;
      let seat: typeof state.seat;
      const desk = WORKSTATIONS.find((s) => s.id === p.id);
      if (routine && desk) seat = { hips: 0.84, facing: desk.facing };
      if (routine && p.id === 'erin') seat = { hips: 0.84, facing: Math.PI };
      if (member >= 0 && snapshot.scene) {
        const center = PLACES[snapshot.scene.place];
        const angle = member / members.length * Math.PI * 2;
        target = [center[0] + Math.cos(angle) * 0.85, center[1] + Math.sin(angle) * 0.85];
        seat = undefined;
        if (snapshot.scene.place === 'meeting') {
          target = CONFERENCE_CHAIRS[member % CONFERENCE_CHAIRS.length];
          seat = { hips: 0.84, facing: Math.PI };
        }
      } else if (state.activity === 'Taking a lunch break') {
        const i = snapshot.people.indexOf(state);
        target = point(18.5 + i % 3, 9.0 + (i % 2) * 0.55);
        seat = undefined;
      } else if (snapshot.phase === 'departure') {
        target = point(14.0, 5.8);
        seat = undefined;
      }
      const center: Pt = [SCRANTON.minX + Math.floor((target[0] - SCRANTON.minX) / 0.5) * 0.5 + 0.25, SCRANTON.minZ + Math.floor((target[1] - SCRANTON.minZ) / 0.5) * 0.5 + 0.25];
      return { ...state, target: nav.nearestWalkable(center), seat };
    }) };
  } };
}
