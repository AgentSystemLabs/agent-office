# Shared-checkout task dispatch

A free desk worker may accept another existing queue task while another worker is active in the same checkout. An updated remote branch does not serialize independent tasks. During active collaboration, the Office preserves the current checkout and local edits; it does not pull, switch branches, stash, reset or wait indefinitely for the other turn to finish.

When no other worker is active, assigning a new task checks the upstream and attempts a fast-forward. Git must preserve local changes. Diverged history, unfinished Git operations and failed verification remain errors, including during collaboration. Concurrent work still needs coordination for overlapping files and index operations; this does not grant new tasks or change the queue limit.

A response ending is not proof of task completion. Once a worker has delivered its task, the existing queue may reuse that worker. Board agents, meeting participants and unrelated worktrees are not made eligible by this change.
