import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initPocketBootstrap } from '../src/client/shared/pocket/bootstrap';

const read = (path: string) => readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8');

test('standalone bootstrap does not enable Pocket desktop dialog bounds', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let added = false;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelector() { return null; },
    documentElement: { classList: { add() { added = true; } } },
  } });
  try {
    const target = { profile: { name: 'Standalone', color: '#ffffff', look: { skin: 0, hair: 0, style: 0 } }, me: { admin: false } };
    assert.equal(initPocketBootstrap(target), null);
    assert.equal(added, false);
    assert.equal(target.profile.name, 'Standalone');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('Pocket bounds desktop dialogs without replacing the original HUD, control sizes, or desktop layout', () => {
  const css = read('shared/pocket/responsive.css');
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of withoutComments.matchAll(/(?:^|[{}])\s*([^{}]+)\{/g)) {
    assert.ok(rule[1].trim().startsWith('html.pocket-office'), rule[1]);
  }
  assert.doesNotMatch(withoutComments, /@media|zoom\s*:|scale\s*\(|44px|\.topbar|\.side|\.chat|\.dock|\.settings-nav|\.settings-tab|\.hud-menu|grid-template/);
  assert.match(css, /max-width: calc\(100vw - 32px\)/);
  assert.match(css, /max-height: calc\(100dvh - 38px\)/);
  assert.match(css, /\.modal > header\s*\{[^}]*flex: none;/);
  assert.match(css, /\.modal > header \.close\s*\{[^}]*position: absolute;[^}]*right: 16px;/);
  assert.match(css, /\.modal > \.close\.corner\s*\{[^}]*right: 10px;[^}]*left: auto;/);
  assert.match(css, /\.modal > \.body\s*\{[^}]*overflow: auto;/);
  assert.match(css, /\.modal > footer\s*\{[^}]*flex: none;[^}]*overflow: auto;/);
  assert.doesNotMatch(withoutComments, /(?:^|[;{])\s*(?:font-size|border-radius|width|height)\s*:/);
  assert.match(read('shared/pocket/bootstrap.ts'), /import '\.\/responsive\.css'/);
});

test('the isolated layout check uses only the approved full desktop viewports and verifies X plus Esc', () => {
  const script = readFileSync(new URL('../integrations/pi-pocket/responsive-check.mjs', import.meta.url), 'utf8');
  assert.match(script, /\[\[1280,800\],\[1440,900\],\[1024,768\],\[1920,1080\]\]/);
  assert.match(script, /min-width:1024px;min-height:600px/);
  assert.match(script, /Keep the original desktop close-button width/);
  assert.match(script, /The close button stays outside scrolling task content/);
  assert.match(script, /X closes the desktop dialog/);
  assert.match(script, /Esc closes the desktop popup/);
  assert.doesNotMatch(script, /touch-sized|390,550|320,350|667,320|550,200/);
});
