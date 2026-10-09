import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Services } from '../src/server/services.js';
import { parseWindowsSnapshot } from '../src/server/services/windows.js';

test('Windows listeners include IPv4/IPv6 and localized states, excluding outbound connections', () => {
  const s = parseWindowsSnapshot(JSON.stringify({
    sockets: [
      ' TCP 0.0.0.0:5173 0.0.0.0:0 LISTENING 42',
      ' TCP [::1]:3000 [::]:0 ABHÖREN 43',
      ' TCP 127.0.0.1:55000 127.0.0.1:5173 ESTABLISHED 44',
      ' UDP 0.0.0.0:5173 *:* 42',
    ],
    processes: [{ ProcessId: 42, ParentProcessId: 10, CommandLine: 'node vite.js' }],
  }));
  assert.deepEqual(s.listeners, [{ pid: 42, host: '127.0.0.1', port: 5173 }, { pid: 43, host: '::1', port: 3000 }]);
  assert.deepEqual(s.processes.get(42), { ppid: 10, args: 'node vite.js' });
});

test('Windows discovers an HTTP child of a worker and removes it after exit', { skip: process.platform !== 'win32', timeout: 40_000 }, async (t) => {
  const child = spawn(process.execPath, ['-e', "require('http').createServer((q,r)=>r.end('<title>Worker preview</title>')).listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { windowsHide: true });
  t.after(() => child.kill());
  const [chunk] = await once(child.stdout!, 'data');
  const port = Number(String(chunk).trim());
  const services = new Services(() => [{ workerId: 'worker', pid: process.pid, agent: false, cwd: process.cwd(), root: process.cwd() }], () => {});
  await services.scan();
  for (let i = 0; i < 40 && !services.list().some((s) => s.port === port); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(services.list().find((s) => s.port === port)?.workerId, 'worker');
  const exited = once(child, 'exit');
  child.kill();
  await exited;
  await services.scan();
  assert.equal(services.list().some((s) => s.port === port), false);
});
