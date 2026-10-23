import { h, openModal, type Modal } from '../../ui/dom';

/** The parent owns the visible inspector. This sentinel only uses the normal world-focus lifecycle. */
function openSentinel(): Modal {
  const modal = openModal(h('div', { 'aria-hidden': 'true' }), {
    doing: 'reading a Pocket conversation', reading: true,
    escCloses: false, closeButton: false, backdropCloses: false,
  });
  modal.backdrop.style.display = 'none';
  modal.backdrop.style.pointerEvents = 'none';
  return modal;
}

export class PocketOverlay {
  private modal?: Pick<Modal, 'close'>;
  get open(): boolean { return !!this.modal; }
  constructor(private create: () => Pick<Modal, 'close'> = openSentinel) {}
  set(open: boolean): void {
    if (open) this.modal ??= this.create();
    else this.close();
  }
  close(): void {
    const modal = this.modal;
    this.modal = undefined;
    modal?.close();
  }
}

export const pocketOverlay = new PocketOverlay();
