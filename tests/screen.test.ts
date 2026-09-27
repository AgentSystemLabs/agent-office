import test from 'node:test';
import assert from 'node:assert/strict';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import { screenSnapshot } from '../src/server/screen.js';

function terminal() {
  const term = new headless.Terminal({ cols: 80, rows: 10, scrollback: 100, allowProposedApi: true });
  const ser = new serialize.SerializeAddon();
  term.loadAddon(ser as any);
  const snapshot = screenSnapshot(term, ser);
  const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve));
  return { term, snapshot, write };
}

/** A fresh terminal fed a snapshot ends up with the mouse the way the snapshot left it. */
async function restored(snapshot: string) {
  const t = terminal();
  await t.write(snapshot);
  return t;
}

test('a snapshot keeps the SGR mouse encoding OpenCode switches on, so the wheel still reaches it', async () => {
  const { write, snapshot } = terminal();
  // What OpenCode prints on start: the alternate screen, every mouse tracking mode, then SGR reports.
  await write('\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006hhello');
  const snap = snapshot();
  assert.match(snap, /\x1b\[\?1003h/);
  assert.match(snap, /\x1b\[\?1006h/);

  const again = await restored(snap);
  assert.equal(again.term.modes.mouseTrackingMode, 'any');
  assert.match(again.snapshot(), /\x1b\[\?1006h/, 'the encoding survives a second hop (pty host, then office, then browser)');
});

test('switching the encoding off, or a full reset, leaves it out of the snapshot', async () => {
  const off = terminal();
  await off.write('\x1b[?1000h\x1b[?1006h\x1b[?1006l');
  assert.doesNotMatch(off.snapshot(), /\x1b\[\?1006h/);

  const reset = terminal();
  await reset.write('\x1b[?1000h\x1b[?1006h\x1bc');
  assert.doesNotMatch(reset.snapshot(), /\x1b\[\?1006h/);
});

test('a terminal without the mouse snapshots as before', async () => {
  const { write, snapshot } = terminal();
  await write('plain output\r\n');
  assert.doesNotMatch(snapshot(), /\x1b\[\?10(0[0-6]|1[56])h/);
});
