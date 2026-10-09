import { execFile } from 'node:child_process';

/** One native snapshot per scan; no Unix tools or administrator rights required. */
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

export function windowsSnapshot(): Promise<WindowsSnapshot> {
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
    "$p=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine); " +
    "$s=@(netstat.exe -ano -p tcp); @{processes=$p;sockets=$s} | ConvertTo-Json -Compress -Depth 3";
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        if (err) return reject(new Error('Windows service discovery failed', { cause: err }));
        try { resolve(parseWindowsSnapshot(out)); } catch (err) { reject(err); }
      });
  });
}
