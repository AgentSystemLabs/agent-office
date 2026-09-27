import test from 'node:test';
import assert from 'node:assert/strict';
import { commandAction, outputFailed, toolAction } from '../src/shared/actions.js';

test('tool calls map to what a worker acts out, across providers', () => {
  for (const [tool, action] of [
    ['Read', 'read'],
    ['Grep', 'read'],
    ['Glob', 'read'],
    ['read_file', 'read'],
    ['Edit', 'edit'],
    ['Write', 'edit'],
    ['MultiEdit', 'edit'],
    ['apply_patch', 'edit'],
    ['WebSearch', 'web'],
    ['WebFetch', 'web'],
    ['webfetch', 'web'],
    ['mcp__fetch__fetch', 'web'],
    ['mcp__github__create_issue', undefined],
    ['TodoWrite', undefined],
    ['Task', undefined],
    ['exec_command', undefined],
  ] as const)
    assert.equal(toolAction(tool), action, tool);
  assert.equal(toolAction('Bash', { command: 'npm test' }), 'test');
  assert.equal(toolAction('Bash', { command: 'git commit -m "wip"' }), undefined);
  assert.equal(toolAction(undefined), undefined);
});

test('shell commands that run tests or builds', () => {
  for (const cmd of [
    'npm test',
    'npm run build',
    'npm run test:unit -- --watch=false',
    'pnpm --silent typecheck',
    'yarn lint',
    'bun test',
    'cd web && npm run build 2>&1 | tail -20',
    'npx vitest run src/foo.test.ts',
    'NODE_ENV=test node --import tsx --test tests/*.test.ts',
    './node_modules/.bin/jest --ci',
    'python -m pytest -x tests/',
    'uv run pytest',
    'go test ./...',
    'cargo clippy --all-targets',
    'timeout 300 make -j8',
    './gradlew assemble',
    'npx tsc --noEmit',
  ])
    assert.equal(commandAction(cmd), 'test', cmd);
});

test('shell commands that only look at things', () => {
  for (const cmd of ['cat src/main.ts', 'rg -n "setStatus" src', 'grep -r foo . | head', 'cd src && ls -la', 'git --no-pager log --oneline -5', 'git -C ../other diff HEAD~1', 'sed -n 1,40p README.md', 'gh pr view 12 --comments'])
    assert.equal(commandAction(cmd), 'read', cmd);
});

test('other shell commands are just typing', () => {
  // A test file named in a read, a script called "test" echoed: neither runs tests.
  for (const cmd of ['git add -A && git commit -m "Add tests"', 'npm install', 'mkdir -p tests', 'echo "npm test"', 'rm -f build.log', 'git push origin HEAD'])
    assert.equal(commandAction(cmd), undefined, cmd);
  assert.equal(commandAction('cat tests/actions.test.ts'), 'read');
});

test('a failed run is told apart from a passing one by its summary', () => {
  for (const out of [
    'Tests:       2 failed, 14 passed, 16 total',
    ' Test Files  1 failed | 3 passed (4)',
    '# tests 40\n# pass 38\n# fail 2',
    '============ 3 failed, 10 passed in 1.20s ============',
    '  12 passing (40ms)\n  1 failing',
    '--- FAIL: TestLogin (0.00s)\nFAIL\tgithub.com/x/y\t0.01s',
    'test result: FAILED. 3 passed; 1 failed',
    "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    'npm ERR! Test failed.  See above for more details.',
  ])
    assert.equal(outputFailed(out), true, out);
  for (const out of [
    'Tests:       16 passed, 16 total',
    '# tests 40\n# pass 40\n# fail 0',
    '============ 10 passed in 1.20s ============',
    '  ✓ reports 3 errors when the input is empty',
    'Found 0 errors. Watching for file changes.',
    'ok  \tgithub.com/x/y\t0.01s',
  ])
    assert.equal(outputFailed(out), false, out);
});
