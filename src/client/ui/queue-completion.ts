import './queue-completion.css';
import type { QueueTask } from '../../shared/protocol';
import type { Net } from '../net';
import { h } from './dom';
import { confirmDialog } from './prompt';

/** These actions require the person to choose; no blocked task is automatically requeued. */
export function attentionActions(task: QueueTask, net: Net): HTMLElement[] {
  return [
    h('button.btn', { type: 'button', onclick: () => net.send({ t: 'queue.continue', taskId: task.id }), title: 'Continue this task with its assigned worker; busy workers are left alone' }, 'Continue'),
    h('button.btn', { type: 'button', onclick: () => confirmDialog('Confirm task completion?', 'Only confirm if the requested result was actually delivered. This records your decision; it does not claim that manual playtests passed.', 'Mark complete', () => net.send({ t: 'queue.confirm', taskId: task.id })) }, 'Mark complete'),
  ];
}
