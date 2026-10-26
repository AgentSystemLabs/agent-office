import type { WorkerProfile } from '../../shared/worker-profiles';
import { store } from '../state';
import { h, openModal } from './dom';
import './worker-profiles.css';

/** Named profiles are local configuration, separate from online human accounts. */
export function openWorkerProfiles(focusId?: string) {
  const content = h('div.modal.worker-profiles');
  const status = h('p.dim', {}, 'Loading worker profiles…');
  const list = h('div.worker-profile-grid');
  content.append(h('header', {}, h('h2', {}, 'Named workers')), status, list);
  const modal = openModal(content, { doing: 'looking at the worker team' });
  const floor = store.floor;
  if (!floor) { status.textContent = 'Choose a project floor first.'; return; }
  const endpoint = `/api/worker-profiles?floor=${encodeURIComponent(floor)}`;
  void fetch(endpoint).then(async response => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load profiles');
    const profiles: WorkerProfile[] = result.profiles;
    status.textContent = profiles.length ? `${profiles.length} profiles · ${profiles.filter(profile => profile.enabled).length} available · ${profiles.filter(profile => !profile.enabled).length} held. Model and effort come from each profile.` : 'No named profiles configured for this floor.';
    for (const profile of profiles) {
      const card = h('article.worker-profile');
      const current = [...store.workers.values()].find(worker => worker.name === profile.name);
      const route = [profile.provider || 'Unspecified CLI', profile.model || 'Unspecified model', profile.effort || 'Unspecified effort'].join(' · ');
      card.append(h('h3', {}, profile.name), h('p', {}, profile.description || 'No role specified'), h('code.worker-profile-route', {}, route));
      if (profile.holds.length) card.append(h('p.worker-profile-hold', {}, profile.holds.join('; ')));
      if (current) card.append(h('p', {}, `At ${current.deskId} · ${current.status}`));
      const hire = h('button.btn', { disabled: !profile.enabled || !!current, onclick: () => requestTask(profile) }, current ? 'Already at a desk' : profile.enabled ? 'Give a task' : 'Held by source');
      card.append(hire);
      list.append(card);
      if (profile.id === focusId) {
        card.tabIndex = -1;
        requestAnimationFrame(() => { card.scrollIntoView({ block: 'center' }); card.focus(); });
      }
    }
  }).catch(error => { status.textContent = error.message; });

  function requestTask(profile: WorkerProfile) {
    const prompt = h('textarea.worker-profile-prompt', { rows: 6, placeholder: `Task for ${profile.name}`, 'aria-label': `Task for ${profile.name}` }) as HTMLTextAreaElement;
    const error = h('p.worker-profile-hold');
    const task = h('div.modal.worker-profile-task', {}, h('header', {}, h('h2', {}, profile.name)), h('p', {}, `${profile.model} · ${profile.effort}`), prompt, error);
    const taskModal = openModal(task);
    const submit = h('button.btn.primary', { onclick: async () => {
      if (!prompt.value.trim()) { prompt.focus(); return; }
      (submit as HTMLButtonElement).disabled = true;
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: profile.id, prompt: prompt.value }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not start worker');
        taskModal.close(); modal.close();
      } catch (failure) { error.textContent = (failure as Error).message; (submit as HTMLButtonElement).disabled = false; }
    } }, 'Start at a desk');
    task.append(h('footer', {}, submit));
    prompt.focus();
  }
}
