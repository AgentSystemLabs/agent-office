import type { WorkerProject } from '../../shared/protocol';
import { normalizeIssueRepository, sameRepository } from '../../shared/issue-repositories';
import { h, openModal, toast } from './dom';

interface ProjectResponse {
  project?: WorkerProject;
}

const pending = new Map<string, Promise<WorkerProject | undefined>>();
const known = new Map<string, WorkerProject>();

function repositoryName(repository: string): string {
  return normalizeIssueRepository(repository) ?? repository;
}

async function getProject(repository: string): Promise<WorkerProject | undefined> {
  const response = await fetch(`/api/repository-project?repository=${encodeURIComponent(repository)}`, { credentials: 'same-origin' });
  const body = (await response.json().catch(() => ({}))) as ProjectResponse & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  if (body.project) known.set(body.project.repository.toLowerCase(), body.project);
  return body.project;
}

async function saveProject(repository: string, directory: string, clone: boolean): Promise<WorkerProject> {
  const response = await fetch('/api/repository-project', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repository, directory, clone }),
  });
  const body = (await response.json().catch(() => ({}))) as ProjectResponse & { error?: string };
  if (!response.ok || !body.project) throw new Error(body.error ?? `HTTP ${response.status}`);
  known.set(body.project.repository.toLowerCase(), body.project);
  return body.project;
}

function chooseProject(repository: string): Promise<WorkerProject | undefined> {
  return new Promise((resolve) => {
    const name = repositoryName(repository);
    const directory = h('input', { type: 'text', placeholder: '/path/to/checkout', 'aria-label': 'Local checkout path' }) as HTMLInputElement;
    const existing = h('button.btn.primary', { type: 'button' }, 'Use checkout');
    const clone = h('button.btn', { type: 'button' }, 'Clone repository');
    const error = h('p.repository-project-error');
    const cancel = h('button.btn', { type: 'button' }, 'Cancel');
    const el = h(
      'div.modal.repository-project',
      { role: 'dialog', 'aria-label': `Choose checkout for ${name}` },
      h('header', {}, h('h2', {}, `📁 ${name}`)),
      h(
        'div.body',
        {},
        h('p', {}, 'This repository has no local checkout mapped in the office yet.'),
        h('label', {}, 'Checkout path', directory),
        h('p.repository-project-hint', {}, 'Use an existing checkout, or enter a destination and clone it from GitHub.'),
        error,
      ),
      h('footer', {}, h('span.grow'), cancel, existing, clone),
    );
    let result: WorkerProject | undefined;
    const modal = openModal(el, { onClose: () => resolve(result) });
    const submit = async (shouldClone: boolean) => {
      const dir = directory.value.trim();
      if (!dir) {
        directory.setCustomValidity('Enter a local checkout path.');
        directory.reportValidity();
        return;
      }
      directory.setCustomValidity('');
      existing.disabled = true;
      clone.disabled = true;
      error.textContent = shouldClone ? 'Cloning…' : 'Checking checkout…';
      try {
        const project = await saveProject(name, dir, shouldClone);
        result = project;
        modal.close();
      } catch (err) {
        existing.disabled = false;
        clone.disabled = false;
        error.textContent = (err as Error).message;
      }
    };
    existing.addEventListener('click', () => void submit(false));
    clone.addEventListener('click', () => void submit(true));
    cancel.addEventListener('click', () => modal.close());
    setTimeout(() => directory.focus(), 30);
  });
}

/** Resolve the local project for an issue repository, asking the user only once when unknown. */
export function ensureIssueProject(repository?: string): Promise<WorkerProject | undefined> {
  if (!repository) return Promise.resolve(undefined);
  const name = repositoryName(repository);
  const existing = [...pending].find(([key]) => sameRepository(key, name));
  if (existing) return existing[1];
  const task = getProject(name)
    .then((project) => project ?? chooseProject(name))
    .catch((err) => {
      toast(`Couldn't resolve ${name}: ${(err as Error).message}`, 'error');
      return undefined;
    })
    .finally(() => pending.delete(name));
  pending.set(name, task);
  return task;
}

/** Look up a known mapping for display without opening the path/clone prompt. */
export function lookupIssueProject(repository?: string): Promise<WorkerProject | undefined> {
  if (!repository) return Promise.resolve(undefined);
  const name = repositoryName(repository);
  const cached = known.get(name.toLowerCase());
  return cached ? Promise.resolve(cached) : getProject(name);
}
