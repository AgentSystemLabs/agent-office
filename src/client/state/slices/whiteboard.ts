import { newer, type WbElement } from '../../../shared/whiteboard';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The floor's whiteboard: the newest copy of every element anyone drew, deleted ones too. */
    whiteboard: Map<string, WbElement>;
    /** Who has the whiteboard open (client ids). */
    drawing: string[];
    /** Takes in whiteboard elements, yours or someone else's: each one newer than the copy here replaces it. */
    drew(elements: readonly WbElement[]): void;
  }
  interface Topics {
    whiteboard: true;
    drawing: true;
  }
}

export const whiteboard: Slice = {
  init(s) {
    s.whiteboard = new Map();
    s.drawing = [];
  },
  methods: {
    drew(elements) {
      let changed = false;
      for (const e of elements) {
        if (!newer(e, this.whiteboard.get(e.id))) continue;
        this.whiteboard.set(e.id, e);
        changed = true;
      }
      if (changed) this.emit('whiteboard');
    },
  },
  on: {
    'wb.update'(s, m) {
      s.drew(m.elements);
    },
    'wb.people'(s, m) {
      s.drawing = m.people;
      return ['drawing'];
    },
  },
  enter(s, v) {
    s.whiteboard = new Map(v.whiteboard.elements.map((e) => [e.id, e]));
    s.drawing = v.whiteboard.people;
    return ['whiteboard', 'drawing'];
  },
};
