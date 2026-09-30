import { parked, type CarSeat, type CarState } from '../../../shared/garage';
import type { Slice, Store } from '../store';

declare module '../store' {
  interface Store {
    /**
     * The cars in the garage, as the office last said (see shared/garage.ts), and when (performance.now())
     * each one's driver last said where it is. Their moves change them without a word, like people's.
     */
    cars: CarState[];
    carsAt: number[];
    /** The car `id` (a PeerInfo id) is in on this floor, and which seat. */
    carOf(id: string): { car: number; seat: CarSeat } | undefined;
  }
  interface Topics {
    cars: true;
  }
}

function setCars(s: Store, cars: CarState[]) {
  s.cars = cars;
  const now = performance.now();
  s.carsAt = cars.map(() => now);
}

export const cars: Slice = {
  init(s) {
    s.cars = parked();
    s.carsAt = [];
  },
  methods: {
    carOf(id) {
      for (let i = 0; i < this.cars.length; i++) {
        if (this.cars[i].driver === id) return { car: i, seat: 'driver' };
        if (this.cars[i].passenger === id) return { car: i, seat: 'passenger' };
      }
      return undefined;
    },
  },
  on: {
    cars(s, m) {
      setCars(s, m.cars);
      return ['cars'];
    },
    'car.move'(s, m) {
      const c = s.cars[m.car];
      if (!c) return;
      Object.assign(c, { x: m.x, z: m.z, rotY: m.rotY, speed: m.speed, steer: m.steer });
      s.carsAt[m.car] = performance.now();
    },
  },
  enter(s, v) {
    setCars(s, v.cars ?? parked());
    return ['cars'];
  },
};
