/** Pure meeting text helpers, shared without growing the meeting coordinator. */
export function numbered(roles: string[]): string[] {
  const seen = new Map<string, number>(), count = new Map<string, number>();
  for (const r of roles) count.set(r.toLowerCase(), (count.get(r.toLowerCase()) ?? 0) + 1);
  return roles.map(r => {
    const key = r.toLowerCase();
    if ((count.get(key) ?? 0) < 2) return r;
    const n = (seen.get(key) ?? 0) + 1; seen.set(key, n);
    return `${r} ${n}`;
  });
}
export function list(xs: string[]): string { return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`; }
export function firstLine(s: string): string { return s.split('\n').map(l => l.trim()).find(Boolean) ?? ''; }
export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
