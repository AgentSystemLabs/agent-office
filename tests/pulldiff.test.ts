import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standDom } from './support/dom.mjs';

standDom();
Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });

const { extractSnippetLines, linesFromDiffHunk, parseDiff } = await import('../src/client/ui/github/pulldiff.js');

test('linesFromDiffHunk parses unified diff hunks correctly', () => {
  const hunk = `@@ -85,5 +85,5 @@
 "@capacitor/status-bar": "8.0.2",
-"@capgo/inappbrowser": "8.6.14",
+"@capgo/capacitor-inappbrowser": "8.21.2",
`;
  const lines = linesFromDiffHunk(hunk);
  assert.equal(lines.length, 4);
  assert.equal(lines[0]?.kind, 'hunk');
  assert.equal(lines[1]?.kind, 'ctx');
  assert.equal(lines[1]?.text, '"@capacitor/status-bar": "8.0.2",');
  assert.equal(lines[2]?.kind, 'del');
  assert.equal(lines[3]?.kind, 'add');
});

test('extractSnippetLines extracts surrounding context from parsed diff files', () => {
  const rawDiff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -85,5 +85,5 @@
 "@capacitor/status-bar": "8.0.2",
 "@capawesome/capacitor-android-edge-to-edge-support": "8.0.8",
 "@capawesome/capacitor-file-picker": "8.0.3",
-"@capgo/inappbrowser": "8.6.14",
-"@gtec/gconnect-ionic-ng-capacitor": "20.2.0",
+"@capgo/capacitor-inappbrowser": "8.21.2",
+"@gtec/gconnect-ionic-ng-capacitor": "20.4.2",
`;
  const files = parseDiff(rawDiff);
  assert.equal(files.length, 1);

  // Line 89 added in package.json
  const snippet = extractSnippetLines(files, 'package.json', 89, 'RIGHT');
  assert.ok(snippet.length >= 4);
  assert.ok(snippet.some((l) => l.kind === 'add' && l.text.includes('@gtec/gconnect-ionic-ng-capacitor')));
  assert.ok(snippet.some((l) => l.kind === 'del' && l.text.includes('@gtec/gconnect-ionic-ng-capacitor')));
  assert.ok(snippet.some((l) => l.kind === 'ctx' && l.text.includes('@capacitor/status-bar')));
});
