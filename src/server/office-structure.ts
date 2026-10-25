import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Department, OfficeStructure, OfficeZone } from '../shared/protocol.js';
import type { Building } from './building.js';

const SCHEMA = 1;
export const MAIN_ENGINEERING = 'software-engineering';
const names = [
  ['executive', 'Executive Center', '🏛️'],
  [MAIN_ENGINEERING, 'Software Engineering', '💻'],
  ['product', 'Product Management', '🧭'],
  ['research-data', 'Research & Data', '🔬'],
  ['design-media', 'Design & Media', '🎨'],
  ['marketing', 'Marketing', '📣'],
  ['sales-support', 'Sales & Customer Support', '🤝'],
  ['finance', 'Finance', '💰'],
  ['legal', 'Legal & Compliance', '⚖️'],
  ['operations', 'Operations', '⚙️'],
  ['knowledge', 'Knowledge Center', '📚'],
] as const;
const labs = [
  ['academy', 'Agent Academy', '🎓'],
  ['incubator', 'Project Incubator', '🌱'],
  ['sandbox', 'Sandbox Lab', '🧪'],
  ['evaluation', 'Evaluation Lab', '📊'],
  ['workflow', 'Workflow Lab', '🔀'],
  ['skills', 'Skill Workshop', '🛠️'],
  ['graduation', 'Graduation Gate', '🚪'],
] as const;

function defaults(): OfficeStructure {
  const departments: Department[] = [
    ...names.map(([slug, name, icon]) => ({ id: slug, slug, name, icon, zoneId: 'main', color: '#6175b5', enabled: true })),
    ...labs.map(([slug, name, icon]) => ({ id: `training-${slug}`, slug, name, icon, zoneId: 'training', color: '#76a88a', enabled: true })),
  ];
  const zones: OfficeZone[] = [
    { id: 'training', type: 'training', name: 'Training Campus', order: 0, departmentIds: departments.filter((d) => d.zoneId === 'training').map((d) => d.id) },
    { id: 'main', type: 'main', name: 'Main Office', order: 1, departmentIds: departments.filter((d) => d.zoneId === 'main').map((d) => d.id) },
  ];
  return { zones, departments, floorDepartments: {} };
}

const idOk = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v);
const colorOk = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
interface AuditEvent { at: number; actor: string; action: string; target: string }
type StoredStructure = OfficeStructure & { audit: AuditEvent[] };

function parse(input: unknown): StoredStructure {
  if (!record(input) || input.schemaVersion !== SCHEMA || !record(input.data)) throw new Error('Unsupported structure schema');
  const { zones, departments, floorDepartments, audit } = input.data;
  if (!Array.isArray(zones) || !Array.isArray(departments) || !record(floorDepartments)) throw new Error('Invalid structure data');
  const zIds = new Set<string>();
  const dIds = new Set<string>();
  const slugs = new Set<string>();
  for (const z of zones) {
    if (!record(z) || !idOk(z.id) || zIds.has(z.id) || (z.type !== 'main' && z.type !== 'training') || typeof z.name !== 'string' || !Number.isInteger(z.order) || !Array.isArray(z.departmentIds)) throw new Error('Invalid zone');
    zIds.add(z.id);
  }
  if (!zIds.has('main') || !zIds.has('training')) throw new Error('Default zones missing');
  for (const d of departments) {
    if (!record(d) || !idOk(d.id) || dIds.has(d.id) || !idOk(d.slug) || typeof d.name !== 'string' || !colorOk(d.color) || typeof d.enabled !== 'boolean' || typeof d.zoneId !== 'string' || !zIds.has(d.zoneId)) throw new Error('Invalid department');
    const key = `${d.zoneId}/${d.slug}`;
    if (slugs.has(key)) throw new Error('Duplicate department slug');
    dIds.add(d.id);
    slugs.add(key);
  }
  if (!dIds.has(MAIN_ENGINEERING)) throw new Error('Default engineering department missing');
  for (const z of zones) {
    if ((z.departmentIds as unknown[]).some((id) => typeof id !== 'string' || !dIds.has(id) || departments.find((d) => d.id === id)?.zoneId !== z.id)) throw new Error('Invalid zone departments');
  }
  for (const [floorId, deptId] of Object.entries(floorDepartments)) if (!idOk(floorId) || typeof deptId !== 'string' || !dIds.has(deptId)) throw new Error('Invalid floor assignment');
  if (audit !== undefined && (!Array.isArray(audit) || audit.some((e) => !record(e) || !Number.isFinite(e.at) || typeof e.actor !== 'string' || typeof e.action !== 'string' || typeof e.target !== 'string'))) throw new Error('Invalid audit record');
  return { zones: zones as OfficeZone[], departments: departments as Department[], floorDepartments: floorDepartments as Record<string, string>, audit: (audit ?? []) as AuditEvent[] };
}

/** Organizational metadata around Building. It never edits floors.json or worker state. */
export class OfficeStructureStore {
  private file: string;
  private data: StoredStructure = { ...defaults(), audit: [] };
  private writable = true;

  constructor(dataDir: string, private building: Pick<Building, 'list'>) {
    this.file = path.join(dataDir, 'zones.json');
    if (!existsSync(this.file)) {
      this.save();
    } else {
      try {
        this.data = parse(JSON.parse(readFileSync(this.file, 'utf8')));
      } catch (err) {
        this.writable = false;
        console.error(`agent-office: ${this.file} couldn't be loaded; structure edits disabled: ${(err as Error).message}`);
      }
    }
  }

  snapshot(): OfficeStructure {
    const floorDepartments = Object.fromEntries(this.building.list().map((f) => [f.id, this.data.floorDepartments[f.id] ?? MAIN_ENGINEERING]));
    return { zones: this.data.zones.map((z) => ({ ...z, departmentIds: [...z.departmentIds] })), departments: this.data.departments.map((d) => ({ ...d })), floorDepartments };
  }

  addDepartment(input: unknown, actor = 'system'): string | undefined {
    if (!this.writable) return 'Office structure is read-only until zones.json is repaired';
    if (!record(input) || !idOk(input.slug) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || typeof input.zoneId !== 'string' || !colorOk(input.color)) return 'Invalid department';
    if (!this.data.zones.some((z) => z.id === input.zoneId)) return 'Unknown zone';
    if (this.data.departments.some((d) => d.id === input.slug || (d.zoneId === input.zoneId && d.slug === input.slug))) return 'Department slug already exists';
    const d: Department = { id: input.slug, slug: input.slug, name: input.name.trim(), zoneId: input.zoneId, color: input.color, enabled: true };
    const next = structuredClone(this.data);
    next.departments.push(d);
    next.zones.find((z) => z.id === d.zoneId)!.departmentIds.push(d.id);
    return this.commit(next, { at: Date.now(), actor, action: 'department.add', target: d.id });
  }

  updateDepartment(id: string, input: unknown, actor = 'system'): string | undefined {
    if (!this.writable) return 'Office structure is read-only until zones.json is repaired';
    if (!record(input)) return 'Invalid department';
    const next = structuredClone(this.data);
    const d = next.departments.find((item) => item.id === id);
    if (!d) return 'Unknown department';
    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) return 'Invalid name';
      d.name = input.name.trim();
    }
    if (input.color !== undefined) {
      if (!colorOk(input.color)) return 'Invalid color';
      d.color = input.color;
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean' || (id === MAIN_ENGINEERING && !input.enabled)) return 'Invalid enabled state';
      d.enabled = input.enabled;
    }
    return this.commit(next, { at: Date.now(), actor, action: 'department.update', target: id });
  }

  assignFloor(floorId: string, departmentId: string, actor = 'system'): string | undefined {
    if (!this.writable) return 'Office structure is read-only until zones.json is repaired';
    if (!this.building.list().some((f) => f.id === floorId)) return 'Unknown floor';
    if (!this.data.departments.some((d) => d.id === departmentId && d.enabled)) return 'Unknown or disabled department';
    const next = structuredClone(this.data);
    if (departmentId === MAIN_ENGINEERING) delete next.floorDepartments[floorId];
    else next.floorDepartments[floorId] = departmentId;
    return this.commit(next, { at: Date.now(), actor, action: 'floor.assign', target: floorId });
  }

  private commit(next: StoredStructure, event: AuditEvent): string | undefined {
    const previous = this.data;
    next.audit.push(event);
    this.data = next;
    const error = this.save();
    if (error) this.data = previous;
    return error;
  }

  private save(): string | undefined {
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ schemaVersion: SCHEMA, data: this.data }, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      try { rmSync(tmp, { force: true }); } catch { /* keep original error */ }
      return `Could not save office structure: ${(err as Error).message}`;
    }
    return undefined;
  }
}
