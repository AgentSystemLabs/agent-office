# Shared checkout safety

An Office project copy is independent of other clones on the same machine. Updating another clone
does not update the Office floor's folder. This applies to workers without their own worktree.

Before launching or resuming a shared-checkout coding worker, Office fetches its tracked branch
and compares HEAD with that branch. Idle agent terminals do not prevent updating. New starts wait
until active shared turns finish, then fast-forward automatically. Unrelated tracked edits and
untracked notes are preserved by Git; only overlapping files stop the update. Local commits,
unfinished merges, detached HEAD and failed fetches still need attention. Nothing is reset or stashed.
When verification or safe updating fails, the worker displays an explicit start error rather than
working silently against an old revision. Existing active turns are not interrupted.

An idle coding worker's next prompt also needs a recently verified checkout (15 seconds). If its
verification is still running, Office tells you to retry; it has not dispatched that assignment.
The same guard covers queued assignments, direct desk prompts and restored sessions.
Shells and board agents can still run to inspect/reconcile the project; a worker's existing private
worktree keeps its branch and the established fresh-base worktree workflow.

If local edits overlap incoming changes, finish and preserve that work, review changes against
current remote main, and resolve those overlaps in this actual floor folder.
Do not force-pull, reset or stash other people's edits. Choosing an up-to-date private worktree is
also an explicit option; Office does not silently change the user's selected workspace.
