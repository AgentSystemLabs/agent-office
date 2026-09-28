import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawQr, type QrPayload } from '../src/client/ui/vr.js';

/** Minimal canvas: drawQr only assigns width/height and fillRects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubCanvas(): any {
  return {
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: '', fillRect() {} }),
  };
}

function payloadLength(payload: QrPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

const PIN = 'sha256/gKUv3xNTJS02lTP3c8Qs2Y1P49/vwfdAnc40KnQGciY=';

test('a pinned pairing payload still fits the QR (versions 1–10)', () => {
  const payload: QrPayload = { url: 'wss://192.168.1.5:4600', code: 'K7Q2M9XD', pin: PIN };
  assert.ok(payloadLength(payload) < 271, `payload is ${payloadLength(payload)} bytes`);
  assert.equal(drawQr(stubCanvas(), JSON.stringify(payload)), true);
});

test('an unpinned pairing payload still fits the QR', () => {
  const payload: QrPayload = { url: 'ws://192.168.1.5:4600', code: 'K7Q2M9XD' };
  assert.equal(drawQr(stubCanvas(), JSON.stringify(payload)), true);
});

test('drawQr refuses a payload past version-10 capacity', () => {
  assert.equal(drawQr(stubCanvas(), 'x'.repeat(300)), false);
});
