import { execFile } from 'node:child_process';
import { freemem, platform } from 'node:os';
import { promisify } from 'node:util';

export interface TestResources { free: boolean; reason: string }
const exec = promisify(execFile);
/** Advisory only: the project test launcher still acquires its own atomic build lock. */
export async function testResources(): Promise<TestResources> {
  if (freemem() < 4 * 1024 ** 3) return { free: false, reason: 'less than 4 GiB of memory available' };
  if (platform() !== 'win32') return { free: true, reason: '' };
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; $m=$null; $held=$false; try { try { $m=[Threading.Mutex]::OpenExisting('Global\\zrb-build-folder') } catch [Threading.WaitHandleCannotBeOpenedException] {} if($m) { try { $held=$m.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held=$true }; if(!$held) { 'busy'; exit } }; $p=Get-CimInstance Win32_Process -Filter \"Name='Unity.exe'\" | Where-Object { $_.CommandLine -match '-batchmode' }; if($p) { 'busy' } else { 'free' } } finally { if($held) { $m.ReleaseMutex() }; if($m) { $m.Dispose() } }"],
      { timeout: 10_000, windowsHide: true, maxBuffer: 4096 });
    return stdout.trim() === 'free' ? { free: true, reason: '' } : { free: false, reason: 'test machine or build lock is occupied' };
  } catch { return { free: false, reason: 'test availability could not be verified' }; }
}
