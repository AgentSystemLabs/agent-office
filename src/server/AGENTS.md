# Server

- Compiled by `tsconfig.server.json` (NodeNext, Node types, no DOM) into `dist/server`. Relative imports end in `.js`.
- Office options (CLI flags and their `AGENT_OFFICE_*` / `PORT` environment equivalents) are parsed by `loadConfig` in `config.ts` into `Config`. Add a new option there and document it in `HELP` in the same file.

## PTY host

`ptyhost.ts` runs as a detached process that outlives server restarts and keeps running the code it started with. A newer server replaces the host only when the host reports a different `PTY_PROTOCOL` (`ptys.ts`).

Bump `PTY_PROTOCOL` in the same change whenever you edit code the host runs: `ptyhost.ts`, `screen.ts`, or what `ptyhost.ts` imports from `ptys.ts` (`SCROLLBACK`, `readMessages`, `SpawnOpts`, `ToHost`, `FromHost`). The rest of `ptys.ts` runs in the server and needs no bump. Without the bump, running offices keep the old host. With it, the next server ends the old host's terminals and the workers resume their sessions.
