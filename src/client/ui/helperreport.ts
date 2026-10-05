import type { WorkerInfo } from '../../shared/protocol';
import { isAsleep, isBusy } from '../../shared/status';
import { h } from './dom';

/** Findings stay visible independently of the helper's temporary model. */
export function renderHelperReport(panel: HTMLElement, worker: WorkerInfo, deliver: () => void) {
  const expanded = panel.querySelector('details')?.open;
  const report = worker.helperReport;
  panel.classList.toggle('hidden', !report);
  if (!report) { panel.replaceChildren(); return; }
  const status = report.state === 'submitted' ? 'Submitted after the worker stopped · reading not confirmed'
    : report.state === 'interrupting' ? 'Stopping the current turn…'
    : report.state === 'failed' ? report.error ?? 'Delivery failed; findings retained'
    : 'Findings ready · not queued in the agent';
  const button = h('button.btn.primary', { type: 'button', disabled: report.state === 'submitted' || report.state === 'interrupting' || isAsleep(worker.status) || worker.status === 'starting' || worker.status === 'needs_input' }, isBusy(worker.status) ? 'Interrupt and deliver report' : 'Deliver report');
  button.addEventListener('click', deliver);
  panel.replaceChildren(h('strong', {}, `🆘 ${report.helperName}'s report`), h('span', {}, status), button,
    h('details', { open: expanded }, h('summary', {}, 'Read findings'), h('pre', {}, report.text)),
    ...(worker.status === 'needs_input' ? [h('small', {}, 'Answer the open question or permission request first.')] : []));
}
