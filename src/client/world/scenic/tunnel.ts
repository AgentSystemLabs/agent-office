import * as THREE from 'three';
import { LOOP, LOOP_HALF, PLACES, RIDGE, TUNNEL, nearLoop } from '../../../shared/scenic';
import { bulb } from '../outside';
import { mesh, textPlane, toon } from '../toon';
import { G, box, strip, type ScenicKit } from './kit';
import type { Road } from './road';

/** The tunnel through the spur: the rock round it, its lining and lamps, the road through it and an arch at each end. */
export function buildTunnel(kit: ScenicKit, road: Road) {
  const { root, labels, parts, colliders, night, cullable, taken } = kit;
  const { asphalt, roadU } = road;
  {
    const T = TUNNEL;
    const half = T.width / 2;
    const archR = half;
    const len = T.x0 - T.x1;
    // The spur's shape across the road (u is meters south of it), with the tunnel's arch through it.
    const profile: [number, number][] = [
      [-RIDGE.north, -0.6],
      [-RIDGE.north, 0],
      [-24, 5],
      [-17, 11],
      [-10, 16],
      [-4, 19],
      [3, 23],
      [10, RIDGE.height - 1],
      [17, RIDGE.height],
      [24, 23],
      [31, 15],
      [36, 7],
      [RIDGE.south, 0],
      [RIDGE.south, -0.6],
    ];
    const shape = new THREE.Shape(profile.map(([u, y]) => new THREE.Vector2(u, y)));
    const hole = new THREE.Path();
    hole.moveTo(-half, -0.3);
    hole.lineTo(half, -0.3);
    hole.lineTo(half, T.wall);
    hole.absarc(0, T.wall, archR, 0, Math.PI, false);
    hole.lineTo(-half, -0.3);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, steps: 12, curveSegments: 14 });
    // Across the road (u) is z, and along it is -x from the east end.
    geo.rotateY(-Math.PI / 2);
    geo.translate(T.x0, G, T.z);
    // Humped up in the middle and down toward its ends, so the cliff each end of the tunnel is cut in
    // isn't the whole spur's height and width; lumpy along the top. None of it round the arch, so the
    // lining fits (and an end's corners only move up and down or across, so each end stays flat).
    const top = T.wall + archR + 1;
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const u = p.getZ(i) - T.z;
      let y = p.getY(i) - G;
      const k = Math.pow(Math.sin((Math.PI * (T.x0 - x)) / len), 0.6);
      if (Math.abs(u) > half + 1.5) p.setZ(i, T.z + Math.sign(u) * (half + 1.5 + (Math.abs(u) - half - 1.5) * (0.45 + 0.55 * k)));
      if (y > top) {
        y = top + (y - top) * (0.3 + 0.7 * k);
        y += (Math.sin(x * 0.21 + u * 0.13) + Math.sin(x * 0.07 - u * 0.31)) * 1.6 * k;
        p.setY(i, G + y);
      }
    }
    geo.computeVertexNormals();
    // Its two ends are cliffs of rock, the tunnel's mouths in them; its sides and top are grass.
    const spur = new THREE.Mesh(geo, [toon('#9a93a6'), toon('#6f8f55')]);
    spur.castShadow = true;
    root.add(spur);
    const tunnelBox = (obj: THREE.Object3D) => cullable(obj, T.x1 - 20, T.x0 + 20, T.z - RIDGE.north - 5, T.z + RIDGE.south + 5, RIDGE.height + 6);
    tunnelBox(spur);
    // The walls and roof inside, a little in from the arch: dark rock, with a line of lamps along the top.
    const inset = 0.06;
    const arc: [number, number][] = [[-half + inset, -0.2]];
    for (let k = 0; k <= 16; k++) {
      const a = Math.PI - (k / 16) * Math.PI;
      arc.push([Math.cos(a) * (archR - inset), T.wall + Math.sin(a) * (archR - inset)]);
    }
    arc.push([half - inset, -0.2]);
    const pos: number[] = [];
    for (let k = 0; k < arc.length - 1; k++) {
      const [u0, y0] = arc[k];
      const [u1, y1] = arc[k + 1];
      const a = [T.x0, G + y0, T.z + u0];
      const b = [T.x0, G + y1, T.z + u1];
      const c = [T.x1, G + y1, T.z + u1];
      const d = [T.x1, G + y0, T.z + u0];
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    // Lit by its own lamps, not the sun: shaded by hand, walls lighter than the roof.
    const col: number[] = [];
    const wall = new THREE.Color('#5d5766');
    const roof = new THREE.Color('#3b3643');
    for (let k = 0; k < arc.length - 1; k++) {
      const up = Math.max(0, (arc[k][1] + arc[k + 1][1]) / 2 - T.wall) / archR;
      const c = wall.clone().lerp(roof, Math.min(1, up));
      for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
    }
    const lining = new THREE.BufferGeometry();
    lining.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lining.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const rock = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    rock.userData.outlineParameters = { visible: false };
    const inner = new THREE.Mesh(lining, rock);
    root.add(inner);
    tunnelBox(inner);
    // The road through it, as dim as the walls whatever the sun's doing outside.
    const end = (x: number) => ({ x, z: T.z, d: nearLoop(x, T.z)!.d, tx: -1, tz: 0 });
    const through = [end(T.x0), ...LOOP.filter((q) => q.x < T.x0 && q.x > T.x1 && Math.abs(q.z - T.z) < 1), end(T.x1)];
    const dim = (color: string, over: number, map: THREE.Texture | null = null) => {
      const m = new THREE.MeshBasicMaterial({ color, map, polygonOffset: true, polygonOffsetFactor: -over, polygonOffsetUnits: -over * 2 });
      m.userData.outlineParameters = { visible: false };
      return m;
    };
    for (const m of [
      new THREE.Mesh(strip(through, -LOOP_HALF - 1.2, LOOP_HALF + 1.2, G - 0.009, () => 0), dim('#5e574c', 4)),
      new THREE.Mesh(strip(through, -LOOP_HALF, LOOP_HALF, G - 0.006, (i) => roadU(through[i].d)), dim('#8d8d94', 5, asphalt)),
    ]) {
      root.add(m);
      tunnelBox(m);
    }
    const lamp = bulb(night, '#ffcf7a', 0.9);
    for (let x = T.x1 + 4; x < T.x0 - 2; x += 6) for (const u of [-2.2, 2.2]) parts.mountains.add(mesh(box(1.4, 0.12, 0.3), lamp, x, G + T.wall + archR - 0.9 + (u > 0 ? 0 : 0), T.z + u, false));
    // A stone arch round each end, and the tunnel's name over it.
    const stone = toon('#cdc5b4');
    for (const [x, face] of [
      [T.x0, Math.PI / 2],
      [T.x1, -Math.PI / 2],
    ]) {
      const out = Math.sign(face);
      const ring = mesh(new THREE.TorusGeometry(archR + 0.35, 0.45, 6, 16, Math.PI), stone, x + out * 0.2, G + T.wall, T.z);
      ring.rotation.y = Math.PI / 2;
      parts.mountains.add(ring);
      for (const u of [-1, 1]) parts.mountains.add(mesh(box(0.9, T.wall, 0.9), stone, x + out * 0.2, G + T.wall / 2, T.z + u * (half + 0.35)));
      const name = textPlane(`${PLACES.tunnel.icon} ${PLACES.tunnel.name.toUpperCase()}`, { color: '#fefae0', bg: '#3d405b', size: 56, border: '#cdc5b4' });
      name.scale.setScalar(1.5);
      name.position.set(x + out * 0.35, G + T.wall + archR + 1.6, T.z);
      name.rotation.y = face;
      labels.add(name);
    }
    // Rock either side of the road in and out of it, north and south: nobody walks over the spur.
    colliders.push({ minX: T.x1, maxX: T.x0, minZ: T.z - RIDGE.north * 0.5, maxZ: T.z - half - 0.25, bottom: G - 1, top: G + 1000 });
    colliders.push({ minX: T.x1, maxX: T.x0, minZ: T.z + half + 0.25, maxZ: T.z + RIDGE.south * 0.5, bottom: G - 1, top: G + 1000 });
    taken.push({ x: (T.x0 + T.x1) / 2, z: T.z, r: 42 });
  }
}
