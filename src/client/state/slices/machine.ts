import type { MachineState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** How busy the office's machine is, and its worker limit. */
    machine: MachineState;
  }
  interface Topics {
    machine: true;
  }
}

export const machine: Slice = {
  init(s) {
    s.machine = { cpu: 0, cores: 0, memUsed: 0, memTotal: 0, history: [], workers: 0 };
  },
  on: {
    welcome(s, m) {
      s.machine = m.machine;
      return ['machine'];
    },
    machine(s, m) {
      s.machine = m.state;
      return ['machine'];
    },
  },
};
