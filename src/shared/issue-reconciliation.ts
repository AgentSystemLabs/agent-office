import type { PromptDef } from './prompts.js';

/** Human validation belongs to the person's checklist, never to a coding worker. */
export const PLAYTEST_HANDOFF = `Manual, headset, device and gameplay checks always go to the person's Playtest checklist. Use office-playtests list first, then office-playtests add with JSON on stdin containing title, steps, expected, category and source (the issue or PR URL). Keep existing checks and checked-off results; avoid duplicates. Only the person may mark them passed. Do not queue human checks as worker tasks or block an otherwise completed implementation on them. If office-playtests is unavailable or fails, report the failed handoff and the exact checks; never claim they were saved.`;

export const ISSUE_RECONCILIATION_PROMPTS = {
  'issues.reconcile': {
    group: 'stations',
    label: '🧹 Reconcile issues',
    used: 'The Reconcile issues preset in the Issues agent request window. Applies to the current project.',
    vars: {},
    text: [
      "Reconcile this project's GitHub issues with merged pull requests, current main, the Office task queue and current workers. Work through all open issues, especially those marked in progress. Read each issue's requirements and comments and its linked PRs; a merged PR alone does not prove every requirement is complete.",
      'Close fully implemented issues with a concise explanation linking the merged PRs. For umbrella issues, record completed requirements and preserve genuine remaining work. Pending manual validation goes to the checklist below and must not keep implemented coding work in progress.',
      'Only clear stale assignees and progress/doing/wip/started labels after checking that no worker or queued/running task is still legitimately working on the issue. Do not remove a human assignee with ongoing work. Inspect handed-to-worker and running queue state too; never stop an active worker or falsify a running task merely to make the board look clean. Report stale running tasks that the queue tools cannot repair.',
      'List queued and running tasks before adding anything. Never requeue completed implementation or duplicate an existing issue task. For genuine remaining coding work with no queued/running task, add exactly one complete issue-linked task per independent piece of work, using office-queue and the issue number. Do not edit code, switch branches or merge PRs during this reconciliation.',
      PLAYTEST_HANDOFF,
      'Finish with links and counts: issues closed, stale statuses cleared, issues retained with reasons, coding tasks added, checklist entries added or already present, and any failures. Distinguish completed coding work from unperformed human tests. Preserve ambiguous issues and explain what evidence is missing.',
    ].join('\n\n'),
  },
} as const satisfies Record<string, PromptDef>;
