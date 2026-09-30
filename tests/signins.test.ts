import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SignIns, type ForgeAs } from '../src/server/signins.js';

// Everyone's own sign-ins (see server/signins.ts): the Claude plan their workers run on, and the
// GitHub or Bitbucket account the office acts as for them. The bit case is the awkward one: bb has
// no configuration directory and no environment credentials, so an account's sign-in lives under a
// home folder of its own, and a sign-in is a pasted Atlassian API token rather than a page.

const ACCOUNT = 'sam1234';

interface Fixture {
  dataDir: string;
  calls: { cli: string; args: string[]; home?: string; userprofile?: string }[];
  signins(roles?: Record<string, 'admin' | 'member'>): SignIns;
  signinsFor(which: 'github' | 'bitbucket'): ForgeAs | undefined | string;
}

/**
 * A fake gh and bb on PATH, so the sign-ins are run without a real account on either. Each one
 * remembers it was signed in by leaving a file in the home folder it was given, which is what makes
 * a per-account sign-in visible: the office's own home and an account's are not the same folder.
 */
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.SIGNIN_LOG, JSON.stringify({ cli: process.argv[1].split('/').pop(), args: a, home: process.env.HOME, userprofile: process.env.USERPROFILE }) + '\\n');
const mark = path.join(process.env.HOME || '', '.signed-in');
if (a[0] === 'auth' && a[1] === 'status') {
  if (!fs.existsSync(mark)) { process.stdout.write(JSON.stringify({ authenticated: false })); process.exit(1); }
  process.stdout.write(JSON.stringify({ authenticated: true, user: { username: 'sam', displayName: 'Sam' } }));
  process.exit(0);
}
if (a[0] === 'api' && a[1] === 'user') { process.stdout.write('"sam"\\n'); process.exit(0); }
if (a[0] === 'auth' && a[1] === 'login') {
  let typed = '';
  process.stdin.on('data', (d) => (typed += d));
  process.stdin.on('end', () => {
    fs.writeFileSync(process.env.SIGNIN_LOG + '.token', typed);
    fs.mkdirSync(process.env.HOME, { recursive: true });
    fs.writeFileSync(mark, 'sam');
    process.exit(0);
  });
  process.stdin.resume();
  return;
}
if (a[0] === 'auth' && a[1] === 'logout') { fs.rmSync(mark, { force: true }); process.exit(0); }
process.exit(0);
`;

function fixture(t: { after(fn: () => void): void }): Fixture {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'agent-office-signins-')));
  const bin = path.join(root, 'bin');
  const dataDir = path.join(root, 'office');
  mkdirSync(bin, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(bin, 'gh'), FAKE, { mode: 0o755 });
  writeFileSync(path.join(bin, 'bb'), FAKE, { mode: 0o755 });
  const log = path.join(root, 'signins.jsonl');
  writeFileSync(log, '');
  const saved = { PATH: process.env.PATH, SIGNIN_LOG: process.env.SIGNIN_LOG, GH_TOKEN: process.env.GH_TOKEN };
  process.env.PATH = `${bin}${path.delimiter}${saved.PATH ?? ''}`;
  process.env.SIGNIN_LOG = log;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const roles: Record<string, 'admin' | 'member'> = { [ACCOUNT]: 'admin' };
  // The office's own environment, as childEnv() builds it: the machine's, with its home folder.
  const officeEnv = () => ({ ...process.env, HOME: '/home/office' });
  const signins = (r = roles) => new SignIns(dataDir, null, path.join(bin, 'gh'), path.join(bin, 'bb'), officeEnv, (id) => r[id] === 'admin', () => {});
  return {
    dataDir,
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    signins,
    signinsFor: (which) => signins().forgeAs(ACCOUNT, which),
  } as Fixture;
}

test('an account signs in to Bitbucket by pasting a username and an Atlassian API token', async (t) => {
  const f = fixture(t);
  const token = 'ATBB' + 'x'.repeat(30);
  assert.equal(await f.signins().token(ACCOUNT, 'bitbucket', `sam ${token}`), undefined);
  const [call] = f.calls().filter((c) => c.cli === 'bb' && c.args[1] === 'login');
  assert.deepEqual(call.args, ['auth', 'login', '--username', 'sam', '--with-token'], 'the token goes on stdin, never in the arguments');
  // bb only reads credentials from its own file, so it's given a home folder of the account's own.
  assert.ok(call.home && call.home.startsWith(path.join(f.dataDir, 'homes', ACCOUNT, 'bb')), `bb was given ${call.home}`);
  assert.equal(readFileSync(`${process.env.SIGNIN_LOG}.token`, 'utf8'), `${token}\n`, 'and the token reached it on stdin');
  assert.equal(f.signins().state(ACCOUNT).bitbucket.how, 'login', 'a pasted token is kept as an own sign-in, like GitHub’s');
});

test('a Bitbucket sign-in says what is wrong rather than passing it on to bb', async (t) => {
  const f = fixture(t);
  const token = 'ATBB' + 'x'.repeat(30);
  assert.match((await f.signins().token(ACCOUNT, 'bitbucket', `#sam ${token}`)) ?? '', /username and token/);
  assert.match((await f.signins().token(ACCOUNT, 'bitbucket', 'sam ghp_something_that_is_not_a_bitbucket_token')) ?? '', /Atlassian API token/);
  assert.match((await f.signins().token(ACCOUNT, 'bitbucket', 'sam')) ?? '', /Atlassian API token/);
  assert.equal(f.calls().length, 0, 'bb is never run with something that cannot be a token');
});

test('Bitbucket has no sign-in page the office can hand out, so it says so instead of starting one', (t) => {
  const f = fixture(t);
  assert.match(f.signins().start(ACCOUNT, 'bitbucket') ?? '', /paste an Atlassian API token/);
  assert.equal(f.calls().length, 0);
});

test('once signed in, the office acts on Bitbucket as them, in that account’s own home folder', async (t) => {
  const f = fixture(t);
  await f.signins().token(ACCOUNT, 'bitbucket', `sam ${'ATBB' + 'y'.repeat(30)}`);
  await f.signins().look(ACCOUNT, true);
  const as = f.signins().forgeAs(ACCOUNT, 'bitbucket');
  assert.equal(typeof as, 'object');
  const who = as as ForgeAs;
  assert.equal(who.kind, 'bitbucket');
  assert.equal(who.name, 'sam', 'comments from the office show up under that name');
  assert.equal(f.signins().bitbucketLogin(ACCOUNT), 'sam');
  assert.ok(who.env.HOME?.startsWith(path.join(f.dataDir, 'homes', ACCOUNT, 'bb')), 'the run keeps to the account’s own bb config');
  assert.notEqual(who.env.HOME, '/home/office', 'and not the office machine’s own home');
  assert.equal(f.signins().ready(ACCOUNT, 'bitbucket'), true, 'so nobody is stopped at the door for it');
});

test('GitHub and Bitbucket sign-ins are kept apart: one does not stand in for the other', async (t) => {
  const f = fixture(t);
  await f.signins().token(ACCOUNT, 'bitbucket', `sam ${'ATBB' + 'z'.repeat(30)}`);
  await f.signins().look(ACCOUNT, true);
  assert.equal(typeof f.signins().forgeAs(ACCOUNT, 'github'), 'string', 'standing on a GitHub floor, a Bitbucket sign-in is no use');
  assert.match(String(f.signins().forgeAs(ACCOUNT, 'github')), /Sign in to GitHub first/);
  assert.equal(f.signins().githubLogin(ACCOUNT), undefined);
});

test('an admin may use the office machine’s own sign-ins, and then the office runs with its own home', (t) => {
  const f = fixture(t);
  const signins = f.signins();
  signins.useOffice(ACCOUNT, 'bitbucket');
  assert.equal(signins.state(ACCOUNT).bitbucket.how, 'office');
  assert.equal(signins.forgeAs(ACCOUNT, 'bitbucket'), undefined, 'no per-account environment is needed');
});

test('signing out of Bitbucket clears the account’s own bb credentials', async (t) => {
  const f = fixture(t);
  const signins = f.signins();
  await signins.token(ACCOUNT, 'bitbucket', `sam ${'ATBB' + 'q'.repeat(30)}`);
  await signins.look(ACCOUNT, true);
  assert.equal(signins.state(ACCOUNT).bitbucket.status, 'ok');
  await signins.signOut(ACCOUNT, 'bitbucket');
  assert.equal(signins.state(ACCOUNT).bitbucket.how, 'login');
  assert.equal(signins.state(ACCOUNT).bitbucket.status, 'none', 'and the next look finds nobody signed in');
  const home = path.join(f.dataDir, 'homes', ACCOUNT, 'bb');
  assert.ok(existsSync(home), 'the folder stays; only the credentials in it go');
  assert.ok(!existsSync(path.join(home, '.signed-in')), 'and the credentials are gone');
});
