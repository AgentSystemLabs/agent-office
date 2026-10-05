// Screenshots the smartphone UI without booting the office: seeds the store with three workers and
// opens the phone on its contacts (or ?sms=1 to walk the real UI into Byte's SMS thread).
import '../styles/base.css';
import type { WorkerInfo } from '../../shared/protocol';
import { store } from '../state';
import { openSmartphone } from '../features/smartphone/ui';

function seed(): WorkerInfo[] {
  const now = Date.now();
  const base = { kind: 'agent' as const, acked: false, createdBy: 'Sam', cols: 80, rows: 24, viewers: [] as string[], viewerIds: [] as string[] };
  const workers: WorkerInfo[] = [
    { ...base, id: 'w1', deskId: 'd1', name: 'Byte', color: '#4f86f7', status: 'needs_input', waitingSince: now - 240_000, createdAt: now - 3_600_000, activity: 'Wants permission: Bash: npm test' },
    { ...base, id: 'w2', deskId: 'd2', name: 'Pixel', color: '#e07a5f', status: 'working', createdAt: now - 1_800_000, activity: 'Editing src/client' },
    { ...base, id: 'w3', deskId: 'd3', name: 'Mochi', color: '#81b29a', status: 'done', acked: true, waitingSince: now - 600_000, createdAt: now - 900_000, pr: { number: 12, url: 'https://example.com/pr/12' } },
  ];
  for (const w of workers) store.workers.set(w.id, w);
  return workers;
}

seed();
store.floor = 'f1';
// Like a browser without speech recognition (Firefox): no 🎤 on the composer, so the lab never
// touches the recognizer (whose on-device check crashes headless Chromium).
for (const k of ['SpeechRecognition', 'webkitSpeechRecognition'] as const) delete (window as unknown as Record<string, unknown>)[k];
openSmartphone({
  net: { send: () => {} },
  goToWorker: () => true,
  openWorkerTerminal: () => {},
  fixLostWorktree: () => {},
  sound: { phoneRing: () => {}, smsSwoosh: () => {}, dialBlip: () => {} },
});

// The SMS thread through the real taps: first contact, then its SMS button (or its Call button).
const params = new URLSearchParams(location.search);
if (params.has('sms') || params.has('call')) {
  const pick = (sel: string) => document.querySelector<HTMLElement>(sel);
  pick('.sp-contact')?.click();
  pick(params.has('call') ? '.sp-call' : '.sp-sms')?.click();
}

setTimeout(
  () => {
    ((window as unknown as { __ready: unknown }).__ready = { phone: params.has('sms') ? 'thread' : params.has('call') ? 'calling' : 'contacts' });
  },
  params.has('call') ? 1500 : 400,
);
