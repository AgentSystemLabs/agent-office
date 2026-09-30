import { JUKEBOX_TUNES, type JukeboxState } from '../../../shared/jukebox';
import type { Slice, Store } from '../store';

declare module '../store' {
  interface Store {
    /** What the lounge jukebox is playing; `since` is when the track started, on performance.now()'s clock. */
    jukebox: JukeboxState & { since: number };
    /** The office's clock minus performance.now(), from the quickest ping (see 'pong'); for the jukebox. Only this slice sets it. */
    clock?: { offset: number; rtt: number };
    /** The office's clock (ms since 1970) as near as this page can tell, which the DJ on the roof keeps time by. */
    officeNow(): number;
  }
  interface Topics {
    jukebox: true;
  }
}

/** When the track started on this page's clock: from the office's clock once it's known, else from `elapsed`. */
function setJukebox(s: Store, j: JukeboxState) {
  s.jukebox = { ...j, since: s.clock ? j.startedAt - s.clock.offset : performance.now() - j.elapsed };
}

export const jukebox: Slice = {
  init(s) {
    s.jukebox = { on: false, track: JUKEBOX_TUNES[0].id, startedAt: 0, elapsed: 0, since: 0 };
    s.clock = undefined;
  },
  methods: {
    officeNow() {
      return this.clock ? performance.now() + this.clock.offset : Date.now();
    },
  },
  on: {
    welcome(s) {
      s.clock = undefined; // compared again, in case it's another office (or the same one, restarted)
    },
    jukebox(s, m) {
      setJukebox(s, m.state);
      return ['jukebox'];
    },
    pong(s, m) {
      // The answer that came back quickest says best how the two clocks line up.
      const rtt = performance.now() - m.at;
      if (s.clock && rtt >= s.clock.rtt) return;
      s.clock = { offset: m.now - (m.at + rtt / 2), rtt };
      const was = s.jukebox.since;
      setJukebox(s, s.jukebox);
      if (Math.abs(s.jukebox.since - was) > 20) return ['jukebox'];
    },
  },
  enter(s, v) {
    setJukebox(s, v.jukebox);
    return ['jukebox'];
  },
};
