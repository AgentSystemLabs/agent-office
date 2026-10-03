import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { speechSupport } from '../src/client/ui/speech.js';
import { resolveSink } from '../src/client/features/xr/dictation.js';
import { keyAt, testLetterRow, isTypable } from '../src/client/features/xr/keyboard.js';
import { planeHit } from '../src/client/features/xr/surface.js';

test('a ray that hits a plane returns UV with v flipped so 0 is the top', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 1));
  mesh.position.set(0, 0, -1);
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const hit = planeHit(mesh, raycaster);
  assert.ok(hit);
  assert.ok(Math.abs(hit!.u - 0.5) < 0.01);
  assert.ok(Math.abs(hit!.v - 0.5) < 0.01);
  assert.ok(hit!.distance > 0.9 && hit!.distance < 1.1);
});

test('a ray that misses a plane, or an invisible mesh, returns null', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1));
  mesh.position.set(5, 5, -1);
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  assert.equal(planeHit(mesh, raycaster), null);
  mesh.position.set(0, 0, -1);
  mesh.visible = false;
  mesh.updateMatrixWorld(true);
  assert.equal(planeHit(mesh, raycaster), null);
});

test('the virtual keyboard hit-tests keys by canvas pixel', () => {
  const row = testLetterRow();
  assert.equal(row[0]!.label, 'q');
  assert.equal(keyAt(row, row[0]!.x + 10, row[0]!.y + 10), 0);
  assert.equal(keyAt(row, row[4]!.x + 10, row[4]!.y + 10), 4);
  assert.equal(keyAt(row, -1, -1), -1);
});

test('dictation falls back to the terminal when nothing is focused', () => {
  const sent: string[] = [];
  const sink = resolveSink({ keyboard: null, termSend: (d) => sent.push(d), modalEl: null });
  assert.equal(sink?.kind, 'term');
  sink?.kind === 'term' && sink.send('hello');
  assert.deepEqual(sent, ['hello']);
  assert.equal(resolveSink({ keyboard: null, termSend: null, modalEl: null }), null);
});

test('the keyboard target beats the terminal fallback', () => {
  const sent: string[] = [];
  const sink = resolveSink({
    keyboard: { kind: 'term', send: (d) => sent.push(`kb:${d}`) },
    termSend: (d) => sent.push(`term:${d}`),
    modalEl: null,
  });
  assert.equal(sink?.kind, 'term');
  sink?.kind === 'term' && sink.send('x');
  assert.deepEqual(sent, ['kb:x']);
});

test('isTypable rejects null and plain objects', () => {
  assert.equal(isTypable(null), false);
  assert.equal(isTypable({}), false);
});

test('when the browser has no speech recognition, VR dictation uses the Whisper fallback', () => {
  // Node has no Web Speech API: the hybrid path records and POSTs to /api/transcribe.
  assert.equal(speechSupport(), 'none');
});
