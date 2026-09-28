import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;
const SKIP = new Set(['node_modules', 'dist', '.iwsdk']);
const INSTALLERS = ['install.sh', 'install.ps1'];

/** Set by the office for its own workers, or by the installers for themselves: not user settings. */
const INTERNAL = new Set(['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_HOOK_TOKEN', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_SESSION_ID', 'AGENT_OFFICE_CLAIM_TOKEN', 'AGENT_OFFICE_INSTALL_REFRESH']);
/** The operating system's own variables, read to find the shell and programs. */
const SYSTEM = new Set(['PATH', 'PATHEXT', 'SHELL', 'COMSPEC']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : SOURCE.test(e.name) ? [p] : [];
  });
}

/** Every variable named in src/, bin/ and the installers: process.env reads and AGENT_OFFICE_* names. */
function namesInCode(): Map<string, string> {
  const found = new Map<string, string>();
  const add = (name: string, file: string) => found.has(name) || found.set(name, path.relative(ROOT, file));
  for (const file of [...sourceFiles(path.join(ROOT, 'src')), ...sourceFiles(path.join(ROOT, 'bin'))]) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g)) add(m[1] ?? m[2], file);
    for (const m of text.matchAll(/\bAGENT_OFFICE_[A-Z0-9_]+/g)) add(m[0], file);
  }
  for (const name of INSTALLERS) {
    const file = path.join(ROOT, name);
    for (const m of readFileSync(file, 'utf8').matchAll(/\bAGENT_OFFICE_[A-Z0-9_]+/g)) add(m[0], file);
  }
  return found;
}

/** The variables .env.example lists, as `NAME=value` lines, commented out or not. */
function documented(): Set<string> {
  const text = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  return new Set([...text.matchAll(/^(?:#\s*)?([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

test('.env.example lists every setting the office and installers read', () => {
  const listed = documented();
  const missing = [...namesInCode()].filter(([name]) => !INTERNAL.has(name) && !SYSTEM.has(name) && !listed.has(name));
  assert.deepEqual(
    missing.map(([name, file]) => `${name} (${file})`),
    [],
    'add these to .env.example, or to INTERNAL / SYSTEM in this test if they are not user settings',
  );
});

test('.env.example lists nothing the code no longer reads', () => {
  const inCode = namesInCode();
  assert.deepEqual(
    [...documented()].filter((name) => !inCode.has(name)),
    [],
  );
});

test('.env.example leaves out the internal and system variables', () => {
  const listed = documented();
  assert.deepEqual(
    [...INTERNAL, ...SYSTEM].filter((name) => listed.has(name)),
    [],
  );
});

test('.gitignore keeps real .env files out of git but not .env.example', () => {
  const ignored = (file: string) => {
    try {
      execFileSync('git', ['check-ignore', '--quiet', '--no-index', file], { cwd: ROOT, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  for (const file of ['.env', '.env.local', '.env.production']) assert.equal(ignored(file), true, `${file} should be ignored`);
  assert.equal(ignored('.env.example'), false, '.env.example should be tracked');
});
