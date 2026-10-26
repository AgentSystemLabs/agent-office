import type { WorkerProfile } from './worker-profiles.js';

/** Team membership is separate from running processes. Active workers already have an avatar. */
export function waitingProfiles(profiles: WorkerProfile[], workers: Iterable<{ name: string }>): WorkerProfile[] {
  const active = new Set([...workers].map(worker => worker.name));
  return profiles.filter(profile => !active.has(profile.name));
}
