// @ts-nocheck
// three.js with its round primitives swapped for square-edged ones, so every object in the app
// (cars, props, lamps, wheels, balls, domes of lights…) comes out in blocks like the voxel people.
// vite.config.ts points every `import 'three'` here. The real library is re-exported untouched.
// @ts-ignore: the library's own file, past its package exports
import * as T from '../../node_modules/three/build/three.module.js';
// @ts-ignore
export * from '../../node_modules/three/build/three.module.js';

/** Corner radius that gives a square about as wide as the round shape was. */
const K = 1.24;

/** Posts, drums, wheels: four-sided, so a square block (or a square-sided taper). */
export class CylinderGeometry extends T.CylinderGeometry {
  constructor(top = 1, bottom = 1, height = 1, radial?: number, hs = 1, open = false) {
    if (radial === 4) {
      super(top, bottom, height, 4, hs, open);
      return;
    }
    super(top * K, bottom * K, height, 4, hs, open);
    this.rotateY(Math.PI / 4);
  }
}

/** Cones become four-sided pyramids. */
export class ConeGeometry extends T.ConeGeometry {
  constructor(r = 1, height = 1, radial?: number, hs = 1, open = false) {
    if (radial === 4) {
      super(r, height, 4, hs, open);
      return;
    }
    super(r * K, height, 4, hs, open);
    this.rotateY(Math.PI / 4);
  }
}

/** Balls become cubes of about the same volume, except the sky's and the planets' own huge or smooth ones. */
export class SphereGeometry extends T.SphereGeometry {
  constructor(r = 1, w = 32, h = 16, ...rest: number[]) {
    if (r > 40 || w >= 40) {
      super(r, w, h, ...rest);
      return;
    }
    super(r, 4, 2);
    const s = r * 1.6;
    const b = new T.BoxGeometry(s, s, s);
    this.copy(b as never);
    b.dispose();
    this.type = 'SphereGeometry';
  }
}

/** A capsule is a block as long. */
export class CapsuleGeometry extends T.CapsuleGeometry {
  constructor(r = 1, length = 1) {
    super(r, length, 1, 4);
    const b = new T.BoxGeometry(r * 1.8, length + r * 2, r * 1.8);
    this.copy(b as never);
    b.dispose();
  }
}

/** A hoop is a square ring with a square section. */
export class TorusGeometry extends T.TorusGeometry {
  constructor(R = 1, tube = 0.4, _r?: number, _t?: number, arc = Math.PI * 2) {
    super(R, tube, 4, arc >= Math.PI * 2 - 1e-6 ? 4 : 8, arc);
    if (arc >= Math.PI * 2 - 1e-6) this.rotateZ(Math.PI / 4);
  }
}

/** A flat disc is a flat square. */
export class CircleGeometry extends T.CircleGeometry {
  constructor(r = 1, segments = 32, start = 0, length = Math.PI * 2) {
    if (length < Math.PI * 2 - 1e-6) {
      super(r, segments, start, length);
      return;
    }
    super(r * K, 4, start, length);
    this.rotateZ(Math.PI / 4);
  }
}
