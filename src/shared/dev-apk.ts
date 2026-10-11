export interface DevApkBuild {
  id: string;
  status: 'starting' | 'waiting' | 'building' | 'publishing' | 'ready' | 'failed' | 'interrupted';
  requestedBy: string;
  startedAt: number;
  finishedAt?: number;
  revision?: string;
  ref: string;
  bytes?: number;
  sha256?: string;
  error?: string;
}
export interface DevApkView {
  configured: boolean;
  canBuild: boolean;
  ref?: string;
  latest?: DevApkBuild;
  current?: DevApkBuild;
  log?: string;
  busy?: boolean;
}
