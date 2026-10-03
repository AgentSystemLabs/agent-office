import * as THREE from 'three';

export const FPS_ART = {
  concrete: new URL('./assets/concrete.jpg', import.meta.url).href,
  metal: new URL('./assets/metal.jpg', import.meta.url).href,
  wood: new URL('./assets/wood.jpg', import.meta.url).href,
  dock: new URL('./assets/dock.jpg', import.meta.url).href,
};

/** Generated albedo only: the arena's real lights supply shading. Loaded on entering FPS. */
export function fpsMaterials() {
  const loader = new THREE.TextureLoader();
  const tile = (url: string) => {
    const texture = loader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  };
  const concrete = tile(FPS_ART.concrete), metal = tile(FPS_ART.metal), wood = tile(FPS_ART.wood);
  const surface = (map: THREE.Texture, color: string, metalness = 0) =>
    new THREE.MeshStandardMaterial({ map, color, roughness: .86, metalness });
  return {
    concrete: surface(concrete, '#b5bec5'), floor: surface(concrete, '#859197'),
    blue: surface(metal, '#548f9d'), orange: surface(metal, '#d48754'),
    wood: surface(wood, '#e5d2b2'), iron: surface(metal, '#56606a', .55),
  };
}

/** Project each box face in meters so tall walls and long containers do not stretch a tile. */
export function boxSurfaceUv(geometry: THREE.BoxGeometry, tileMeters = 2) {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    if (Math.abs(normals.getY(i)) > .5) uv.setXY(i, x / tileMeters, z / tileMeters);
    else if (Math.abs(normals.getX(i)) > .5) uv.setXY(i, z / tileMeters, y / tileMeters);
    else uv.setXY(i, x / tileMeters, y / tileMeters);
  }
  return geometry;
}
