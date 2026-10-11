import { officeQueue } from './office-queue.js';
import { officeWorkers } from './office-workers.js';
import { officeDecisions } from './office-decisions.js';
import { officePlaytests } from './office-playtests.js';
export const OFFICE_HOOK_ROUTES = [
  { matches: (path: string) => path === '/office/queue', handle: officeQueue },
  { matches: (path: string) => path === '/office/workers' || path.startsWith('/office/workers/'), handle: officeWorkers },
  { matches: (path: string) => path === '/office/decisions', handle: officeDecisions },
  { matches: (path: string) => path === '/office/playtests', handle: officePlaytests },
];
