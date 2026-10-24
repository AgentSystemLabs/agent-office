import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {shellInteractiveArgs, shellRun} from '../src/server/workers/process.js';

test('configured shell receives its own argument family', () => {
  assert.deepEqual(shellInteractiveArgs('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoLogo', '-NoProfile']);
  assert.deepEqual(shellInteractiveArgs('pwsh.exe'), ['-NoLogo', '-NoProfile']);
  assert.deepEqual(shellInteractiveArgs('C:\\Windows\\System32\\cmd.exe'), ['/d']);
  assert.deepEqual(shellInteractiveArgs('/bin/bash'), ['-l']);
  assert.deepEqual(shellRun('echo ok', 'cmd.exe'), ['/d', '/s', '/c', 'echo ok']);
  assert.deepEqual(shellRun('echo ok', '/bin/bash'), ['-l', '-i', '-c', 'echo ok']);
});

test('actual Windows PowerShell executes a command without Unix login flags', {skip:process.platform !== 'win32'}, () => {
  const output=execFileSync('powershell.exe',shellRun("Write-Output 'office-shell-ok'",'powershell.exe'),{encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(output.trim(),'office-shell-ok');
});
