import type { DogState } from '../../../shared/dog';
import type { Slice, Store } from '../store';

declare module '../store' {
  interface Store {
    /** The dog on your floor, and when (performance.now()) the leg it's on began. */
    dog: DogState | null;
    dogStart: number;
  }
  interface Topics {
    dog: true;
  }
}

function setDog(s: Store, dog: DogState | null) {
  s.dog = dog;
  s.dogStart = performance.now() - (dog?.elapsed ?? 0);
}

export const dog: Slice = {
  init(s) {
    s.dog = null;
    s.dogStart = 0;
  },
  on: {
    dog(s, m) {
      setDog(s, m.dog);
      return ['dog'];
    },
  },
  enter(s, v) {
    setDog(s, v.dog);
    return ['dog'];
  },
};
