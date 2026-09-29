import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

// Reads a model the office loads (src/client/models/<name>.glb) for its tests: the names things are
// found by, where its nodes sit, and how big it is. Only the JSON half of the file is read.

export interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  matrix?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

export interface Gltf {
  nodes: GltfNode[];
  skins?: { joints: number[] }[];
  animations?: { name?: string }[];
  materials?: { name?: string }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors: { min?: number[]; max?: number[]; count: number }[];
}

/** The JSON chunk of a binary glTF: after a 12-byte header (magic, version, length), a chunk's length, its type, then the JSON. */
function readGlb(file: URL): Gltf {
  const b = readFileSync(file);
  assert.equal(b.toString('ascii', 0, 4), 'glTF', 'a binary glTF');
  assert.equal(b.readUInt32LE(4), 2, 'glTF 2');
  assert.equal(b.readUInt32LE(8), b.length, 'the header gives the whole length');
  const length = b.readUInt32LE(12);
  assert.equal(b.toString('ascii', 16, 20), 'JSON', 'the first chunk is the JSON');
  return JSON.parse(b.toString('utf8', 20, 20 + length)) as Gltf;
}

export function openModel(name: string) {
  const gltf = readGlb(new URL(`../src/client/models/${name}.glb`, import.meta.url));
  const { nodes } = gltf;
  const parentOf = new Map<number, number>();
  nodes.forEach((n, i) => n.children?.forEach((c) => parentOf.set(c, i)));
  const local = (n: GltfNode) =>
    n.matrix
      ? new Matrix4().fromArray(n.matrix)
      : new Matrix4().compose(new Vector3(...(n.translation ?? [0, 0, 0])), new Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new Vector3(...(n.scale ?? [1, 1, 1])));

  /** Where a node sits in the file's world, from its own transform and its parents'. */
  function worldMatrix(i: number): Matrix4 {
    const m = local(nodes[i]);
    for (let p = parentOf.get(i); p !== undefined; p = parentOf.get(p)) m.premultiply(local(nodes[p]));
    return m;
  }

  return {
    gltf,
    nodes,
    parentOf,
    worldMatrix,
    /** A node's index by name, or -1. */
    byName: (n: string) => nodes.findIndex((node) => node.name === n),
    /** Every clip's name. */
    clips: () => (gltf.animations ?? []).map((a) => a.name ?? ''),
    /** Every material's name. */
    materials: () => (gltf.materials ?? []).map((m) => m.name ?? ''),
    /** The name of the node a node hangs from, if any. */
    parentName: (i: number) => nodes[parentOf.get(i) ?? -1]?.name,
    /** Where a node is, and how it's turned, in the file's world (its rest pose, for bones). */
    placed(i: number) {
      const at = new Vector3();
      const turn = new Quaternion();
      worldMatrix(i).decompose(at, turn, new Vector3());
      return { at, turn };
    },
    /** The whole model's bounds as it stands in the file (x across, y up, z forward). */
    bounds(): Box3 {
      const box = new Box3();
      nodes.forEach((n, i) => {
        if (n.mesh === undefined) return;
        for (const p of gltf.meshes[n.mesh].primitives) {
          const a = gltf.accessors[p.attributes.POSITION];
          assert.ok(a.min && a.max, 'POSITION accessors carry their min and max');
          box.union(new Box3(new Vector3().fromArray(a.min), new Vector3().fromArray(a.max)).applyMatrix4(worldMatrix(i)));
        }
      });
      return box;
    },
    /** Triangles in all its meshes (each primitive is indexed triangles, as Blender exports them). */
    triangles(): number {
      let n = 0;
      for (const m of gltf.meshes) for (const p of m.primitives) if (p.indices !== undefined) n += gltf.accessors[p.indices].count / 3;
      return n;
    },
  };
}
