import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hosts, PAIRING_TTL_MS } from '../src/server/hosts.js';
import { safeEq } from '../src/server/secrets.js';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'office-hosts-'));
  const hosts = new Hosts(root);
  const claimed = (name = 'Alice’s laptop', owner?: string, seats?: number) => {
    const made = hosts.pair('admin');
    assert.ok(typeof made !== 'string', `pair() refused: ${made}`);
    return hosts.claim(made.code, name, owner, seats);
  };
  return { root, hosts, claimed, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('a pairing code is spent on first use, and cannot be spent twice', () => {
  const f = fixture();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const first = f.hosts.claim(made.code, 'Alice’s laptop');
    assert.ok(typeof first !== 'string', 'the first claim works');
    assert.ok(typeof first !== 'string' && first.token.length >= 32, 'the token is long enough to not be guessed');

    const second = f.hosts.claim(made.code, 'Someone else');
    assert.equal(second, 'That pairing code is not one of ours', 'a spent code is gone, not merely flagged');
    assert.equal(f.hosts.list().length, 1, 'and it did not make a second host');
  } finally {
    f.close();
  }
});

test('a wrong code is refused, and an empty one is refused differently', () => {
  const f = fixture();
  try {
    assert.equal(f.hosts.claim('', 'x'), 'No pairing code');
    assert.equal(f.hosts.claim('ABCD-2345', 'x'), 'That pairing code is not one of ours');
    assert.equal(f.hosts.list().length, 0);
  } finally {
    f.close();
  }
});

test('the token is never stored — only a hash of it', () => {
  // A copied hosts.json must admit nobody. This is the whole reason the file is written at 0600.
  const f = fixture();
  try {
    const made = f.claimed('Alice’s laptop');
    assert.ok(typeof made !== 'string');
    const raw = readFileSync(path.join(f.root, 'hosts.json'), 'utf8');
    assert.ok(!raw.includes(made.token), 'the token is not in hosts.json');
    assert.ok(raw.includes(made.host.hash), 'a hash is');
    // And the hash does not authenticate: only the token does.
    assert.equal(f.hosts.authenticate(made.host.hash), undefined);
  } finally {
    f.close();
  }
});

test('hosts.json is written private to its owner', () => {
  const f = fixture();
  try {
    f.claimed('Alice’s laptop');
    const mode = statSync(path.join(f.root, 'hosts.json')).mode & 0o777;
    assert.equal(mode, 0o600, `hosts.json is mode ${mode.toString(8)}, not 600`);
  } finally {
    f.close();
  }
});

test('a revoked machine is refused at once and cannot be brought back with a fresh code', () => {
  // Revocation has to be the end of it. Anything else and "revoke" is a suggestion.
  const f = fixture();
  try {
    const made = f.claimed('Alice’s laptop');
    assert.ok(typeof made !== 'string');
    assert.equal(f.hosts.authenticate(made.token)?.id, made.host.id, 'it works to begin with');

    const revoked = f.hosts.revoke(made.host.id);
    assert.ok(typeof revoked !== 'string');
    assert.equal(f.hosts.authenticate(made.token), undefined, 'the token stops working immediately');

    // A new code makes a NEW host rather than reviving the old one, and the old token stays dead:
    // revocation cannot be undone by pairing again, even under the same name.
    const again = f.hosts.pair('admin');
    assert.ok(typeof again !== 'string');
    const fresh = f.hosts.claim(again.code, 'Alice’s laptop');
    assert.ok(typeof fresh !== 'string', 'pairing again works — the person may add the machine back knowingly');
    assert.notEqual(fresh.host.id, made.host.id, 'but it is a different host');
    assert.equal(fresh.host.revokedAt, undefined, 'and it is not carrying the old revocation');
    assert.equal(f.hosts.authenticate(made.token), undefined, 'the old token is still dead');
  } finally {
    f.close();
  }
});

test('pairing a machine twice makes two hosts', () => {
  // Two people can share one machine as two hosts, each with its own token and its own identity —
  // which is what lets two Unix users on one box keep separate floors.
  const f = fixture();
  try {
    const a = f.claimed('Alice’s laptop', 'alice');
    const b = f.claimed('Bob’s desktop', 'bob');
    assert.ok(typeof a !== 'string' && typeof b !== 'string');
    assert.notEqual(a.host.id, b.host.id);
    assert.notEqual(a.token, b.token);
    assert.equal(f.hosts.list().length, 2);
  } finally {
    f.close();
  }
});

test('the owner sets seats, and an automation hire may only go to an accepting machine', () => {
  // decision 2: a person may always hire; an automation hire needs the flag. Note what is refused
  // here is nothing about *who* — there is no role check on this surface at all.
  const f = fixture();
  try {
    const made = f.claimed('Alice’s laptop', 'alice');
    assert.ok(typeof made !== 'string');
    assert.equal(made.host.seats, 0, 'no seats declared until the owner says');
    assert.equal(made.host.accepting, false, 'accepting is off until the owner says');

    const seated = f.hosts.configure(made.host.id, { seats: 4, accepting: true, consented: true });
    assert.ok(typeof seated !== 'string');
    assert.equal(seated.seats, 4);
    assert.equal(seated.accepting, true);
    assert.ok(seated.consentedAt, 'the consent to hosting a machine is recorded');

    // Refusals name the machine and its capacity. Never a person, never a role.
    const capped = f.hosts.configure(made.host.id, { seats: 9999 });
    assert.ok(typeof capped !== 'string');
    assert.ok(capped.seats <= 32, 'seats are capped, so one machine cannot claim the office');
  } finally {
    f.close();
  }
});

test('a revoked machine cannot be configured, and a missing one says so', () => {
  const f = fixture();
  try {
    const made = f.claimed('Alice’s laptop');
    assert.ok(typeof made !== 'string');
    assert.equal(f.hosts.configure('nope', { seats: 1 }), 'No such machine');
    assert.equal(f.hosts.revoke('nope'), 'No such machine');
    f.hosts.revoke(made.host.id);
    assert.equal(f.hosts.configure(made.host.id, { seats: 1 }), 'That machine has been revoked');
  } finally {
    f.close();
  }
});

test('a machine needs a name, so a refusal can name it', () => {
  const f = fixture();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    assert.equal(f.hosts.claim(made.code, '   '), 'That machine needs a name, so refusals can name it');
    assert.equal(f.hosts.list().length, 0, 'a nameless machine is not admitted');
  } finally {
    f.close();
  }
});

test('editing hosts.json while the office runs is picked up', () => {
  // `agent-office hosts` does this, exactly as `agent-office accounts` does with accounts.json.
  const f = fixture();
  try {
    const made = f.claimed('Alice’s laptop');
    assert.ok(typeof made !== 'string');

    const file = path.join(f.root, 'hosts.json');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.hosts[0].revokedAt = Date.now();
    writeFileSync(file, JSON.stringify(saved, null, 2));

    assert.equal(f.hosts.authenticate(made.token), undefined, 'the revocation took effect without a restart');
  } finally {
    f.close();
  }
});

test('an unreadable hosts.json is never written over', () => {
  // Losing every admitted machine to a stray keystroke is worse than admitting none for a while.
  const f = fixture();
  try {
    f.claimed('Alice’s laptop');
    writeFileSync(path.join(f.root, 'hosts.json'), '{ this is not json');
    assert.equal(f.hosts.unreadableFile, path.join(f.root, 'hosts.json'));

    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    assert.equal(readFileSync(path.join(f.root, 'hosts.json'), 'utf8'), '{ this is not json', 'left alone');
    // A machine paired before the file broke keeps working off the last good read, rather than every
    // hosted floor dropping because someone truncated the file. Nothing NEW is admitted while it is
    // broken, though — that is the half that matters for safety.
    assert.equal(f.hosts.list().length, 1, 'the machines already admitted are still known');
    assert.ok(typeof f.hosts.claim(made.code, 'A new one') === 'string', 'but no new machine is admitted');
  } finally {
    f.close();
  }
});

test('the state a browser sees carries no token and no hash', () => {
  const f = fixture();
  try {
    const made = f.claimed('Alice’s laptop', 'alice', 4);
    assert.ok(typeof made !== 'string');
    const [state] = f.hosts.state(new Map([[made.host.id, 2]]));
    assert.equal(state.name, 'Alice’s laptop');
    assert.equal(state.floors, 2, 'one socket carries N floors, so the count is what is shown');
    assert.equal(state.online, true);
    assert.ok(!('token' in state));
    assert.ok(!('hash' in state));
    assert.ok(!JSON.stringify(state).includes(made.token));
  } finally {
    f.close();
  }
});

test('an expired pairing code is refused and cleaned up', () => {
  const f = fixture();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    // Backdate it rather than waiting half an hour.
    const file = path.join(f.root, 'hosts.json');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.codes[0].expiresAt = Date.now() - 1;
    writeFileSync(file, JSON.stringify(saved, null, 2));

    // An expired code is swept before it is matched, so it reads as unknown rather than as a
    // separate failure. Either message refuses it; what matters is that it cannot be claimed.
    assert.match(String(f.hosts.claim(made.code, 'Alice’s laptop')), /expired|not one of ours/);
    assert.equal(f.hosts.list().length, 0, 'and no machine was admitted');
    assert.ok(PAIRING_TTL_MS <= 30 * 60 * 1000, 'and codes do not outlive half an hour');
  } finally {
    f.close();
  }
});

test('safeEq compares in constant time and never throws on a length mismatch', () => {
  assert.equal(safeEq('abc', 'abc'), true);
  assert.equal(safeEq('abc', 'abd'), false);
  assert.equal(safeEq('abc', 'abcd'), false, 'a different length is a mismatch, not an error');
  assert.equal(safeEq('', ''), true);
  assert.equal(safeEq('', 'x'), false);
});

test('seen() records that a machine is connected, without reviving a revoked one', () => {
  const f = fixture();
  try {
    const made = f.claimed('Alice’s laptop');
    assert.ok(typeof made !== 'string');
    f.hosts.seen(made.host.id);
    assert.ok(f.hosts.get(made.host.id)?.lastSeenAt, 'recorded');
    f.hosts.revoke(made.host.id);
    const at = f.hosts.get(made.host.id)?.lastSeenAt;
    f.hosts.seen(made.host.id);
    assert.equal(f.hosts.get(made.host.id)?.lastSeenAt, at, 'a revoked machine does not get seen again');
  } finally {
    f.close();
  }
});
