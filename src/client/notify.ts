// Getting your attention when the office isn't the tab you're looking at: desktop notifications
// for workers that need input or finish (the tab title counts them too, see main.ts).

import type { WorkerInfo } from '../shared/protocol';
import { alertDetail } from '../shared/status';

export type NotifyPermission = NotificationPermission | 'unsupported';

/** What the browser says about notifications from the office. They need https or localhost. */
export function notifyPermission(): NotifyPermission {
  if (!('Notification' in window) || !window.isSecureContext) return 'unsupported';
  return Notification.permission;
}

/** Shows the browser's permission prompt; call it from a click or key press. */
export async function askNotifyPermission(): Promise<NotifyPermission> {
  if (notifyPermission() !== 'default') return notifyPermission();
  try {
    await Notification.requestPermission();
  } catch {
    // an old Safari that only takes a callback, or the prompt was blocked
  }
  return notifyPermission();
}

/** Waiting on a person: needs input, or finished its turn and nobody has looked yet. */
export function waitingOnSomeone(w: WorkerInfo): w is WorkerInfo & { status: 'needs_input' | 'done' } {
  return w.status === 'needs_input' || (w.status === 'done' && !w.acked);
}

export class DesktopNotifier {
  /** The notification up for each worker, to take down once it's handled. */
  private shown = new Map<string, Notification>();

  constructor(
    private enabled: () => boolean,
    /** What a click on a worker's notification does: in the 3D office, over to its desk with its terminal open. */
    private openWorker: (workerId: string) => void,
  ) {
    // Back in the office, which shows who's waiting by itself.
    window.addEventListener('focus', () => this.closeAll());
  }

  /** A worker just started waiting on input, or finished its turn. */
  alert(w: WorkerInfo & { status: 'needs_input' | 'done' }) {
    if (!this.enabled() || notifyPermission() !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return;
    const title = w.status === 'done' ? `✅ ${w.name} is done` : `🙋 ${w.name} needs you`;
    const body = [w.task?.name, alertDetail(w)].filter(Boolean).join('\n');
    this.shown.get(w.id)?.close();
    // Needs input blocks the worker, so that one stays up until you deal with it.
    const n = this.show(title, { body, tag: `worker-${w.id}`, requireInteraction: w.status === 'needs_input' });
    if (!n) return;
    n.onclick = () => {
      window.focus();
      n.close();
      this.openWorker(w.id);
    };
    n.onclose = () => {
      if (this.shown.get(w.id) === n) this.shown.delete(w.id);
    };
    this.shown.set(w.id, n);
  }

  /** Takes down notifications for workers nobody needs to get to any more (someone else did). */
  sync(workers: Map<string, WorkerInfo>) {
    for (const [id, n] of this.shown) {
      const w = workers.get(id);
      if (w && waitingOnSomeone(w)) continue;
      n.close();
      this.shown.delete(id);
    }
  }

  /** What one looks like, from ⚙️ Settings. */
  sample() {
    const n = this.show('🔔 Notifications are on', { body: 'This is how a worker that needs you or is done gets your attention while you are in another tab. Click one to go straight to that worker.' });
    if (!n) return;
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }

  private closeAll() {
    for (const n of this.shown.values()) n.close();
    this.shown.clear();
  }

  private show(title: string, opts: NotificationOptions): Notification | null {
    try {
      return new Notification(title, { icon: '/favicon.svg', ...opts });
    } catch {
      // Chrome on Android only shows them from a service worker
      return null;
    }
  }
}
