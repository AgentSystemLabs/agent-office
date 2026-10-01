import type { GhIssue } from './protocol.js';

export const MAINTENANCE_QUEUE_LABEL = 'maintenance:queued';
export const maintenanceQueued = (issue: GhIssue) => issue.state === 'OPEN' && issue.labels.some(l => l.name === MAINTENANCE_QUEUE_LABEL);
export function maintenanceIssueColumns(items: GhIssue[]) {
  const progressing = (i: GhIssue) => i.assignees.length > 0 || i.labels.some(l => /progress|doing|wip|started/i.test(l.name));
  return [
    { title: '📥 Open', items: items.filter(i => i.state === 'OPEN' && !maintenanceQueued(i) && !progressing(i)) },
    { title: '⏳ Queued', items: items.filter(maintenanceQueued) },
    { title: '🚧 In progress', items: items.filter(i => i.state === 'OPEN' && !maintenanceQueued(i) && progressing(i)) },
    { title: '✅ Closed', items: items.filter(i => i.state !== 'OPEN') },
  ];
}
