#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { officeEnv } from './office-queue.js';

export const HELP = `office-deliver --help
office-deliver < completion.json

Run after a PR is merged, from the PR or Issues agent. Account for EVERY current issue checkbox in order.
JSON: {"issue":286,"pr":297,"head":"40-character reviewed PR head SHA","summary":"What was implemented","technicalEvidence":"Exact tested commit and results","implementationComplete":true,"remainingImplementation":[],"criteria":[{"text":"Exact issue checkbox text","kind":"implemented","evidence":"File/test proving this requirement"},{"text":"Exact manual-check checkbox text","kind":"manual","test":{"title":"Check pistol pose","category":"Rift","steps":"Use two headsets...","expected":"Pistol sits in the hand"}}]}

For an existing checklist entry use "testId":"its saved ID" instead of "test". It must link to this issue or PR. Optional "manualTests":[...] adds checks not listed as issue checkboxes.

Only use when implementation is complete. Human playtests are saved unchecked before the issue is closed; queue completion is recorded durably. A partial PR, unresolved implementation, draft or failed checks must not be certified. The command never starts tasks or workers. Retry the SAME payload after a transient failure; existing human checkmarks are preserved.`;

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return; }
  if (argv.length) throw new Error('Use office-deliver < completion.json, or --help');
  const body = readFileSync(0, 'utf8').replace(/^\uFEFF/, '');
  JSON.parse(body);
  const env = officeEnv(process.env);
  const url = new URL('/office/deliver', env.url);
  url.searchParams.set('worker', env.worker);
  const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${env.token}`, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(180000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Office returned ${response.status}`);
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(err => { console.error(err.message); process.exitCode = 1; });
