import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { draftMaintenanceIssue, parseIssueDraft } from '../src/server/maintenance-issue-draft.js';

test('issue drafts reject malformed, missing and oversized model output', () => {
  for (const output of ['no JSON', 'null', '{}', '{"title":"ok","body":""}', JSON.stringify({ title: 'x'.repeat(201), body: 'ok' }), JSON.stringify({ title: 'ok', body: 'x'.repeat(20001) })]) {
    assert.throws(() => parseIssueDraft(output), /Issue writer returned/);
  }
  assert.deepEqual(parseIssueDraft('{"title":" Better lighting ","body":" Acceptance criteria "}'), { title: 'Better lighting', body: 'Acceptance criteria' });
});

test('issue writing uses Luna and the source sandbox, validates output and rejects CLI failures', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-issue-writer-'));
  try {
    const cli = path.join(dir, 'codex');
    const argsFile = path.join(dir, 'args');
    const fake = (response: string, exit = 0) => {
      writeFileSync(cli, `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' "$@" > '${argsFile}'\ncat <<'RESPONSE'\n${response}\nRESPONSE\nexit ${exit}\n`);
      chmodSync(cli, 0o755);
    };
    const expected = { title: 'Improve office lighting', body: '## Scope\nUpdate src/client/world lighting.\n## Acceptance criteria\nThe room stays readable.' };
    fake(JSON.stringify(expected));
    const opts = { codex: cli, env: { PATH: '/usr/bin:/bin', AGENT_OFFICE_SOURCE: dir, AGENT_OFFICE_MAINTENANCE_MODEL: 'another-model' } };
    assert.deepEqual(await draftMaintenanceIssue('lighting', 'Make it brighter', opts), expected);
    const args = readFileSync(argsFile, 'utf8');
    assert.match(args, /exec\n--model\ngpt-6-luna\n--sandbox\nread-only/);
    assert.match(args, /--ephemeral/);
    assert.match(args, /Read README.md/);
    assert.match(args, /Make it brighter/);
    fake('not JSON');
    await assert.rejects(draftMaintenanceIssue('lighting', '', opts), /invalid JSON/);
    fake(JSON.stringify(expected), 1);
    await assert.rejects(draftMaintenanceIssue('lighting', '', opts), /Could not draft issue/);
    await assert.rejects(draftMaintenanceIssue('', '', opts), /Use a title/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
