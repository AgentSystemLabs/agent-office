import test from 'node:test';
import assert from 'node:assert/strict';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import { screenSnapshot, withoutFullScreen } from '../src/server/screen.js';

function terminal() {
  const term = new headless.Terminal({ cols: 80, rows: 10, scrollback: 100, allowProposedApi: true });
  const ser = new serialize.SerializeAddon();
  term.loadAddon(ser as any);
  let fullScreen = false;
  const snapshot = screenSnapshot(term, ser, () => (fullScreen = true));
  const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve));
  return { term, snapshot, write, fullScreen: () => fullScreen };
}

/** What a worker printed, as the office's own copy of its terminal sees it. */
const printed = (data: string) => withoutFullScreen(data, 10);

/** A full-screen agent's lines, entering the full-screen buffer in the same write as its first frame. */
function tui(lines: string[], clear = true) {
  return `\x1b[?1049h${clear ? '\x1b[H\x1b[2J' : ''}${lines.map((l) => `${l}\r\n`).join('')}`;
}

/** The rows the terminal is showing right now, top first. */
function screen(term: headless.Terminal) {
  const buf = term.buffer.active;
  const rows: string[] = [];
  for (let y = 0; y < term.rows; y++) rows.push(buf.getLine(buf.viewportY + y)?.translateToString(true).trimEnd() ?? '');
  while (rows.length && !rows[rows.length - 1]) rows.pop();
  return rows;
}

/** Every line the terminal still holds, scrollback included. */
function transcript(term: headless.Terminal) {
  const buf = term.buffer.normal;
  const lines: string[] = [];
  for (let y = 0; y < buf.length; y++) lines.push(buf.getLine(y)?.translateToString(true).trimEnd() ?? '');
  return lines.filter(Boolean);
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

test('a full-screen agent keeps the transcript it scrolled past, not just the last screenful', async () => {
  const { term, write, snapshot } = terminal();
  const lines = Array.from({ length: 25 }, (_, i) => `agent said ${i + 1}`);
  await write(printed(tui(lines)));

  assert.deepEqual(screen(term), lines.slice(-(term.rows - 1)), 'the screen is the last screenful either way');
  assert.equal(transcript(term).length, 25, 'but nothing it scrolled past is thrown away');

  // Which is what survives a restart, and what searching a worker's terminal reads.
  const again = await restored(snapshot());
  assert.ok(transcript(again.term).includes('agent said 1'), 'the snapshot carries the first line, not the tenth');
  assert.ok(transcript(again.term).includes('agent said 25'));
});

test('a full-screen agent still gets the blank screen it switched to', async () => {
  const t = terminal();
  await t.write('the shell prompt\r\n');
  // It asks for the full-screen buffer and draws one row, without clearing it itself.
  await t.write(printed('\x1b[?1049hrow 9 only'));
  assert.ok(!screen(t.term).some((r) => r.includes('shell prompt')), 'no ghost of what was there before');
  assert.deepEqual(screen(t.term), ['row 9 only']);
  assert.ok(transcript(t.term).includes('the shell prompt'), 'but the shell prompt is still there to scroll back to');
});

test('the blank screen arrives before the frame, so it wipes no frame', async () => {
  // The mode and the first frame come in one write, as an agent paints its opening screen.
  const t = terminal();
  await t.write(printed('\x1b[?1049hpainting now'));
  assert.deepEqual(screen(t.term), ['painting now']);
});

test('the office is told when a worker went full-screen, and the mouse encoding still rides along', async () => {
  const t = terminal();
  await t.write('plain output\r\n');
  assert.equal(t.fullScreen(), false);

  // A scrollback written before withoutFullScreen existed still carries the mode, replayed as a
  // prelude. The handler is the backstop, and shares a sequence with the mouse encoding it must not
  // quietly replace.
  await t.write('\x1b[?1049h\x1b[?1006h');
  assert.equal(t.fullScreen(), true);
  assert.match(t.snapshot(), /\x1b\[\?1006h/);

  await t.write('\x1b[?1006l\x1b[?1049l');
  assert.doesNotMatch(t.snapshot(), /\x1b\[\?1006h/);
  assert.equal(t.term.buffer.active.type, 'normal', 'leaving it changes nothing, because it was never entered');
});

test('output that never mentions the full-screen buffer is left exactly as it was', () => {
  for (const data of ['plain output\r\n', '\x1b[?1006h\x1b[?1000l', 'no modes here']) assert.equal(withoutFullScreen(data), data);
  // What viewers get is untouched, so their terminal still switches buffers as it should.
  const raw = '\x1b[?1049hframe';
  assert.notEqual(withoutFullScreen(raw, 10), raw);
  assert.equal(withoutFullScreen(raw, 10).includes('\x1b[?1049h'), false);
});
