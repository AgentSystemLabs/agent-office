/** Explicit office-operator opt-in, reapplied to both new and resumed workers. */
export function codexAutonomyArgs(args: string[], enabled = process.env.AGENT_OFFICE_CODEX_AUTONOMOUS === '1'): string[] {
  if (!enabled) return [...args];
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['-a', '--ask-for-approval', '-s', '--sandbox'].includes(arg)) { i++; continue; }
    if (/^(?:--ask-for-approval=|--sandbox=|-[as].+)/.test(arg)) continue;
    if (['--full-auto', '--approve-for-me', '--yolo', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust'].includes(arg)) continue;
    out.push(arg);
  }
  return [...out, '--ask-for-approval', 'never', '--sandbox', 'danger-full-access', '--dangerously-bypass-hook-trust'];
}
