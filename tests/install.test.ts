// install.sh against a local release tarball (AGENT_OFFICE_TARBALL), with a stand-in npm so nothing
// is downloaded. Releases ship their dependency versions as npm-shrinkwrap.json (release.yml).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const script = path.join(import.meta.dirname, '..', 'install.sh');

// A stand-in for npm 12, whose `npm ci` reads only package-lock.json: a package with just an
// npm-shrinkwrap.json fails with the error from #278. It notes which lockfiles each `ci` saw.
const FAKE_NPM = `#!/bin/sh
[ "$1" = ci ] || exit 0
echo "ci shrinkwrap=$([ -f npm-shrinkwrap.json ] && echo yes || echo no) lock=$([ -f package-lock.json ] && echo yes || echo no)" >>"$FAKE_NPM_LOG"
if [ ! -f package-lock.json ]; then
  echo "npm error code EUSAGE" >&2
  echo "npm error The \\\`npm ci\\\` command can only install with an existing package-lock.json" >&2
  exit 1
fi
`;

test('install.sh installs a release whose lockfile is npm-shrinkwrap.json with an npm that reads only package-lock.json (#278)', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const pkg = path.join(root, 'release', 'package');
  mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'agent-office', version: '0.1.999' }));
  const shrinkwrap = JSON.stringify({ name: 'agent-office', version: '0.1.999', lockfileVersion: 3, packages: {} });
  writeFileSync(path.join(pkg, 'npm-shrinkwrap.json'), shrinkwrap);
  writeFileSync(path.join(pkg, 'bin', 'agent-office.js'), '');
  const tarball = path.join(root, 'agent-office.tgz');
  execFileSync('tar', ['-czf', tarball, '-C', path.join(root, 'release'), 'package']);

  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'npm'), FAKE_NPM);
  chmodSync(path.join(bin, 'npm'), 0o755);
  const log = path.join(root, 'npm.log');
  const installDir = path.join(root, 'office');

  execFileSync('bash', [script], {
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      HOME: root,
      AGENT_OFFICE_TARBALL: tarball,
      AGENT_OFFICE_INSTALL_DIR: installDir,
      AGENT_OFFICE_BIN_DIR: '',
      AGENT_OFFICE_INSTALL_ONLY: '1',
      FAKE_NPM_LOG: log,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.equal(readFileSync(log, 'utf8'), 'ci shrinkwrap=yes lock=yes\n', 'npm ci sees the release lockfile under both names');
  const installed = path.join(installDir, 'versions', 'v0.1.999');
  assert.ok(existsSync(path.join(installed, '.installed')), 'the release is installed');
  assert.equal(readFileSync(path.join(installed, 'package-lock.json'), 'utf8'), shrinkwrap, 'package-lock.json is the shrinkwrap');
  assert.equal(readFileSync(path.join(installDir, 'current'), 'utf8'), 'v0.1.999\n');
});
