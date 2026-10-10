/** Apply the owner's full-access policy on every Office Codex start and resume. */
export function codexPermissionArgs(args: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--yolo', '--dangerously-bypass-approvals-and-sandbox', '--full-auto', '--approve-for-me'].includes(arg)) continue;
    if (['--sandbox', '-s', '--ask-for-approval', '-a'].includes(arg)) { i++; continue; }
    if (/^(?:--sandbox=|--ask-for-approval=|-s.|-a.)/.test(arg)) continue;
    if (arg === '-c' || arg === '--config') {
      if (/^(?:sandbox_mode|approval_policy|approvals_reviewer)\s*=/.test(args[i + 1] ?? '')) { i++; continue; }
    }
    if (/^--config=(?:sandbox_mode|approval_policy|approvals_reviewer)\s*=/.test(arg)) continue;
    kept.push(arg);
  }
  return ['--yolo', ...kept];
}
