import { loadThreads } from '../../../shared/smartphone';
import type { RecentEntry, SmsMsg } from '../../../shared/smartphone';
import type { Slice, Store } from '../store';

declare module '../store' {
  interface Store {
    /** The smartphone's SMS threads by floor/worker, and its recent calls and texts (per floor). */
    smartphone: { threads: Record<string, SmsMsg[]>; recents: RecentEntry[] };
  }
  interface Topics {
    smartphone: true;
  }
}

export const smartphone: Slice = {
  init(s: Store) {
    s.smartphone = { threads: loadThreads(), recents: [] };
  },
  enter(s: Store) {
    // A new floor: recents start over; threads stay (they're keyed by floor).
    s.smartphone = { threads: s.smartphone.threads, recents: [] };
    return ['smartphone'];
  },
};
