import * as THREE from 'three';
import type { NavMeshQuery } from 'recast-navigation';

export type WalkPoint = { x: number; y: number; z: number };

export type VerticalLink = {
  startPosition: WalkPoint;
  endPosition: WalkPoint;
  radius: number;
  bidirectional: boolean;
  area: number;
  flags: number;
  userId: number;
};

export type WalkabilityRoute = {
  name: string;
  start: WalkPoint;
  end: WalkPoint;
};

export type RouteMetric = {
  name: string;
  status: 'PASS' | 'FAIL';
  pathLength: number;
  pathPoints: WalkPoint[];
  failureReason?: string;
  adaWarnings: string[];
  narrowestClearWidth: number | null;
};

export type FloorMetric = {
  floor: string;
  sampledPoints: number;
  reachablePoints: number;
  coveragePercent: number;
  warnings: string[];
};

export type WalkabilityReport = {
  auditNumber: number;
  generatedAt: string;
  auditMode: 'exhaustive-sampled';
  sampledWalkablePoints: number;
  pairRouteTests: number;
  adaClearWidthMinimumMeters: number;
  routes: RouteMetric[];
  customTests: RouteMetric[];
  floors: FloorMetric[];
  adaWarnings: string[];
};

export type WalkabilityTestOptions = {
  scene: THREE.Scene;
  shell: THREE.Group;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  meshes: THREE.Mesh[];
  getQuery: () => NavMeshQuery | undefined;
  getCurrentPosition: () => WalkPoint;
};

const ADA_CLEAR_WIDTH = 0.9;
// A continuous building has infinitely many possible start/end pairs. This is
// deliberately dense enough to expose disconnected rooms while keeping the
// browser responsive and the exported report usable.
const EXHAUSTIVE_SAMPLE_STEP = 3.5;
const FLOOR_BANDS = [
  { id: 'F1', min: -0.4, max: 4.05 },
  { id: 'F2', min: 3.95, max: 8.55 },
  { id: 'F3', min: 8.45, max: 12.55 },
  { id: 'Roof', min: 12.45, max: 20 },
] as const;

const FLOOR_ANALYSIS: Array<{ floor: string; y: number; slabName: string; anchorName: string; origin: WalkPoint }> = [
  { floor: 'F1', y: 0, slabName: 'F1_Slab', anchorName: 'SPAWN_F1_lobby', origin: { x: 0, y: 0, z: 9 } },
  { floor: 'F2', y: 4, slabName: 'F2_Slab', anchorName: 'SPAWN_E2', origin: { x: 1.5, y: 4, z: -4.5 } },
  { floor: 'F3', y: 8.5, slabName: 'F3_Slab', anchorName: 'SPAWN_E3', origin: { x: 1.5, y: 8.5, z: -4.5 } },
  { floor: 'Roof', y: 12.5, slabName: 'Roof_Slab', anchorName: 'ELEV_door_roof', origin: { x: 2, y: 12.5, z: -4.5 } },
] as const;

export const STANDARD_ROUTES: WalkabilityRoute[] = [
  { name: 'F1 lobby → atrium', start: { x: 0, y: 0, z: 9 }, end: { x: 0, y: 0, z: 3 } },
  { name: 'F1 lobby → core', start: { x: 0, y: 0, z: 9 }, end: { x: 0, y: 0, z: -4.5 } },
  { name: 'F1 west → east', start: { x: -8, y: 0, z: 9 }, end: { x: 8, y: 0, z: 9 } },
  { name: 'F2 front → rear', start: { x: -9, y: 4, z: 11 }, end: { x: 9, y: 4, z: -11 } },
  { name: 'F3 west → east', start: { x: -9, y: 8.5, z: 11 }, end: { x: 9, y: 8.5, z: 11 } },
  { name: 'Roof stair exit → perimeter', start: { x: -2, y: 12.5, z: -3 }, end: { x: 8, y: 12.5, z: 10 } },
  { name: 'F1 → F2 elevator transition', start: { x: 1.5, y: 0, z: -4.5 }, end: { x: 1.5, y: 4, z: -4.5 } },
  { name: 'F2 → F3 elevator transition', start: { x: 1.5, y: 4, z: -4.5 }, end: { x: 1.5, y: 8.5, z: -4.5 } },
  { name: 'F3 → Roof elevator transition', start: { x: 2, y: 8.5, z: -4.5 }, end: { x: 2, y: 12.5, z: -4.5 } },
];

function pointFromObject(object: THREE.Object3D): WalkPoint {
  const position = new THREE.Vector3();
  object.getWorldPosition(position);
  return { x: position.x, y: position.y, z: position.z };
}

type WorldTransform = {
  toWorld: (point: WalkPoint) => WalkPoint;
};

/**
 * Blender's contract coordinates are preserved in the exported anchor names,
 * while the GLB may contain an exporter scale, vertical offset, and a flipped
 * depth axis. Derive that conversion from two known spawn anchors instead of
 * hard-coding the current export transform.
 */
function getWorldTransform(shell: THREE.Group): WorldTransform {
  const lobby = shell.getObjectByName('SPAWN_F1_lobby');
  const floor2 = shell.getObjectByName('SPAWN_E2');
  if (!lobby || !floor2) return { toWorld: (point) => point };

  const lobbyWorld = pointFromObject(lobby);
  const floor2World = pointFromObject(floor2);
  const scale = (floor2World.y - lobbyWorld.y) / 4;
  if (!Number.isFinite(scale) || Math.abs(scale) < 0.01) return { toWorld: (point) => point };

  return {
    toWorld: (point) => ({
      x: lobbyWorld.x + scale * point.x,
      y: lobbyWorld.y + scale * point.y,
      z: lobbyWorld.z - scale * (point.z - 9),
    }),
  };
}

/** Builds bidirectional Recast links from the exported elevator/stair anchors. */
export function getVerticalTransitionLinks(shell: THREE.Group): VerticalLink[] {
  const worldTransform = getWorldTransform(shell);
  const anchorNames = ['ELEV_door_F1', 'ELEV_door_F2', 'ELEV_door_F3', 'ELEV_door_roof'];
  const fallbackAnchors: WalkPoint[] = [
    { x: 2, y: 0, z: -4.5 },
    { x: 2, y: 4, z: -4.5 },
    { x: 2, y: 8.5, z: -4.5 },
    { x: 2, y: 12.5, z: -4.5 },
  ].map(worldTransform.toWorld);
  const anchors = anchorNames.map((name, index) => shell.getObjectByName(name) ?? fallbackAnchors[index]);
  const links: VerticalLink[] = [];
  const asWalkPoint = (anchor: THREE.Object3D | WalkPoint): WalkPoint =>
    typeof anchor === 'object' && 'isObject3D' in anchor && anchor.isObject3D
      ? pointFromObject(anchor as THREE.Object3D)
      : anchor as WalkPoint;
  for (let i = 0; i + 1 < anchors.length; i++) {
    const startPosition = asWalkPoint(anchors[i]);
    const endPosition = asWalkPoint(anchors[i + 1]);
    links.push({
      startPosition,
      endPosition,
      radius: 1.5,
      bidirectional: true,
      area: 0,
      flags: 1,
      userId: i + 1,
    });
  }
  return links;
}

function distance(a: WalkPoint, b: WalkPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function pathLength(path: WalkPoint[]) {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += distance(path[i - 1], path[i]);
  return length;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.dispose();
  });
}

export function createWalkabilityTest(options: WalkabilityTestOptions) {
  const { scene, shell, camera, canvas, meshes, getQuery, getCurrentPosition } = options;
  const worldTransform = getWorldTransform(shell);
  const raycaster = new THREE.Raycaster();
  const debug = new THREE.Group();
  debug.name = 'WALKTEST_Debug';
  debug.renderOrder = 20;
  scene.add(debug);

  const originalVisibility = new Map<THREE.Mesh, boolean>();
  for (const mesh of meshes) originalVisibility.set(mesh, mesh.visible);

  type AuditRun = { cancelled: boolean };
  let activeAudit: AuditRun | null = null;
  const AUDIT_CANCELLED = Symbol('AUDIT_CANCELLED');
  let latestReport: WalkabilityReport = {
    auditNumber: 0,
    generatedAt: new Date().toISOString(),
    auditMode: 'exhaustive-sampled',
    sampledWalkablePoints: 0,
    pairRouteTests: 0,
    adaClearWidthMinimumMeters: ADA_CLEAR_WIDTH,
    routes: [],
    customTests: [],
    floors: [],
    adaWarnings: [],
  };

  const reportElement = document.querySelector('#report') as HTMLPreElement | null;
  const statusElement = document.querySelector('#status') as HTMLDivElement | null;
  const runButton = document.querySelector('#run') as HTMLButtonElement | null;

  const resetDebug = () => {
    for (const child of [...debug.children]) {
      debug.remove(child);
      disposeObject(child);
    }
  };

  const addDebugLine = (name: string, points: WalkPoint[], color: number) => {
    if (points.length < 2) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, point.y + 0.08, point.z)));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
    line.name = `WALKTEST_${name}`;
    line.renderOrder = 20;
    debug.add(line);
  };

  /** Downward raycast used before Recast queries to remove elevation mismatches. */
  const surfaceSnap = (point: WalkPoint, yTolerance = 3): WalkPoint => {
    const bounds = new THREE.Box3().setFromObject(shell);
    const origin = new THREE.Vector3(point.x, Math.max(bounds.max.y + 5, point.y + 8), point.z);
    raycaster.set(origin, new THREE.Vector3(0, -1, 0));
    const hits = raycaster.intersectObjects(meshes, true)
      .filter((hit) => hit.point.y >= point.y - yTolerance && hit.point.y <= point.y + yTolerance)
      .sort((a, b) => Math.abs(a.point.y - point.y) - Math.abs(b.point.y - point.y));
    const hit = hits[0];
    return hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : point;
  };

  const nearestWalkable = (point: WalkPoint, yTolerance = 1.5, horizontalSearchRadius = 2.5) => {
    const query = getQuery();
    if (!query) return { requested: point, snapped: point, nearest: undefined };
    const offsets = [{ x: 0, z: 0 }];
    for (let radius = 0.5; radius <= horizontalSearchRadius; radius += 0.5) {
      offsets.push(
        { x: radius, z: 0 }, { x: -radius, z: 0 },
        { x: 0, z: radius }, { x: 0, z: -radius },
        { x: radius, z: radius }, { x: -radius, z: radius },
        { x: radius, z: -radius }, { x: -radius, z: -radius },
      );
    }
    let best: { snapped: WalkPoint; nearest: WalkPoint; score: number } | undefined;
    for (const offset of offsets) {
      const candidate = { x: point.x + offset.x, y: point.y, z: point.z + offset.z };
      const snapped = surfaceSnap(candidate, yTolerance + 1.5);
      const nearest = query.findClosestPoint(snapped, { halfExtents: { x: 1.5, y: Math.max(3, yTolerance), z: 1.5 } });
      if (!nearest.success) continue;
      const verticalError = Math.abs(nearest.point.y - point.y);
      const horizontalError = Math.hypot(nearest.point.x - point.x, nearest.point.z - point.z);
      if (verticalError > yTolerance || horizontalError > horizontalSearchRadius + 1.25) continue;
      const score = horizontalError + verticalError * 0.25;
      if (!best || score < best.score) best = { snapped, nearest: nearest.point, score };
    }
    return { requested: point, snapped: best?.snapped ?? surfaceSnap(point, yTolerance), nearest: best?.nearest };
  };

  const clearanceAt = (point: WalkPoint, tangent: THREE.Vector2) => {
    const normal = new THREE.Vector3(-tangent.y, 0, tangent.x).normalize();
    const distances: number[] = [];
    for (const sign of [-1, 1]) {
      const origin = new THREE.Vector3(point.x + normal.x * sign * 0.03, point.y + 0.9, point.z + normal.z * sign * 0.03);
      raycaster.set(origin, normal.clone().multiplyScalar(sign));
      const hit = raycaster.intersectObjects(meshes, true).find((candidate) => Math.abs(candidate.point.y - origin.y) < 1.2 && candidate.distance < 4);
      distances.push(hit?.distance ?? 4);
    }
    return distances[0] + distances[1];
  };

  const auditADA = (path: WalkPoint[]) => {
    const warnings: string[] = [];
    if (path.length < 2) return { warnings, narrowest: null };
    let narrowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < path.length; i++) {
      const previous = path[Math.max(0, i - 1)];
      const next = path[Math.min(path.length - 1, i + 1)];
      const tangent = new THREE.Vector2(next.x - previous.x, next.z - previous.z);
      if (tangent.lengthSq() < 1e-6) continue;
      tangent.normalize();
      const width = clearanceAt(path[i], tangent);
      narrowest = Math.min(narrowest, width);
      if (width < ADA_CLEAR_WIDTH) warnings.push(`Narrow pinch point near (${path[i].x.toFixed(2)}, ${path[i].y.toFixed(2)}, ${path[i].z.toFixed(2)}): ${width.toFixed(2)}m clear width`);
    }
    return { warnings: [...new Set(warnings)], narrowest: Number.isFinite(narrowest) ? narrowest : null };
  };

  const evaluateRoute = (route: WalkabilityRoute, drawDebug = true): RouteMetric => {
    const query = getQuery();
    const verticalRoute = Math.abs(route.start.y - route.end.y) > 1;
    const yTolerance = verticalRoute ? 6 : 1.5;
    const start = nearestWalkable(route.start, yTolerance, verticalRoute ? 3 : 2.5);
    const end = nearestWalkable(route.end, yTolerance, verticalRoute ? 3 : 2.5);
    if (!query || !start.nearest || !end.nearest) {
      const snapLines: WalkPoint[] = [];
      if (start.nearest) snapLines.push(route.start, start.nearest);
      if (end.nearest) snapLines.push(route.end, end.nearest);
      if (drawDebug && snapLines.length) addDebugLine(`${route.name}_nearest`, snapLines, 0xf4d35e);
      return { name: route.name, status: 'FAIL', pathLength: 0, pathPoints: [], failureReason: 'start or destination is not on a walkable surface', adaWarnings: [], narrowestClearWidth: null };
    }
    const result = query.computePath(start.nearest, end.nearest, { maxPathPolys: 4096, maxStraightPathPoints: 1024 });
    const path = result.success ? result.path : [];
    const ada = auditADA(path);
    const metric: RouteMetric = {
      name: route.name,
      status: result.success && path.length > 1 ? 'PASS' : 'FAIL',
      pathLength: pathLength(path),
      pathPoints: path,
      failureReason: result.success ? undefined : result.error?.name ?? 'no connected path',
      adaWarnings: ada.warnings,
      narrowestClearWidth: ada.narrowest,
    };
    if (drawDebug) {
      if (distance(route.start, start.nearest) > 0.2) addDebugLine(`${route.name}_start_snap`, [route.start, start.nearest], 0xf4d35e);
      if (distance(route.end, end.nearest) > 0.2) addDebugLine(`${route.name}_end_snap`, [route.end, end.nearest], 0xf4d35e);
      addDebugLine(route.name, path.length > 1 ? path : [route.start, route.end], metric.status === 'PASS' ? 0x39e58c : 0xff4f5e);
    } else if (metric.status === 'FAIL') {
      addDebugLine(`FAIL_${route.name}`, path.length > 1 ? path : [route.start, route.end], 0xff4f5e);
    }
    return metric;
  };

  const floorBounds = (floor: typeof FLOOR_ANALYSIS[number]) => {
    const slab = shell.getObjectByName(floor.slabName);
    const bounds = slab ? new THREE.Box3().setFromObject(slab) : undefined;
    return {
      minX: bounds ? bounds.min.x + 1 : -10,
      maxX: bounds ? bounds.max.x - 1 : 10,
      minZ: bounds ? bounds.min.z + 1 : -13,
      maxZ: bounds ? bounds.max.z - 1 : 13,
    };
  };

  type FloorSample = WalkPoint & { floor: string };

  const collectFloorSamples = (step: number): FloorSample[] => {
    const samples: FloorSample[] = [];
    for (const floor of FLOOR_ANALYSIS) {
      const bounds = floorBounds(floor);
      const worldFloorY = worldTransform.toWorld({ x: 0, y: floor.y, z: 0 }).y;
      for (let x = bounds.minX; x <= bounds.maxX + 0.001; x += step) {
        for (let z = bounds.minZ; z <= bounds.maxZ + 0.001; z += step) {
          const target = nearestWalkable({ x, y: worldFloorY, z }, 1.5, 2.5).nearest;
          if (!target || Math.abs(target.y - worldFloorY) > 0.9 || Math.hypot(target.x - x, target.z - z) > 2.5) continue;
          const duplicate = samples.some((sample) => sample.floor === floor.floor && Math.hypot(sample.x - target.x, sample.z - target.z) < 0.75);
          if (!duplicate) samples.push({ ...target, floor: floor.floor });
        }
      }
    }
    return samples;
  };

  const auditFloorCoverage = (): FloorMetric[] => {
    const query = getQuery();
    if (!query) return [];
    return FLOOR_ANALYSIS.map(({ floor, y, slabName, anchorName, origin }) => {
      const anchor = shell.getObjectByName(anchorName);
      const worldFloorY = worldTransform.toWorld({ x: 0, y, z: 0 }).y;
      const floorOrigin = anchor ? pointFromObject(anchor) : worldTransform.toWorld(origin);
      const start = nearestWalkable(floorOrigin, 1.5, 3).nearest;
      if (!start) return { floor, sampledPoints: 0, reachablePoints: 0, coveragePercent: 0, warnings: [`${floor}: the floor origin is not walkable`] };

      const { minX, maxX, minZ, maxZ } = floorBounds({ floor, y, slabName, anchorName, origin });
      let sampledPoints = 0;
      let reachablePoints = 0;
      for (let x = minX; x <= maxX + 0.001; x += 2.5) for (let z = minZ; z <= maxZ + 0.001; z += 2.5) {
        const target = nearestWalkable({ x, y: worldFloorY, z }, 1.5, 2.5).nearest;
        if (!target || Math.abs(target.y - worldFloorY) > 0.9 || Math.hypot(target.x - x, target.z - z) > 2.5) continue;
        sampledPoints++;
        const path = query.computePath(start, target, { maxPathPolys: 4096, maxStraightPathPoints: 1024 });
        const elevations = path.path.map((point) => point.y);
        const remainsOnFloor = path.success && elevations.length > 1 && Math.max(...elevations) - Math.min(...elevations) <= 1.0 && elevations.every((elevation) => Math.abs(elevation - worldFloorY) <= 0.9);
        if (remainsOnFloor && path.path.length > 1) reachablePoints++;
      }
      const coveragePercent = sampledPoints ? Math.round((reachablePoints / sampledPoints) * 1000) / 10 : 0;
      const warnings = coveragePercent < 100 ? [`${floor}: ${reachablePoints}/${sampledPoints} sampled walkable points connect to the floor origin`] : [];
      return { floor, sampledPoints, reachablePoints, coveragePercent, warnings };
    });
  };

  const yieldToBrowser = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

  const auditExhaustiveRoutes = async (setProgress: (message: string) => void, run: AuditRun) => {
    const samples = collectFloorSamples(EXHAUSTIVE_SAMPLE_STEP);
    const routes: RouteMetric[] = [];
    const totalPairs = (samples.length * (samples.length - 1)) / 2;
    let completedPairs = 0;
    for (let startIndex = 0; startIndex < samples.length; startIndex++) {
      for (let endIndex = startIndex + 1; endIndex < samples.length; endIndex++) {
        if (run.cancelled) throw AUDIT_CANCELLED;
        const start = samples[startIndex];
        const end = samples[endIndex];
        const metric = evaluateRoute({
          name: `${start.floor} (${start.x.toFixed(1)},${start.z.toFixed(1)}) ↔ ${end.floor} (${end.x.toFixed(1)},${end.z.toFixed(1)})`,
          start,
          end,
        }, false);
        routes.push(metric);
        completedPairs++;
        if (completedPairs % 25 === 0) {
          setProgress(`Testing exhaustive building connectivity: ${completedPairs.toLocaleString()}/${totalPairs.toLocaleString()} point pairs…`);
          await yieldToBrowser();
        }
      }
    }
    return { samples, routes };
  };

  const renderReport = () => {
    const allRoutes = [...latestReport.routes, ...latestReport.customTests];
    if (statusElement) statusElement.textContent = `Audit #${latestReport.auditNumber} complete at ${new Date(latestReport.generatedAt).toLocaleTimeString()}: ${allRoutes.filter((route) => route.status === 'PASS').length}/${allRoutes.length} route tests passed across ${latestReport.sampledWalkablePoints} sampled points. Green = success, red = failure, yellow = snapped point.`;
    if (!reportElement) return;
    const routeLines = allRoutes.map((route) => `${route.status}  ${route.name} — ${route.pathLength.toFixed(2)}m${route.failureReason ? ` — ${route.failureReason}` : ''}${route.adaWarnings.length ? `\n  ADA: ${route.adaWarnings.join('; ')}` : ''}`);
    const floorLines = latestReport.floors.map((floor) => `${floor.coveragePercent === 100 ? 'PASS' : 'WARN'}  ${floor.floor} coverage — ${floor.reachablePoints}/${floor.sampledPoints} points (${floor.coveragePercent}%)${floor.warnings.length ? `\n  ${floor.warnings.join('; ')}` : ''}`);
    reportElement.textContent = [...routeLines, '', 'FLOOR-BY-FLOOR COVERAGE', ...floorLines].join('\n');
  };

  const runStandardTests = async () => {
    // R and the Run button are a toggle: pressing them during an audit cancels it.
    if (activeAudit) {
      activeAudit.cancelled = true;
      if (statusElement) statusElement.textContent = 'Stopping audit…';
      return latestReport;
    }
    const run: AuditRun = { cancelled: false };
    activeAudit = run;
    latestReport.auditNumber++;
    if (runButton) {
      runButton.disabled = false;
      runButton.textContent = 'Stop audit';
    }
    if (statusElement) statusElement.textContent = `Running complete audit #${latestReport.auditNumber} across every route and floor…`;
    try {
      resetDebug();
      const standardRoutes = STANDARD_ROUTES.map((route) => evaluateRoute({
        ...route,
        start: worldTransform.toWorld(route.start),
        end: worldTransform.toWorld(route.end),
      }));
      const floors = auditFloorCoverage();
      const exhaustive = await auditExhaustiveRoutes((message) => {
        if (statusElement) statusElement.textContent = message;
      }, run);
      if (run.cancelled) throw AUDIT_CANCELLED;
      const routes = [...standardRoutes, ...exhaustive.routes];
      latestReport = {
        ...latestReport,
        generatedAt: new Date().toISOString(),
        sampledWalkablePoints: exhaustive.samples.length,
        pairRouteTests: exhaustive.routes.length,
        routes,
        floors,
        customTests: [],
        adaWarnings: [],
      };
      latestReport.adaWarnings = [...new Set(latestReport.routes.flatMap((route) => route.adaWarnings))];
      latestReport.adaWarnings.push(...latestReport.floors.flatMap((floor) => floor.warnings));
      latestReport.adaWarnings = [...new Set(latestReport.adaWarnings)];
      renderReport();
      return latestReport;
    } catch (error) {
      if (error === AUDIT_CANCELLED) {
        resetDebug();
        if (statusElement) statusElement.textContent = 'Audit stopped. Press R to start a new audit.';
        return latestReport;
      }
      throw error;
    } finally {
      if (activeAudit === run) {
        activeAudit = null;
        if (runButton) {
          runButton.disabled = false;
          runButton.textContent = 'Run exhaustive audit';
        }
      }
    }
  };

  const runCustomTest = (destination: WalkPoint) => {
    const custom = evaluateRoute({ name: `Custom click → (${destination.x.toFixed(2)}, ${destination.y.toFixed(2)}, ${destination.z.toFixed(2)})`, start: getCurrentPosition(), end: destination });
    latestReport = { ...latestReport, generatedAt: new Date().toISOString(), customTests: [...latestReport.customTests, custom], adaWarnings: [...new Set([...latestReport.adaWarnings, ...custom.adaWarnings])] };
    renderReport();
    return custom;
  };

  const exportButton = document.querySelector('#export-report') as HTMLButtonElement | null;
  exportButton?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(latestReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `town-hall-walkability-${new Date().toISOString().replaceAll(':', '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  const levelButtons = document.querySelectorAll<HTMLButtonElement>('[data-level]');
  const setLevel = (level: string) => {
    const band = FLOOR_BANDS.find((candidate) => candidate.id === level);
    for (const mesh of meshes) {
      const original = originalVisibility.get(mesh) ?? true;
      if (level === 'All' || !band) {
        mesh.visible = original;
        continue;
      }
      const bounds = new THREE.Box3().setFromObject(mesh);
      mesh.visible = original && bounds.max.y >= band.min && bounds.min.y <= band.max;
    }
    for (const button of levelButtons) button.dataset.active = button.dataset.level === level ? 'true' : 'false';
  };
  for (const button of levelButtons) button.addEventListener('click', () => setLevel(button.dataset.level ?? 'All'));

  return { runStandardTests, runCustomTest, setLevel, getLatestReport: () => latestReport };
}
