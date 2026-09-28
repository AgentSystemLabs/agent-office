import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/client/package.json only exists so the IWSDK CLI treats the Vite root as the XR test
// workspace; the CLI that actually runs is the root install. Its lockfile must pin that same build.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = 'node_modules/@iwsdk/cli';

type Lock = { packages: Record<string, { version?: string; integrity?: string; devDependencies?: Record<string, string> }> };
const json = <T>(file: string): T => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')) as T;

const rootLock = json<Lock>('package-lock.json');
const shim = json<{ devDependencies: Record<string, string> }>('src/client/package.json');
const shimLock = json<Lock>('src/client/package-lock.json');

test('the src/client shim pins the @iwsdk/cli the root lockfile installs', () => {
  const installed = rootLock.packages[CLI];
  assert.ok(installed?.version, 'root package-lock.json has no @iwsdk/cli');
  assert.equal(shim.devDependencies['@iwsdk/cli'], installed.version, 'src/client/package.json');
  assert.equal(shimLock.packages[CLI]?.version, installed.version, 'src/client/package-lock.json version');
  assert.equal(shimLock.packages[CLI]?.integrity, installed.integrity, 'src/client/package-lock.json integrity');
});

test('the src/client lockfile matches its package.json', () => {
  assert.deepEqual(shimLock.packages['']?.devDependencies, shim.devDependencies);
});
