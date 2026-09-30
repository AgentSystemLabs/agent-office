// A worker's terminal as the office mirrors it: a headless xterm, read off as screen frames for the
// browsers and as text for what's on it.
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import type { Run, WorkerInfo } from '../../shared/protocol.js';
import { FLAG_BOLD, FLAG_DIM, FLAG_INVERSE, RGB_FLAG } from '../../shared/protocol.js';
import { SCROLLBACK } from '../ptys.js';
import { screenSnapshot } from '../screen.js';
import type { Worker, WorkerEvents } from './types.js';

export type HeadlessTerminal = InstanceType<typeof headless.Terminal>;

/** How often each screen is sent whole, since diffs can be dropped for slow clients. */
const KEYFRAME_MS = 8000;

/**
 * A fresh screen for a worker's terminal, in place of the one it had, reading its progress reports
 * (`progress`, see ProviderAdapter.screen) and its title off it.
 */
export function newTerm(w: Worker, on: { progress?(busy: boolean): void; title(title: string): void }): HeadlessTerminal {
  const term = new headless.Terminal({ cols: w.info.cols, rows: w.info.rows, scrollback: SCROLLBACK, allowProposedApi: true });
  const ser = new serialize.SerializeAddon();
  term.loadAddon(ser as any);
  // OSC 9;4 progress (Claude Code emits it): 0 = idle, anything else = busy. Catches Esc-cancel,
  // which fires no Stop hook.
  const progress = on.progress;
  if (progress) {
    term.parser.registerOscHandler(9, (data: string) => {
      const m = /^4;(\d)/.exec(data);
      if (m) progress(m[1] !== '0');
      return true;
    });
  }
  term.onTitleChange((title: string) => on.title(title));
  w.term?.dispose();
  w.term = term;
  w.ser = ser;
  w.snapshot = screenSnapshot(term, ser);
  w.lastLines = [];
  w.screenDirty = true;
  w.fresh = undefined;
  return term;
}

/** Full screens for every running worker — sent to people as they walk in. */
export function fullScreens(workers: Iterable<Worker>) {
  const out: { workerId: string; frame: NonNullable<ReturnType<typeof snapshotScreen>> }[] = [];
  for (const w of workers) {
    if (!w.term) continue;
    const frame = snapshotScreen(w.term, []);
    if (frame) out.push({ workerId: w.info.id, frame });
  }
  return out;
}

/** Sends every screen that changed (see snapshotScreen), each looked at by `check` first. */
export function flushScreens(workers: Iterable<Worker>, events: WorkerEvents, check: (w: Worker) => void) {
  const now = Date.now();
  for (const w of workers) {
    if (!w.term) continue;
    // Diffs can be dropped for slow clients, so resend the whole screen now and then.
    if (now - w.keyframeAt > KEYFRAME_MS) {
      w.keyframeAt = now;
      w.lastLines = [];
      w.screenDirty = true;
    }
    if (!w.screenDirty) continue;
    w.screenDirty = false;
    check(w);
    const frame = snapshotScreen(w.term, w.lastLines);
    if (frame) events.screen(w.info.id, frame);
  }
}

/** The rows of the screen that changed since `last` (all of them when its size changed), or null when none did. */
export function snapshotScreen(term: HeadlessTerminal, last: string[]) {
  const buf = term.buffer.active;
  const cols = term.cols;
  const rows = term.rows;
  const full = last.length !== rows;
  const lines: Record<number, Run[]> = {};
  let changed = false;
  const cell = buf.getNullCell();
  for (let y = 0; y < rows; y++) {
    const line = buf.getLine(buf.viewportY + y);
    const runs: Run[] = [];
    if (line) {
      let cur: Run | null = null;
      for (let x = 0; x < cols; x++) {
        line.getCell(x, cell);
        const width = cell.getWidth();
        if (width === 0) continue;
        const ch = cell.getChars() || ' ';
        const fg = cell.isFgDefault() ? -1 : cell.isFgRGB() ? RGB_FLAG | cell.getFgColor() : cell.getFgColor();
        const bg = cell.isBgDefault() ? -1 : cell.isBgRGB() ? RGB_FLAG | cell.getBgColor() : cell.getBgColor();
        const flags = (cell.isBold() ? FLAG_BOLD : 0) | (cell.isInverse() ? FLAG_INVERSE : 0) | (cell.isDim() ? FLAG_DIM : 0);
        if (cur && cur[1] === fg && cur[2] === bg && cur[3] === flags) cur[0] += ch;
        else {
          cur = [ch, fg, bg, flags];
          runs.push(cur);
        }
      }
    }
    // Trim trailing default-styled whitespace to keep frames small.
    while (runs.length) {
      const r = runs[runs.length - 1];
      if (r[2] !== -1 || r[3] & FLAG_INVERSE) break;
      const trimmed = r[0].replace(/\s+$/, '');
      if (trimmed) {
        r[0] = trimmed;
        break;
      }
      runs.pop();
    }
    const key = JSON.stringify(runs);
    if (full || last[y] !== key) {
      lines[y] = runs;
      last[y] = key;
      changed = true;
    }
  }
  last.length = rows;
  if (!changed) return null;
  return { cols, rows, lines, full, cursor: [buf.cursorX, buf.cursorY] as [number, number] };
}

/** The text on screen, leaving out rows above buffer row `from`. */
export function screenText(term: HeadlessTerminal, from = 0): string {
  const buf = term.buffer.active;
  const out: string[] = [];
  for (let y = Math.max(0, from - buf.viewportY); y < term.rows; y++) out.push(buf.getLine(buf.viewportY + y)?.translateToString(true) ?? '');
  return out.join('\n');
}

/** What a browser opening the terminal of a worker that isn't running sees. */
export function offlineBanner(info: WorkerInfo): string {
  const hint = info.kind === 'shell' ? ' Press R to restart it.' : info.sessionId ? ' Press R to resume the session.' : '';
  return `\x1b[2m${info.name} is not running.${hint}\x1b[0m\r\n`;
}
