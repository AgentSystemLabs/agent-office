import { execFile } from 'node:child_process';
import { WindowsProcessCache } from './windows-process-cache.js';

/** Current TCP listeners and cached process ancestry; no Unix tools or administrator rights. */
export interface WindowsSnapshot {
  listeners: { pid: number; host: string; port: number }[];
  processes: Map<number, { ppid: number; args: string }>;
}

export function parseWindowsSnapshot(text: string): WindowsSnapshot {
  const data = JSON.parse(text.replace(/^\uFEFF/, '')) as {
    sockets?: string[];
    processes?: { ProcessId: number; ParentProcessId: number; CommandLine: string | null }[];
  };
  const listeners: WindowsSnapshot['listeners'] = [];
  for (const line of data.sockets ?? []) {
    const cols = line.trim().split(/\s+/);
    // The remote port is zero for listeners. This also works with localized state names.
    if (cols.length !== 5 || cols[0] !== 'TCP' || !/:0$/.test(cols[2])) continue;
    const addr = /^(.*):(\d+)$/.exec(cols[1]);
    const pid = Number(cols[4]);
    if (!addr || !Number.isInteger(pid) || pid <= 0) continue;
    let host = addr[1].replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    if (host === '0.0.0.0' || host === '::') host = '127.0.0.1';
    listeners.push({ pid, host, port: Number(addr[2]) });
  }
  return {
    listeners,
    processes: new Map((data.processes ?? []).map((p) => [p.ProcessId, { ppid: p.ParentProcessId, args: p.CommandLine ?? '' }])),
  };
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) reject(new Error('Windows service discovery failed', { cause: err }));
      else resolve(out);
    });
  });
}

const processes = new WindowsProcessCache(async () => {
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
    "$p=@(Get-CimInstance -Query 'SELECT ProcessId,ParentProcessId,CommandLine FROM Win32_Process'); " +
    "@{processes=@($p | Select-Object ProcessId,ParentProcessId,CommandLine)} | ConvertTo-Json -Compress -Depth 3";
  return parseWindowsSnapshot(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])).processes;
});

export async function windowsSnapshot(): Promise<WindowsSnapshot> {
  // netstat reads the sockets directly: no PowerShell or WMI on the four-second polling path.
  const sockets = (await run('netstat.exe', ['-ano', '-p', 'tcp'])).split(/\r?\n/);
  const snapshot = parseWindowsSnapshot(JSON.stringify({ sockets }));
  snapshot.processes = await processes.get(snapshot.listeners.map((listener) => listener.pid));
  return snapshot;
}
