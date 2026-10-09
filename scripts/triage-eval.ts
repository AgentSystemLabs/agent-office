// Compares triage's answers on a floor with issues you labelled by hand.
//
//   npx tsx scripts/triage-eval.ts <project dir> [hand-labels.json]
//
// hand-labels.json (default <project>/.agent-office/triage-eval.json) is a list of
// { "number": 12, "type": "bug", "size": "s", "agentReady": true }, any field but number optional.
// Run the office with --triage in shadow mode first, so every open issue has been classified.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TriageCache } from '../src/server/triage/cache.js';
import { loadTriageConfig } from '../src/server/triage/config.js';
import { agreement, type HandLabel } from '../src/server/triage/eval.js';
import type { TriageAnswers } from '../src/shared/protocol.js';

const [project, file] = process.argv.slice(2);
if (!project) {
  console.error('usage: npx tsx scripts/triage-eval.ts <project dir> [hand-labels.json]');
  process.exit(2);
}
const dataDir = path.join(path.resolve(project), '.agent-office');
const hand = JSON.parse(readFileSync(file ?? path.join(dataDir, 'triage-eval.json'), 'utf8')) as HandLabel[];
const answers = new Map<number, TriageAnswers>();
for (const e of new TriageCache(dataDir).entries()) if (e.answers) answers.set(e.number, e.answers);
const threshold = loadTriageConfig(dataDir).thresholds.agentReady;
const a = agreement(hand, answers, threshold);
const pct = (n: number) => (Number.isNaN(n) ? '—' : `${Math.round(n * 100)}%`);

console.log(`${a.compared} of ${hand.length} hand-labelled issues have been classified`);
console.log(`type:        ${a.type.right}/${a.type.of} right (${pct(a.type.right / a.type.of)})`);
console.log(`size:        ${a.size.right}/${a.size.of} right (${pct(a.size.right / a.size.of)})`);
console.log(`agent-ready: precision ${pct(a.agentReady.precision)}, recall ${pct(a.agentReady.recall)} at ${threshold}`);
if (a.agentReady.falseYes.length) console.log(`  said ready but weren't: ${a.agentReady.falseYes.map((n) => `#${n}`).join(', ')}`);
console.log(a.agentReady.precision >= 0.9 ? '✅ precision is high enough to try auto-queue' : '⚠️  keep auto-queue off: a false yes wastes a whole agent run');
