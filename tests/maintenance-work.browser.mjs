// Synthetic engineering-workspace integration: no live office or real GitHub writes.
// Start this worktree's Vite client on 127.0.0.1:5199, then set CHROMIUM_PATH.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1640, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const repo = 'Ruben00alex/agent-office';
  const issue = n => ({ number: n, title: n === 41 ? 'Engineering workspace' : 'Add a whiteboard room', state: 'OPEN', url: `https://github.com/${repo}/issues/${n}`, assignees: n === 41 ? ['Alex'] : [], labels: n === 42 ? [{ name: 'maintenance:queued', color: '#f08c00' }] : [] });
  let worker = { id: 'maintenance', name: 'Maintenance', deskId: 'station-maintenance', kind: 'agent', provider: 'codex', status: 'needs_input', activity: 'Wants permission: run the repository checks', cols: 64, rows: 20, viewers: [], viewerIds: [], createdAt: 1 };
  const stack = { changes: [{ sha: 'abc1234', subject: 'Build engineering workspace' }], dirty: 2, phase: 'idle', branch: 'main' };
  const queue = [41, 42].map(n => ({ repo, ...issue(n), status: n === 41 ? 'running' : 'queued', at: 1, by: 'Alex', workerId: n === 41 ? worker.id : undefined, attachments: [], commits: [] }));
  const threads = { maintenance: { id: 'maintenance', title: 'Engineering workspace', createdAt: 1, updatedAt: 2, hasOlder: false, messages: [
    { id: 'request', role: 'user', content: 'Make Maintenance an engineering system, with a GitHub backlog and screenshots.', at: 1, by: 'Alex' },
    { id: 'progress', role: 'assistant', content: 'The workspace now connects **issues**, **work**, and **review**.\n\nI need approval to run the repository checks. The exact command and choices are visible in the live console.', phase: 'commentary', at: 2 },
  ] } };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIl8AAAAASUVORK5CYII=', 'base64');
  const image = { id: 'aabbccdd-0000-4000-8000-123456789abc', name: 'screen.png', type: 'image/png', size: png.length };
  const githubIssues = [issue(41), issue(42)];
  const publishIssues = () => page.evaluate(items => { store.maintenanceIssues = { ...store.maintenanceIssues, items }; store.emit('maintenanceIssues'); }, githubIssues);
  const posted = [];
  await page.route('http://127.0.0.1:5199/', r => r.fulfill({ contentType: 'text/html', body: '<html><link rel="stylesheet" href="/style.css"><body><div id="modal-root"></div></body></html>' }));
  await page.route('**/api/maintenance/chat?*', r => {
    const id = new URL(r.request().url()).searchParams.get('thread') ?? worker?.id;
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ worker, work: queue, stack, conversations: Object.values(threads).map(({ messages, hasOlder, ...t }) => ({ ...t, count: messages.length })), conversation: threads[id], floor: 'test-floor', floorName: 'Agent Office', richReplies: true }) });
  });
  await page.route('**/api/maintenance/image?*', r => r.fulfill({ contentType: r.request().method() === 'POST' ? 'application/json' : 'image/png', body: r.request().method() === 'POST' ? JSON.stringify(image) : png }));
  await page.route('**/api/maintenance/issue', async r => {
    const body = r.request().postDataJSON(); posted.push(body);
    const created = { ...issue(43), title: body.title, labels: [{ name: 'maintenance:queued', color: '#f08c00' }] }; githubIssues.push(created); await publishIssues(); queue.push({ repo, ...created, status: 'queued', at: 3, by: 'Sam', attachments: body.attachments.length ? [image] : [], commits: [] });
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(created) });
  });
  await page.route('**/api/maintenance/queue', async r => {
    const body = r.request().postDataJSON(); posted.push(body);
    if (body.remove) { queue.splice(queue.findIndex(i => i.number === body.number), 1); githubIssues.find(i => i.number === body.number).labels = []; await publishIssues(); }
    if (body.reviewed) queue.find(i => i.number === body.number).status = 'done';
    return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route('**/api/maintenance/working', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ files: ' M src/client/ui/maintenance-chat.ts\n?? src/client/ui/maintenance-console.ts', diff: '+ Show permissions beside the active issue', truncated: false }) }));
  await page.route('**/api/maintenance/change?*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ diff: 'commit abc1234\n+ Engineering workspace', truncated: false }) }));
  await page.goto('http://127.0.0.1:5199/');
  await page.evaluate(async ({ repo, issues, stack }) => {
    const chat = await import('/ui/maintenance-chat.ts'); const terminal = await import('/ui/terminal.ts'); const { store } = await import('/state.ts');
    window.chat = chat; window.terminal = terminal; window.store = store; window.sent = []; window.actions = { correct: text => window.correction = text, watch() {} }; window.stackOpens = 0;
    store.floor = 'test-floor'; store.maintenance = stack; store.maintenanceIssues = { repo, items: issues, fetchedAt: 1, loading: false };
    window.send = m => {
      window.sent.push(m);
      if (m.t === 'worker.attach') setTimeout(() => terminal.routeTerminalMessage({ t: 'term.snapshot', workerId: m.workerId, cols: 64, rows: 20, data: '\x1b[1;33mPermission request\x1b[0m\r\n\r\nRun: npm run typecheck && npm test\r\n\r\n> 1. Allow once\r\n  2. Reject\r\n\r\nUse arrow keys and Enter to choose.\r\n\r\nThis is the actual provider console.' }), 0);
    };
    window.openWorkspace = () => window.modal = chat.openMaintenanceChat(send, actions, () => window.stackOpens++);
    openWorkspace();
  }, { repo, issues: [issue(41), issue(42)], stack });
  await page.getByText('Your attention is needed', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.maintenance-console-answer button').disabled);
  await page.screenshot({ path: '/tmp/maintenance-workspace-attention.png', animations: 'disabled' });
  assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '↓', exact: true }).click();
  await page.getByRole('button', { name: 'Enter', exact: true }).click();
  assert.ok(await page.evaluate(() => sent.some(m => m.t === 'term.input' && m.data === '\r')));

  await page.getByRole('button', { name: 'Work & issues', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Start next queued issue', exact: true }).isDisabled(), true);
  await page.screenshot({ path: '/tmp/maintenance-workspace-backlog.png', animations: 'disabled' });
  await page.getByRole('button', { name: '+ Add issue', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Issue title', exact: true }).fill('A room for design reviews');
  await page.getByRole('textbox', { name: 'Issue description', exact: true }).fill('Keep this idea while Maintenance finishes its current task.');
  await page.getByRole('dialog', { name: 'Create maintenance issue', exact: true }).getByLabel('Choose screenshots').setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Remove screen.png', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create GitHub issue & queue', exact: true }).click();
  await page.getByRole('button', { name: '#43 · A room for design reviews', exact: true }).waitFor();
  assert.equal(posted[0].queue, true); assert.deepEqual(posted[0].attachments, [image.id]);
  assert.equal(await page.evaluate(() => sent.some(m => ['worker.kill', 'worker.prompt', 'maintenance.chat.send'].includes(m.t))), false, 'Capturing an idea dispatched work');
  await page.getByRole('button', { name: 'Remove from queue', exact: true }).first().click();
  await page.waitForFunction(() => !document.querySelector('.maintenance-work-view').textContent.includes('Queued · 2'));
  assert.ok(posted.some(p => p.remove === true && p.number === 42));

  worker = { ...worker, status: 'done', activity: 'All checks passed; change is on the stack' }; queue[0].status = 'review'; queue[0].commits = stack.changes;
  await page.evaluate(() => store.emit('workers'));
  await page.waitForFunction(() => !document.querySelector('.maintenance-work-intro button').disabled);
  await page.getByRole('button', { name: 'Start next queued issue', exact: true }).click();
  const start = await page.evaluate(() => sent.filter(m => m.t === 'maintenance.chat.send').at(-1));
  assert.equal(start.maintenanceIssue, 43); assert.equal(start.newConversation, true);
  worker = { ...worker, id: 'next', status: 'working' }; queue.find(i => i.number === 43).status = 'running'; queue.find(i => i.number === 43).workerId = 'next';
  threads.next = { id: 'next', title: 'A room for design reviews', createdAt: 4, updatedAt: 4, hasOlder: false, messages: [{ id: 'next-request', role: 'user', content: 'Implement issue #43', at: 4, attachments: [image] }] };
  await page.evaluate(id => chat.onMaintenanceChatSent({ t: 'maintenance.chat.sent', id, workerId: 'next' }), start.id);
  await page.waitForSelector('[data-message="next-request"]');
  assert.equal(await page.locator('[data-message="next-request"] img').count(), 1);
  assert.ok(await page.evaluate(() => sent.some(m => m.t === 'worker.detach' && m.workerId === 'maintenance')));

  const composer = page.getByRole('textbox', { name: 'Message to Maintenance', exact: true });
  await composer.fill('Use this screenshot for the correction');
  await page.getByLabel('Choose screenshots').setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Remove screen.png', exact: true }).waitFor();
  await page.keyboard.press('Escape'); await page.evaluate(() => openWorkspace());
  await page.waitForSelector('[data-message="next-request"]');
  assert.equal(await composer.inputValue(), 'Use this screenshot for the correction');
  assert.equal(await page.getByRole('button', { name: 'Remove screen.png', exact: true }).count(), 1);
  await composer.press('Enter');
  const request = await page.evaluate(() => sent.filter(m => m.t === 'maintenance.chat.send').at(-1));
  assert.deepEqual(request.attachments, [image.id]);
  await page.evaluate(id => chat.onMaintenanceChatSent({ t: 'maintenance.chat.sent', id, error: 'Provider rejected this request' }), request.id);
  assert.equal(await composer.inputValue(), request.prompt);
  assert.equal(await page.getByRole('button', { name: 'Remove screen.png', exact: true }).count(), 1);

  await page.getByRole('button', { name: 'Work & issues', exact: true }).click();
  githubIssues.find(i => i.number === 43).title = 'Renamed on GitHub';
  githubIssues.find(i => i.number === 43).state = 'CLOSED';
  await publishIssues();
  await page.getByRole('button', { name: '#43 · Renamed on GitHub', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Start next queued issue', exact: true }).isDisabled(), true);
  await page.screenshot({ path: '/tmp/maintenance-github-groundtruth.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Review & checks', exact: true }).click();
  await page.getByText(' M src/client/ui/maintenance-chat.ts', { exact: false }).waitFor();
  await page.screenshot({ path: '/tmp/maintenance-workspace-review.png', animations: 'disabled' });
  await page.getByRole('button', { name: /abc1234 Build engineering workspace/ }).click();
  await page.getByText('commit abc1234', { exact: false }).waitFor();
  await page.getByRole('button', { name: '✍️ Correct this change', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Message to Maintenance"]').value.includes('abc1234'));
  assert.match(await composer.inputValue(), /abc1234/);
  assert.equal(await page.locator('.maintenance-chat').count(), 1, 'Correction opened duplicate workspaces');
  await page.getByRole('button', { name: 'Review & checks', exact: true }).click();
  worker.status = 'done'; await page.evaluate(() => store.emit('workers'));
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Run typecheck, tests & build').disabled);
  await page.getByRole('button', { name: 'Run typecheck, tests & build', exact: true }).click();
  assert.ok(await page.evaluate(() => sent.some(m => m.t === 'maintenance.check')));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/maintenance-workspace-mobile.png', animations: 'disabled' });
  assert.equal(await page.locator('.maintenance-chat').evaluate(el => el.scrollWidth > el.clientWidth), false, 'mobile overflow');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.maintenance-chat').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Passed: real inline prompts/keys, busy issue capture, screenshots, queue removal/dispatch, task evidence, drafts/rejection recovery, diff correction, check dispatch, mobile layout and cleanup.');
} finally { await browser.close(); }
