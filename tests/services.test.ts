import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { Services, windowsListeners } from '../src/server/services.js';

test('Windows listeners include listening TCP only, with valid IPv4/IPv6 ports and pids', () => {
  assert.deepEqual(windowsListeners('TCP 0.0.0.0:4100 0.0.0.0:0 LISTENING 123\nTCP [::1]:4101 [::]:0 LISTENING 124\nTCP 127.0.0.1:4102 127.0.0.1:5000 ESTABLISHED 125\nTCP 127.0.0.1:99999 0.0.0.0:0 LISTENING 126\nUDP 0.0.0.0:4103 *:* 127'), [
    { host: '127.0.0.1', port: 4100, pid: 123 }, { host: '::1', port: 4101, pid: 124 },
  ]);
});

test('Windows Services discovers and HTTP probes a real server under its worker process', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const serverCode = `const http=require('node:http');const server=http.createServer((q,s)=>{s.setHeader('content-type','text/html');s.end('<title>Office preview verified</title>');});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));process.on('SIGTERM',()=>server.close());`;
  const parentCode = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(serverCode)}],{stdio:['ignore','pipe','inherit']});child.stdout.pipe(process.stdout);process.stdin.resume();process.stdin.on('end',()=>child.kill());`;
  const parent = spawn(process.execPath, ['-e', parentCode], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let services: Services | undefined;
  try {
    const port = await new Promise<number>((resolve, reject) => {
      parent.stdout.once('data', chunk => resolve(Number(String(chunk).trim())));
      parent.once('error', reject);
    });
    assert.ok(port > 0 && parent.pid);
    services = new Services(() => [{ workerId: 'test-worker', pid: parent.pid, agent: true, cwd: process.cwd(), root: process.cwd() }], () => {});
    await services.scan();
    for (let i = 0; i < 30 && !services.lookup(port); i++) await setTimeout(100);
    const found = services.lookup(port);
    assert.ok(found && found !== 'gone');
    assert.equal(found.workerId, 'test-worker');
    assert.equal(found.title, 'Office preview verified');
    assert.equal(found.command, 'node.exe');
  } finally {
    services?.stop();
    parent.stdin.end();
    if (parent.exitCode === null) await once(parent, 'exit');
  }
});
