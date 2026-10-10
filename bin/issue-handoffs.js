/** A separate section, because directly assigned issues were never put in the waiting queue. */
export function formatDirectHandoffs(records = []) {
  if (!records.length) return '';
  return '\n\nDirect issue handoffs (not queued):\n' + records.map((r) => `issue #${r.issue} · ${r.status} · worker ${r.worker} (${r.workerId})${r.workerStatus ? ` · worker status ${r.workerStatus}` : ''} · handed by ${r.by}`).join('\n');
}
