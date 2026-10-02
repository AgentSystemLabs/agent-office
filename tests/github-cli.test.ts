import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findGitHubCli, githubCli } from '../src/server/github-cli.js';

function fixture(run: (root: string, executable: (dir: string) => string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'office-gh-'));
  try {
    run(root, (dir) => {
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'gh.exe');
      writeFileSync(file, '', { mode: 0o755 });
      return file;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('Windows finds a GitHub CLI installed after the launcher captured PATH', () => fixture((root, exe) => {
  const expected = exe(path.join(root, 'GitHub CLI'));
  assert.equal(findGitHubCli({ Path: path.join(root, 'old-path'), ProgramFiles: root }, 'win32'), expected);
}));

test('Windows preserves the GitHub CLI selected by PATH before installation fallbacks', () => fixture((root, exe) => {
  const preferred = exe(path.join(root, 'custom'));
  exe(path.join(root, 'GitHub CLI'));
  assert.equal(findGitHubCli({ PATH: `"${path.dirname(preferred)}"`, ProgramFiles: root }, 'win32'), preferred);
}));

test('Windows checks per-user WinGet installs and ignores directories named gh.exe', () => fixture((root, exe) => {
  mkdirSync(path.join(root, 'GitHub CLI', 'gh.exe'), { recursive: true });
  const expected = exe(path.join(root, 'Microsoft', 'WinGet', 'Links'));
  assert.equal(findGitHubCli({ ProgramFiles: root, localappdata: root }, 'win32'), expected);
}));

test('an absent installation and Unix keep ordinary gh command lookup', () => {
  assert.equal(findGitHubCli({}, 'win32'), undefined);
  assert.equal(findGitHubCli({ ProgramFiles: 'ignored' }, 'linux'), undefined);
  assert.equal(githubCli({}), 'gh');
});
