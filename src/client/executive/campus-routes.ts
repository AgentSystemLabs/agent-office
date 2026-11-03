import * as THREE from 'three';
import { pedestrianPaths, primaryRoads, secondaryRoads, transitRoute, type CampusRoute } from './campus-layout';

const material = (color: THREE.ColorRepresentation, roughness = .78) => new THREE.MeshStandardMaterial({ color, roughness });

function routeSegments(parent: THREE.Object3D, route: CampusRoute, y: number, color: THREE.ColorRepresentation, height: number): void {
  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1], end = route.points[index];
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    const segment = new THREE.Mesh(new THREE.BoxGeometry(route.width, height, length), material(color));
    segment.position.set((start.x + end.x) / 2, y, (start.z + end.z) / 2);
    segment.rotation.y = Math.atan2(dx, dz);
    segment.receiveShadow = true;
    parent.add(segment);
  }
}

export function buildCampusRoutes(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group(); group.name = 'campus-routes'; scene.add(group);
  primaryRoads.forEach(route => {
    routeSegments(group, { ...route, width: route.width + .34 }, .03, '#172738', .12);
    routeSegments(group, route, .11, '#3a4853', .09);
    routeSegments(group, { ...route, width: .1 }, .17, '#81cbd2', .025);
  });
  secondaryRoads.forEach(route => {
    routeSegments(group, { ...route, width: route.width + .24 }, .025, '#162431', .1);
    routeSegments(group, route, .1, '#46515a', .075);
  });
  pedestrianPaths.forEach(route => {
    routeSegments(group, { ...route, width: route.width + .18 }, .09, '#2c3940', .1);
    routeSegments(group, route, .16, '#9d9c90', .07);
  });
  routeSegments(group, { ...transitRoute, width: 1.1 }, .045, '#112331', .08);
  routeSegments(group, transitRoute, .14, '#57c8dc', .08);
  const station = new THREE.Mesh(new THREE.BoxGeometry(8, .34, 3), material('#51606a'));
  station.position.set(0, .18, 37); station.receiveShadow = true; group.add(station);
  for (const x of [-3, 3]) {
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(.12, .16, 2.2, 12), material('#6fdcea', .4));
    beacon.position.set(x, 1.25, 37); group.add(beacon);
  }
  return group;
}
