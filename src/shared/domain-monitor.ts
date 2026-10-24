export interface DomainTarget { hostname: string; workers: string[]; source: string }
export interface DomainCheck extends DomainTarget {
  checkedAt: string;
  status: 'reachable' | 'redirect' | 'restricted' | 'error' | 'unknown';
  http?: number; latencyMs: number; issue?: string; ray?: string; cloudflareError?: string;
}
export interface WorkerMetric { name: string; requests: number; errors: number; outcomes: Record<string, number> }
export interface DomainMonitorState {
  enabled: boolean; running: boolean; location: string; intervalSeconds: number;
  checkedAt?: string; nextCheckAt?: string; discoveredAt?: string;
  analyticsAt?: string; analyticsFrom?: string; analyticsTo?: string;
  domains: DomainCheck[]; workers: string[]; metrics: WorkerMetric[]; issues: string[]; checking: boolean;
}
