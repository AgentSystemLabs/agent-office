# Issue, PR, queue and playtest completion

The coordinator reviews the current issue requirements and exact PR head. A merged PR with `Refs` is not automatically treated as full implementation. After implementation and technical checks are complete, use `office-deliver --help` and submit its JSON contract on stdin. The command is available to the existing PR and Issues agents.

Every issue checkbox must be accounted for, in its original order: implemented with evidence, or manual validation with a checklist test containing steps and expected results. Genuine missing implementation stays open. A meeting decision or partial PR is not a completed code fix.

The server verifies the merged head and default branch, saves all manual checks first, closes the issue with evidence and checklist IDs, reads the issue back, then records a durable completion receipt. Existing matching queue tasks dated before the merge become done; tasks added afterwards remain separate work. The receipt survives restart. This never schedules work, changes queue concurrency or interrupts workers.

Manual checks remain unchecked until the owner tests them. Retry the same payload if a save, GitHub call or final receipt write fails. The checklist deduplicates by issue URL and title, preserving human checkmarks and notes. If requirements changed during the handoff, review the new requirements and retry. Reuse an existing entry with `testId` instead of `test`; its source must be this issue or PR. Optional `manualTests` adds checks not represented by issue checkboxes. The owner can access the checklist in the Playtest UI when installed. No failed technical test is waived.

The default PR and Issues agent briefs include this handoff. Subsequent requests through the Office prompt UI and worker messaging API also include the policy, so existing sessions and customized briefs receive it without a restart. Direct terminal typing bypasses Office prompts. Merely returning from an agent turn or detecting a PR reference does not certify delivery. No unattended process guesses that unfinished acceptance criteria are manual tests.

This endpoint uses the calling coordinator's worker token and GitHub identity; ordinary workers cannot certify an issue complete. The local file `issue-deliveries.json` records PR, head, merge time and checklist IDs. The request to GitHub is scoped to the current floor's repository.
