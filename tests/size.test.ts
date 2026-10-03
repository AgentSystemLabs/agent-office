// The size guard: no source file grows past a line budget, so the hubs the office was split out of
// can't grow back. A file that gets too long is split along the registries (docs/code-layout.md).
//
// The files are the ones git knows about under src/ (tracked, or new and not ignored), never a walk
// of the folder, so a worktree checked out inside this one can't trip it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');

/** The most lines a source file (.ts or .css under src/) may have. */
const BUDGET = 600;

/**
 * The files that were already over the budget when it came in, each with the lines it had then as
 * its ceiling. They may shrink, never grow past it. One that drops to the budget or under comes off
 * this list, so the list only ever gets shorter; nothing new goes on it.
 */
const CEILINGS: Readonly<Record<string, number>> = {
  'src/server/dsh.ts': 1148,
  'src/server/workers/manager.ts': 1029,
  'src/client/features/rooftop/world.ts': 989,
  'src/client/world/sky.ts': 966,
  'src/server/meetings.ts': 764,
  'src/client/world/holiday.ts': 702,
  'src/client/features/dog/world.ts': 702,
  'src/client/world/character/person.ts': 694,
  'src/server/signins.ts': 660,
  'src/client/dnb.ts': 641,
  'src/client/features/golf/world.ts': 635,
  'src/client/features/bargames/world.ts': 617,
  'src/client/world/city.ts': 613,
  'src/client/world/costumes.ts': 603,
};

const SPLIT = 'Split it along the registries instead (see docs/code-layout.md).';

/** Every .ts and .css file under src/ that git knows about and that's there on disk. */
function sources(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src'], { cwd: root, encoding: 'utf8' });
  return [...new Set(out.split('\0'))].filter((f) => /\.(ts|css)$/.test(f) && existsSync(path.join(root, f))).sort();
}

/** Its lines, as `wc -l` counts them (and a last one without a newline too). */
function linesOf(file: string): number {
  const text = readFileSync(path.join(root, file), 'utf8');
  if (!text) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

test(`no source file is over ${BUDGET} lines, and none of the ones already over grows`, () => {
  const files = sources();
  assert.ok(files.length > 400, `found only ${files.length} source files under src/`);
  const over: string[] = [];
  for (const file of files) {
    const lines = linesOf(file);
    const ceiling = CEILINGS[file];
    if (ceiling === undefined && lines > BUDGET) over.push(`${file} is ${lines} lines, over the ${BUDGET}-line budget. ${SPLIT}`);
    if (ceiling !== undefined && lines > ceiling) over.push(`${file} is ${lines} lines, past its ceiling of ${ceiling} (tests/size.test.ts). ${SPLIT}`);
  }
  assert.equal(over.length, 0, `\n${over.join('\n')}`);
});

test('the list of files over the budget only gets shorter', () => {
  const files = new Set(sources());
  const stale: string[] = [];
  for (const file of Object.keys(CEILINGS)) {
    if (!files.has(file)) stale.push(`${file} is gone: take it off CEILINGS in tests/size.test.ts (its pieces are held to the ${BUDGET}-line budget).`);
    else if (linesOf(file) <= BUDGET) stale.push(`${file} is down to ${linesOf(file)} lines, within the ${BUDGET}-line budget: take it off CEILINGS in tests/size.test.ts.`);
  }
  assert.equal(stale.length, 0, `\n${stale.join('\n')}`);
});
