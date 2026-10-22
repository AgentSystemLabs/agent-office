#!/usr/bin/env node
// Native extension acceptance test against preview.mjs. No real provider, renderer patches, or live data.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
const log = await readFile(process.env.OFFICE_PREVIEW_LOG ?? '/tmp/office-v2-pocket-preview.log', 'utf8');
const ownerUrl = log.match(/^Owner: (.+)$/m)?.[1];
const guestUrl = log.match(/^Guest: (.+)$/m)?.[1];
if (!ownerUrl?.startsWith('http://127.0.0.2:') || !guestUrl?.startsWith('http://127.0.0.2:')) throw new Error('Use an isolated preview on 127.0.0.2 only.');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome-stable', headless: true, args: ['--no-sandbox'] });
const screenshots = join(import.meta.dirname, '../../dist/screenshots');
await mkdir(screenshots, { recursive: true });
const contexts = [];
let sockets = 0;
const worldRequests = [];
async function open(url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  page.on('websocket', () => { sockets++; });
  page.on('request', (request) => { if (/\/world\/|office-document\.json/.test(request.url())) worldRequests.push(request.url()); });
  await page.goto(url);
  if (!await page.getByRole('button', { name: 'Close Office v2', exact: true }).isVisible()) await page.getByRole('button', { name: 'Office v2', exact: true }).first().click();
  await page.getByRole('article', { name: 'Desk 1', exact: true }).waitFor();
  assert.equal(await page.locator('iframe').count(), 0, 'native room cannot depend on a renderer or character form');
  return page;
}
try {
  const owner = await open(ownerUrl);
  const guest = await open(guestUrl);
  await owner.getByLabel('People in the office').getByText('Office teammate').waitFor();
  await guest.getByLabel('People in the office').getByText('Owner').waitFor();
  console.log('PASS: native startup and 2 authenticated participants, without Office assets or WebGL.');

  await owner.getByRole('button', { name: 'My appearance', exact: true }).click();
  await owner.getByLabel('Shirt color', { exact: true }).selectOption('#06d6a0');
  await owner.getByRole('button', { name: 'Save my appearance', exact: true }).click();
  await owner.getByRole('article', { name: 'Desk 1', exact: true }).waitFor();
  const anotherOwner = await open(ownerUrl);
  await anotherOwner.getByRole('button', { name: 'My appearance', exact: true }).click();
  assert.equal(await anotherOwner.getByLabel('Shirt color', { exact: true }).inputValue(), '#06d6a0', 'appearance follows the account into a fresh browser context');
  await anotherOwner.getByRole('button', { name: 'Close', exact: true }).click();
  console.log('PASS: per-user appearance survives a new browser context.');

  const empty = owner.getByRole('article').filter({ has: owner.getByRole('button', { name: 'Hire agent', exact: true }) }).first();
  const deskLabel = await empty.getAttribute('aria-label');
  await empty.getByRole('button', { name: 'Hire agent', exact: true }).click();
  await owner.getByLabel('Initial task', { exact: true }).fill('Native extension test: confirm that this is a real Pocket session.');
  await owner.getByRole('button', { name: 'Hire agent', exact: true }).last().click();
  const ownerDesk = owner.getByRole('article', { name: deskLabel, exact: true });
  const guestDesk = guest.getByRole('article', { name: deskLabel, exact: true });
  await ownerDesk.getByRole('button', { name: 'Open conversation', exact: true }).waitFor();
  await guestDesk.getByRole('button', { name: 'Open conversation', exact: true }).waitFor();
  assert.equal(await ownerDesk.locator('strong').innerText(), await guestDesk.locator('strong').innerText());
  await ownerDesk.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await owner.locator('main').getByText(/echo:/).waitFor();
  assert.match(await owner.locator('main').innerText(), /Native extension test: confirm that this is a real Pocket session\./);
  await owner.getByRole('article', { name: deskLabel, exact: true }).waitFor();
  await owner.reload();
  await owner.getByRole('article', { name: deskLabel, exact: true }).getByRole('button', { name: 'Open conversation', exact: true }).waitFor();
  assert.equal(await owner.locator('iframe').count(), 0);
  assert.equal(sockets, 0, 'no Office WebSocket or CLI transport');
  assert.deepEqual(worldRequests, [], 'the native extension works without downloading the 3D application');
  await owner.screenshot({ path: join(screenshots, 'office-v2-desktop.png') });
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.screenshot({ path: join(screenshots, 'office-v2-mobile.png') });
  console.log('PASS: shared real worker, native conversation, no 3D dependency, desktop/mobile screenshots.');
} catch (error) {
  for (const [i, context] of contexts.entries()) {
    const page = context.pages()[0];
    if (page) await page.screenshot({ path: join(screenshots, `office-v2-test-error-${i}.png`) }).catch(() => {});
  }
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
