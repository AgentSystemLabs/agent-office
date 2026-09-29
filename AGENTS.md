# Agent Office

A 3D multiplayer office in the browser where a team hires claude, opencode, codex and droid workers at desks and shares their live PTYs. A Node server owns the workers, terminals, boards and state; a Vite/three.js client renders the office.

Read [docs/guide.md "How it works"](docs/guide.md#how-it-works) before changing how a subsystem behaves (status hooks, PTY host, worktrees, meetings, queue, floors, state files). Read [docs/vr-webxr.md](docs/vr-webxr.md) before touching WebXR code.

## Repository map

| Path | Contents |
| --- | --- |
| `src/server/` | Node server: CLI and config, workers, PTY host, hooks, GitHub/GitLab boards, queue, meetings, floors |
| `src/shared/` | Types and pure logic compiled into both server and client, including the WebSocket protocol (`protocol.ts`) |
| `src/client/` | Vite root: HTML entry pages, `main.ts`, `ui/` (DOM windows and panels), `world/` (three.js scene), `vr/` (WebXR), `iwsdk-scripts/` (IWSDK emulator scripts) |
| `bin/agent-office.js` | Published CLI entry; loads the built `dist/server/server/cli.js` |
| `bin/office-queue.js` | Plain-Node `office-queue` command that board agents use to reach the task queue |
| `tests/` | `node:test` suites run through `tsx` |
| `deploy/` | `aws.sh` (EC2 lifecycle) and `provision.sh` (machine setup it runs) |
| `install.sh`, `install.ps1` | Release installers for macOS/Linux and Windows |
| `docs/` | `guide.md` (every feature, setup and how each subsystem works), `vr-webxr.md`, and the README pictures |

## Commands

Run from the repository root. npm with `package-lock.json` is the only package manager; do not add another lockfile.

| Task | Command |
| --- | --- |
| Clean install (`prepare` also installs the pre-commit hook and builds client and server) | `npm ci` |
| Add or change a dependency (updates `package-lock.json`; commit both files) | `npm install <pkg>` |
| Dev: Vite with hot reload on :5173, server on :4600, password `dev` | `npm run dev` |
| Build `dist/public` (client) and `dist/server` (server) | `npm run build` |
| Lint and format check with Biome (`biome.jsonc`); any warning fails | `npm run lint` |
| Rewrite files in the Biome format | `npm run format` |
| Typecheck server and client | `npm run typecheck` |
| All tests | `npm test` |
| All tests with the coverage thresholds in its script (Node 22.8+) | `npm run test:coverage` |
| One test file | `node --import tsx --test tests/<name>.test.ts` |
| Run the built office against a project | `node bin/agent-office.js <project> --password dev` |

`node bin/agent-office.js` runs `dist/`, so run `npm run build` after changing source.

Tests are flat files named `tests/<name>.test.ts` using `node:test` and `node:assert/strict`. `npm test` globs `tests/*.test.ts`, so a test in a subdirectory never runs.

## Conventions

- `.agent-office/` is runtime state (config, workers, scrollback, queue, worktrees). Never commit it.
- `.env.example` lists every environment variable the office and the installers read. Adding, renaming or removing one updates `.env.example` in the same change; `tests/env-example.test.ts` fails otherwise. Never commit a `.env` file.
- Do not change the `version` in `package.json` except to start a new minor. `.github/workflows/release.yml` publishes every change on `main` as `v<major>.<minor>.<commit count on main>`.
- Commit subjects use a conventional prefix: `feat:`, `fix:`, `docs:` or `chore:`.
- Fix what `npm run lint` reports in code. Never add `biome-ignore` or other suppression comments, and do not turn off rules in `biome.jsonc` to pass a check.
- Do not bypass the pre-commit hook (`.husky/pre-commit`) with `--no-verify`; fix what it reports.

## Validation before a PR

Run the checks CI runs (`.github/workflows/release.yml`, Node 22), in order, and fix any failure:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:coverage
```

CI then packs the release and starts it through `install.sh` (steps "Pack the release" and "Install it with install.sh and start it"). When changing `install.sh`, the `files` or `bin` fields of `package.json`, or server startup, also run those steps locally as the workflow writes them.

CI runs on a pull request only when it touches a path in the workflow's `pull_request.paths` filter. A new check goes into `release.yml` as a step in the same change, and its files go into both `paths` filters.
