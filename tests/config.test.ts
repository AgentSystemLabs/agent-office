import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, tlsFingerprintPem } from '../src/server/config.js';

/** loadConfig with a throwaway --home, turning process.exit into a throw so a bad flag can be tested. */
function load(t: { after(fn: () => void): void }, ...argv: string[]) {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-office-config-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const exit = process.exit;
  const error = console.error;
  const previousArgs = process.env.AGENT_OFFICE_AGENT_ARGS;
  const errors: string[] = [];
  process.exit = ((code?: number) => {
    throw new Error(`exit ${code}: ${errors.join('\n')}`);
  }) as typeof process.exit;
  console.error = (...args: unknown[]) => void errors.push(args.join(' '));
  delete process.env.AGENT_OFFICE_AGENT_ARGS;
  try {
    return loadConfig(['--home', home, '--password', 'x', ...argv]);
  } finally {
    process.exit = exit;
    console.error = error;
    if (previousArgs !== undefined) process.env.AGENT_OFFICE_AGENT_ARGS = previousArgs;
  }
}

test('--agent-args takes flags as its value, as the help shows', (t) => {
  assert.deepEqual(load(t, '--agent-args', '--model opus').agentArgs, ['--model', 'opus']);
  // ...and the flag after it is parsed as a flag again.
  assert.equal(load(t, '--agent-args', '--model opus', '--port', '4999').port, 4999);
});

test('--agent-args with nothing after it still needs a value', (t) => {
  assert.throws(() => load(t, '--agent-args'), /exit 2: agent-office: --agent-args needs a value/);
});

test('other flags still treat a leading -- as a missing value', (t) => {
  assert.throws(() => load(t, '--agent', '--agent-args', 'x'), /exit 2: agent-office: --agent needs a value/);
});

test('the default agent is droid', (t) => {
  const previous = process.env.AGENT_OFFICE_AGENT;
  delete process.env.AGENT_OFFICE_AGENT;
  t.after(() => {
    if (previous !== undefined) process.env.AGENT_OFFICE_AGENT = previous;
  });
  assert.equal(load(t).agentCmd, 'droid');
});

/** Canned self-signed cert (CN=agent-office-pin-test); the pin below is openssl ground truth. */
const PIN_TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDITCCAgmgAwIBAgIUBsPBcJLfrdtgmiAE8gk01rG04UEwDQYJKoZIhvcNAQEL
BQAwIDEeMBwGA1UEAwwVYWdlbnQtb2ZmaWNlLXBpbi10ZXN0MB4XDTI2MDkyODE0
MzY0OVoXDTI2MTAyODE0MzY0OVowIDEeMBwGA1UEAwwVYWdlbnQtb2ZmaWNlLXBp
bi10ZXN0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuNaZ+bTqQ5C4
wLnFz1FQnA+/fx/MFkf6IknLD+2khw4o0FfQ/hDQW6HyWFE7tYdmz1OYXEOFzX0f
Vyll5YDpE0ABfRBCTvkOWS8L/QB8iZz7nmvF5X7a2COziHx28xH5MClTu1XNz4Aa
CH+wwtTjDIwYv40s3d0C+92rtX/uBecEGxr3JREV5RRy24XAfwzP7aD1emPq4Frb
a1aTHMf+HVl4DIepVo5ZC7p7Aeq8BvRqEcbA0rP9voGKCbBaAu+qzWcZcG+IGG0b
P+txza0hsnC8JB7f8W3/ssmPkqBwcUIryvqqczQFKCk/tlGOxa2x/6RGcTyMRRIX
EaG8nLtQcQIDAQABo1MwUTAdBgNVHQ4EFgQUoS0GvHN/M2nfL15zMSdYPnyd2Ssw
HwYDVR0jBBgwFoAUoS0GvHN/M2nfL15zMSdYPnyd2SswDwYDVR0TAQH/BAUwAwEB
/zANBgkqhkiG9w0BAQsFAAOCAQEACctXHg0ZRUouNCNBwn19qgXKOgaKvaWWD9+S
lrkShxRJy/NeaCh3HbZ6rHEqIp0ZUtDqh+ofiPK99b7vgGoHgt1Zo8SjTaGjaE2+
dztYvhH94eIqH8KJpjW2sEBYxN0tiIN+3bLTqgA8fIMd0MUV/rUVMk8IROkJBjSu
ZdFLjNzwXLq4xYPZ6K6xnkOkSGtIQbZjvQb3vmyr4BexYDUJIENPrLbhJ2gAskQP
WrqBTMawNr1Yi/uX+V8p3qMKSnKyRD9J2wcvw/yRZlFNyzZ/O+UUUtjmsAq/Y3bS
rf98tAzDZ1lBRdPvQcIpoRjCNmwQLfrYLcmbCio9e7BT4N8E6g==
-----END CERTIFICATE-----`;
const PIN_TEST_PIN = 'sha256/gKUv3xNTJS02lTP3c8Qs2Y1P49/vwfdAnc40KnQGciY=';

test('tlsFingerprintPem hashes the DER bytes, matching openssl', () => {
  assert.equal(tlsFingerprintPem(PIN_TEST_CERT), PIN_TEST_PIN);
});

test('tlsFingerprintPem pins the leaf when the PEM bundles a chain', () => {
  assert.equal(tlsFingerprintPem(`${PIN_TEST_CERT}\n${PIN_TEST_CERT}`), PIN_TEST_PIN);
});

test('tlsFingerprintPem is undefined when the PEM holds no certificate', () => {
  assert.equal(tlsFingerprintPem(''), undefined);
  assert.equal(tlsFingerprintPem('not a pem file'), undefined);
  assert.equal(tlsFingerprintPem('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'), undefined);
});
