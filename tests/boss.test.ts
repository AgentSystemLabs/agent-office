import test from 'node:test';
import assert from 'node:assert/strict';
import { bossRoutes } from '../src/server/http/routes/boss.js';

test('Boss Office Routes Unit Tests', async (t) => {
  // Mock office context
  const mockCtx: any = {
    cfg: { dir: process.cwd() },
    floors: new Map([
      ['f1', {
        workers: {
          list: () => [
            { id: 'worker-1', name: 'CEO', deskId: 'desk-1', status: 'idle', task: 'Lead strategy', provider: 'custom' },
            { id: 'worker-2', name: 'Lead', deskId: 'desk-2', status: 'idle', task: 'Code review', provider: 'custom' },
          ],
          prompt: (id: string, text: string) => {
            promptedCalls.push({ id, text });
          }
        }
      }]
    ])
  };

  const promptedCalls: any[] = [];

  await t.test('POST /api/boss/command executes host command with absolute permissions', async () => {
    let responseStatus = 0;
    let responseBody = '';

    const req: any = {
      on: (event: string, cb: any) => {
        if (event === 'data') cb(Buffer.from(JSON.stringify({ command: 'echo "Boss Absolute Power"' })));
        if (event === 'end') cb();
      }
    };

    const res: any = {
      writeHead: (status: number) => { responseStatus = status; },
      end: (data: string) => { responseBody = data; },
      setHeader: () => {}
    };

    await bossRoutes.command.handle(mockCtx, { req, res, url: new URL('http://x/api/boss/command'), path: '/api/boss/command' });

    assert.equal(responseStatus, 200);
    const parsed = JSON.parse(responseBody);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.stdout.includes('Boss Absolute Power'));
    assert.equal(parsed.exitCode, 0);
    assert.ok(typeof parsed.durationMs === 'number');
  });

  await t.test('POST /api/boss/talk prompts specific worker', async () => {
    let responseStatus = 0;
    let responseBody = '';

    const req: any = {
      on: (event: string, cb: any) => {
        if (event === 'data') cb(Buffer.from(JSON.stringify({ recipient: 'CEO', prompt: 'Prepare Q4 roadmap' })));
        if (event === 'end') cb();
      }
    };

    const res: any = {
      writeHead: (status: number) => { responseStatus = status; },
      end: (data: string) => { responseBody = data; },
      setHeader: () => {}
    };

    await bossRoutes.talk.handle(mockCtx, { req, res, url: new URL('http://x/api/boss/talk'), path: '/api/boss/talk' });

    assert.equal(responseStatus, 200);
    const parsed = JSON.parse(responseBody);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.promptedCount, 1);
    assert.ok(promptedCalls.length > 0);
    assert.equal(promptedCalls[0].id, 'worker-1');
    assert.ok(promptedCalls[0].text.includes('Prepare Q4 roadmap'));
  });

  await t.test('POST /api/boss/talk broadcasts to all workers when recipient is all', async () => {
    promptedCalls.length = 0;
    let responseStatus = 0;
    let responseBody = '';

    const req: any = {
      on: (event: string, cb: any) => {
        if (event === 'data') cb(Buffer.from(JSON.stringify({ recipient: 'all', prompt: 'Company meeting at 3pm' })));
        if (event === 'end') cb();
      }
    };

    const res: any = {
      writeHead: (status: number) => { responseStatus = status; },
      end: (data: string) => { responseBody = data; },
      setHeader: () => {}
    };

    await bossRoutes.talk.handle(mockCtx, { req, res, url: new URL('http://x/api/boss/talk'), path: '/api/boss/talk' });

    assert.equal(responseStatus, 200);
    const parsed = JSON.parse(responseBody);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.promptedCount, 2);
    assert.equal(promptedCalls.length, 2);
  });

  await t.test('GET /api/boss/state returns workers and budget status', async () => {
    let responseStatus = 0;
    let responseBody = '';

    const req: any = {};
    const res: any = {
      writeHead: (status: number) => { responseStatus = status; },
      end: (data: string) => { responseBody = data; },
      setHeader: () => {}
    };

    bossRoutes.state.handle(mockCtx, { req, res, url: new URL('http://x/api/boss/state'), path: '/api/boss/state' });

    assert.equal(responseStatus, 200);
    const parsed = JSON.parse(responseBody);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.workers.length, 2);
    assert.equal(parsed.workers[0].name, 'CEO');
    assert.ok(parsed.budget);
  });
});
