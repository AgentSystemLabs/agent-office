// What a worker is doing, read off its latest tool call, so the office can act it out: flipping
// through papers while it reads, typing fast while it edits, leaning back while its tests run, a
// globe spinning over the desk while it's on the web.

import type { WorkerAction } from './protocol.js';

/** Test runs or builds that fail in a row before a worker puts its head in its hands. */
export const FAILS_TO_DESPAIR = 2;

/** Tool names, lowercased, across Claude Code, Codex and OpenCode. */
const READ_TOOLS = new Set(['read', 'read_file', 'view', 'view_file', 'grep', 'grep_files', 'glob', 'ls', 'list', 'list_dir', 'list_files', 'find', 'codesearch', 'search_files', 'notebookread']);
const EDIT_TOOLS = new Set(['edit', 'multiedit', 'write', 'write_file', 'create_file', 'notebookedit', 'apply_patch', 'patch', 'str_replace', 'str_replace_editor', 'str_replace_based_edit_tool']);
const WEB_TOOLS = new Set(['websearch', 'webfetch', 'web_search', 'web_fetch', 'fetch', 'browse', 'search_web']);
const SHELL_TOOLS = new Set(['bash', 'shell', 'exec_command', 'local_shell', 'run_command', 'terminal']);

/**
 * The action for a tool call: `tool` is its name (e.g. "Bash", "read_file", "mcp__fetch__fetch") and
 * `input` its arguments when the provider sends them, which is how a shell command gets told apart.
 */
export function toolAction(tool: unknown, input?: unknown): WorkerAction | undefined {
  if (typeof tool !== 'string') return undefined;
  const name = tool.toLowerCase().replace(/^.*[.:/]/, '');
  if (READ_TOOLS.has(name)) return 'read';
  if (EDIT_TOOLS.has(name)) return 'edit';
  if (WEB_TOOLS.has(name)) return 'web';
  // An MCP server's own tools: mcp__<server>__<tool>.
  if (/^mcp__/.test(name)) return /web|fetch|brows|url|http/.test(name) ? 'web' : undefined;
  if (SHELL_TOOLS.has(name)) {
    const command = (input as { command?: unknown } | undefined)?.command;
    return typeof command === 'string' ? commandAction(command) : undefined;
  }
  return undefined;
}

/** Runs tests, a build, a type check or a linter: the programs that always do, and the subcommands that do. */
const CHECK =
  /^(?:tsc|vue-tsc|svelte-check|jest|vitest|mocha|ava|pytest|py\.test|tox|nox|rspec|phpunit|karma|mypy|pyright|eslint|make|cmake|ninja|gradlew?|mvnw?|xcodebuild|ctest|bazel|bazelisk|webpack|rollup|turbo|nx|sbt)$|^(?:go (?:test|build|vet)|cargo (?:test|build|check|clippy|nextest)|dotnet (?:test|build)|swift (?:test|build)|mix (?:test|compile)|zig (?:build|test)|deno (?:test|check)|bun test|(?:flutter|dart) test|playwright test|cypress run|ruff check|(?:next|vite|nuxt|astro|ng) build|rake (?:test|spec))\b/;
/** A package.json script that tests or builds (`npm test`, `pnpm run build:web`, `yarn typecheck`). */
const CHECK_SCRIPT = /^(?:t|test|tests|build|check|lint|typecheck|type-check|tsc|compile|e2e|spec|verify|ci)(?:[:-]\S*)?$/;
/** Looks at code or history without changing it: the programs, and the subcommands. */
const READ = /^(?:cat|bat|head|tail|less|more|grep|egrep|fgrep|rg|ag|ack|find|fd|ls|tree|wc|stat|file|du|jq|diff|nl|awk)$/;
const READ_SUB = /^sed -n\b|^git(?: (?:-C \S+|--?[\w-]+(?:=\S+)?))* (?:log|show|diff|status|blame|grep|ls-files|shortlog)\b|^gh (?:issue|pr|repo|run) (?:view|list|diff)\b/;
/** Leading `FOO=bar` assignments and the wrappers in front of the program that really runs. */
const PREFIX = /^(?:\w+=(?:'[^']*'|"[^"]*"|\S*)\s+|(?:sudo|time|nice|nohup|command|exec|env|npx|bunx|pnpx|caffeinate|xvfb-run)\s+|(?:bundle exec|poetry run|uv run|pipenv run|pdm run|pnpm exec|yarn exec|python3? -m)\s+|timeout\s+\S+\s+)/;

/** 'test' for a command that runs tests or a build, 'read' for one that only looks at things. */
export function commandAction(command: string): 'test' | 'read' | undefined {
  let first: 'read' | undefined;
  let leading = true;
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    const words = normalize(part);
    if (!words.length) continue;
    if (isCheck(words)) return 'test';
    // Moving around first (`cd app && grep …`) doesn't decide it; the first real command does.
    if (!leading || /^(?:cd|pushd|export|source|set|\.)$/.test(words[0])) continue;
    leading = false;
    if (READ.test(words[0]) || READ_SUB.test(words.join(' '))) first = 'read';
  }
  return first;
}

function normalize(part: string): string[] {
  let s = part.replace(/^[\s({]+/, '').trim();
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(PREFIX, '');
  }
  const words = s.split(/\s+/).filter(Boolean);
  // ./node_modules/.bin/vitest, ./gradlew, jest.cmd: the program's own name.
  if (words.length) words[0] = words[0].replace(/^.*[/\\]/, '').replace(/\.(?:cmd|exe|bat)$/i, '');
  return words;
}

function isCheck(words: string[]): boolean {
  const [prog, ...rest] = words;
  if (CHECK.test(prog) || CHECK.test(`${prog} ${rest[0] ?? ''}`)) return true;
  if (/^(?:node|tsx|bun|deno)$/.test(prog) && rest.includes('--test')) return true;
  if (/^(?:npm|pnpm|yarn|bun)$/.test(prog)) {
    const script = rest.find((w) => !w.startsWith('-') && w !== 'run' && w !== 'run-script');
    return !!script && CHECK_SCRIPT.test(script);
  }
  return false;
}

/**
 * Summary lines test runners and compilers print when something failed, for a run whose exit code
 * the agent piped away (`npm test 2>&1 | tail`). Only the summary formats, so a passing test that
 * happens to be named "reports 3 errors" doesn't count.
 */
const FAILED = [
  /^Tests:\s.*\b[1-9]\d* failed/m, // jest
  /^\s*(?:Test Files|Tests)\s+[1-9]\d* failed/m, // vitest
  /^(?:#|ℹ) fail [1-9]/m, // node --test
  /^=+ .*\b[1-9]\d* (?:failed|errors?)\b/m, // pytest
  /^\s+[1-9]\d* failing$/m, // mocha
  /^[1-9]\d* examples?, [1-9]\d* failures?/m, // rspec
  /^(?:FAIL|--- FAIL)\b/m, // go
  /^test result: FAILED/m, // cargo
  /^error(?:\[E\d{4}\])?: /m, // rustc
  /\berror TS\d{4}:|^Found [1-9]\d* errors?\b/m, // tsc
  /^npm (?:ERR!|error) /m,
  /^make: \*\*\*|\bBUILD FAILED\b/m,
];

export function outputFailed(output: string): boolean {
  const tail = output.length > 8000 ? output.slice(-8000) : output;
  return FAILED.some((re) => re.test(tail));
}
