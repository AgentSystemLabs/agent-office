import { h, openModal } from '../../ui/dom';
import './ui.css';

export function elevatorWait(name: string, leave: () => void) {
  const destination = h('h2', {}, name);
  const status = h('p.floor-wait-status', { role: 'status', 'aria-live': 'polite' }, 'Calling your floor…');
  const emergency = h('button.btn.floor-wait-emergency', { type: 'button', hidden: true, onclick: leave }, 'Emergency · let me out');
  const elapsed = h('span.floor-wait-time', {}, '0 seconds');
  const cabin = h('div.modal.floor-wait', { role: 'dialog', 'aria-modal': true, 'aria-label': 'Elevator loading' },
    h('header', {}, h('span', {}, '🛗 Elevator')),
    h('div.floor-wait-display', {}, h('span', {}, 'NEXT STOP'), destination),
    h('div.floor-wait-doors', { 'aria-hidden': true }, h('span'), h('span')),
    status, h('p.floor-wait-help', {}, 'Preparing the floor before the doors open. Soft elevator music follows your sound settings.'),
    h('div.floor-wait-footer', {}, elapsed, emergency),
  );
  const modal = openModal(cabin, { backdropCloses: false, doing: '🛗 waiting for the floor', onClose: leave });
  modal.backdrop.classList.add('floor-wait-backdrop');
  const started = performance.now();
  const timer = window.setInterval(() => { elapsed.textContent = `${Math.floor((performance.now() - started) / 1000)} seconds`; }, 250);
  return {
    destination: (name: string) => { destination.textContent = name; },
    status: (text: string) => { status.textContent = text; },
    emergency: (error?: unknown) => {
      emergency.hidden = false;
      status.textContent = error ? 'This floor could not finish preparing. Use Emergency to leave.' : 'Taking longer than expected. You can leave using Emergency.';
    },
    close: () => { clearInterval(timer); modal.close(); },
  };
}
