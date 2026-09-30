import type { SignInsState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Your own Claude and GitHub sign-ins; only accounts have them. */
    signins: SignInsState | null;
  }
  interface Topics {
    signins: true;
  }
}

export const signins: Slice = {
  init(s) {
    s.signins = null;
  },
  on: {
    signins(s, m) {
      s.signins = m.state;
      return ['signins'];
    },
  },
};
