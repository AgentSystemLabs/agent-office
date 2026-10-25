import './structure.css';
import type { Department, OfficeStructure, OfficeZone } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal, toast } from './dom';

const CHOICE = 'agent-office-zone';

async function structure(): Promise<OfficeStructure> {
  const response = await fetch('/api/zones', { cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again' : 'Could not load office zones');
  return response.json() as Promise<OfficeStructure>;
}

async function mutate(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<OfficeStructure> {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json() as OfficeStructure & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Could not save office structure');
  return data;
}

export function selectedZone(zones: readonly OfficeZone[]): string {
  const saved = localStorage.getItem(CHOICE);
  return zones.some((z) => z.id === saved) ? saved! : 'main';
}

/** Zone and department navigation shared by 3D and /lite. Floor travel remains the existing path. */
export function openStructure(go: (floorId: string) => void) {
  const body = h('div.structure-body', {}, 'Loading office structure…');
  const panel = h('section.modal.structure-window', { 'aria-label': 'Office zones' }, h('header', {}, h('h2', {}, '🏢 AI Office')), body);
  const modal = openModal(panel);
  let data: OfficeStructure | undefined;
  let zoneId = 'main';

  const fail = (err: unknown) => toast((err as Error).message, 'error');
  const save = async (url: string, method: 'POST' | 'PATCH', value: unknown) => {
    try { data = await mutate(url, method, value); render(); return true; } catch (err) { fail(err); return false; }
  };

  function editor(d: Department) {
    const name = h('input', { type: 'text', value: d.name, maxlength: 100, 'aria-label': 'Department name' }) as HTMLInputElement;
    const color = h('input', { type: 'color', value: d.color, 'aria-label': 'Department color' }) as HTMLInputElement;
    const enabled = h('input', { type: 'checkbox', 'aria-label': 'Enabled' }) as HTMLInputElement;
    enabled.checked = d.enabled;
    enabled.disabled = d.id === 'software-engineering';
    const form = h('form.structure-edit', {}, h('label', {}, 'Name', name), h('label', {}, 'Color', color), h('label', {}, 'Enabled', enabled), h('button.btn.primary', { type: 'submit' }, 'Save'));
    const editModal = openModal(h('section.modal.structure-editor', { 'aria-label': `Edit ${d.name}` }, h('header', {}, h('h2', {}, `Edit ${d.name}`)), form));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void save(`/api/departments/${encodeURIComponent(d.id)}`, 'PATCH', { name: name.value, color: color.value, enabled: enabled.checked }).then((ok) => { if (ok) editModal.close(); });
    });
  }

  function render() {
    if (!data) return;
    if (!data.zones.some((z) => z.id === zoneId)) zoneId = 'main';
    const zone = data.zones.find((z) => z.id === zoneId)!;
    const tabs = h('nav.structure-tabs', { 'aria-label': 'Office zones' }, ...data.zones.map((z) => h('button.btn', {
      type: 'button', 'aria-pressed': String(z.id === zoneId), class: z.id === zoneId ? 'primary' : '',
      onclick: () => { zoneId = z.id; localStorage.setItem(CHOICE, zoneId); render(); },
    }, z.name)));
    const departments = data.departments.filter((d) => d.zoneId === zoneId);
    const sections = departments.map((d) => {
      const floors = store.floors.filter((f) => data!.floorDepartments[f.id] === d.id);
      const card = h('section.structure-department', { style: `border-left-color:${d.color}` },
        h('div.structure-department-head', {}, h('strong', {}, `${d.icon ?? '🏢'} ${d.name}`),
          store.me.admin ? h('button.btn', { type: 'button', onclick: () => editor(d) }, 'Edit') : null),
        ...floors.map((f) => h('button.btn.structure-floor', { type: 'button', disabled: !!f.cloning, onclick: () => { modal.close(); go(f.id); } }, f.name)),
        floors.length ? null : h('span.structure-empty', {}, 'No projects yet'),
      );
      return card;
    });
    const assign = store.me.admin && store.floors.length ? assignment(data) : null;
    const add = store.me.admin ? addDepartment() : null;
    body.replaceChildren(tabs, h('p.structure-note', {}, zone.type === 'training' ? 'Training Campus is organizational only. Workers are not sandboxed yet.' : 'Main Office projects and departments.'), ...sections, ...(assign ? [assign] : []), ...(add ? [add] : []));
  }

  function assignment(view: OfficeStructure) {
    const floors = h('select', { 'aria-label': 'Project' }) as HTMLSelectElement;
    floors.replaceChildren(...store.floors.filter((f) => !f.cloning).map((f) => h('option', { value: f.id }, f.name)));
    const depts = h('select', { 'aria-label': 'Department' }) as HTMLSelectElement;
    depts.replaceChildren(...view.departments.filter((d) => d.enabled).map((d) => h('option', { value: d.id }, `${d.zoneId}: ${d.name}`)));
    floors.addEventListener('change', () => { depts.value = view.floorDepartments[floors.value] ?? 'software-engineering'; });
    depts.value = view.floorDepartments[floors.value] ?? 'software-engineering';
    const form = h('form.structure-assign', {}, h('h3', {}, 'Assign project'), floors, depts, h('button.btn.primary', { type: 'submit' }, 'Assign'));
    form.addEventListener('submit', (event) => { event.preventDefault(); void save('/api/floor-department', 'POST', { floorId: floors.value, departmentId: depts.value }); });
    return form;
  }

  function addDepartment() {
    const slug = h('input', { type: 'text', placeholder: 'slug', required: true, maxlength: 40, pattern: '[a-z0-9][a-z0-9-]*', 'aria-label': 'Department slug' }) as HTMLInputElement;
    const name = h('input', { type: 'text', placeholder: 'Name', required: true, maxlength: 100, 'aria-label': 'Department name' }) as HTMLInputElement;
    const form = h('form.structure-add', {}, h('h3', {}, 'Add department'), slug, name, h('button.btn', { type: 'submit' }, 'Add'));
    form.addEventListener('submit', (event) => { event.preventDefault(); void save('/api/departments', 'POST', { zoneId, slug: slug.value, name: name.value, color: zoneId === 'training' ? '#76a88a' : '#6175b5' }); });
    return form;
  }

  void structure().then((view) => { if (!modal.backdrop.isConnected) return; data = view; zoneId = selectedZone(view.zones); render(); }).catch((err) => { body.textContent = (err as Error).message; });
}
