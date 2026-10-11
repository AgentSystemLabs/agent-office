/** Injected into native hook helpers. Forward classifications and job IDs, never shell output. */
export const TEST_HOOK_SOURCE = String.raw`
  if (/^(?:PreToolUse|PostToolUse|preToolUse|postToolUse|postToolUseFailure)$/.test(event)) {
    const args = input.tool_input;
    const command = args && (args.command || args.cmd);
    if (typeof command === 'string' && !/^\s*(?:echo|Write-Output|cat|Get-Content|rg|grep)\b/i.test(command)) {
      body.office_test = /\b(?:npm|pnpm|yarn)\s+(?:test|run\s+(?:test|build|typecheck|lint))\b|(?:Build-Quest|run-tests|run-filter|Test-ZrbFocusedPlayMode)\.ps1\b|\s-(?:runTests|TestsOnly|testPlatform)\b/.test(command);
    }
    let response = input.tool_response;
    if (typeof response === 'string') { try { response = JSON.parse(response); } catch { response = { stdout: response }; } }
    if (response && typeof response === 'object') {
      const job = response.backgroundTaskId ?? response.session_id;
      if (typeof job === 'string' || typeof job === 'number') body.office_test_job = String(job).slice(0, 256);
      if (typeof response.exit_code === 'number') body.office_test_exit = response.exit_code;
      const output = response.stdout || response.output;
      if (typeof output === 'string' && /waiting[^\n]{0,100}(?:build|test|lock)|queued behind/i.test(output)) body.office_test_waiting = true;
    }
    const job = args && (args.session_id ?? args.task_id);
    if (typeof job === 'string' || typeof job === 'number') body.office_test_poll = String(job).slice(0, 256);
  }
`;
