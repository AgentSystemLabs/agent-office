// "Easy approvals": the lever in the maintenance closet. With it down, workers keep asking about
// everything, as before. With it up, the office answers the permission requests that are obviously
// fine itself (python, git, cp, mv, mkdir, builds, reads…) and leaves the rest to the person: those
// still ask in the worker's terminal, and the office puts up a card with the command and a summary of
// why it isn't obviously fine.
//
// judgeCommand() decides. It is deliberately conservative: it only calls a command safe when it can
// read all of it and every part is on a short list of everyday programs used in everyday ways, within
// the worker's own folder (or /tmp). Anything it can't parse, doesn't know, or that reaches outside,
// deletes recursively, rewrites history, runs as root, uploads or touches secrets is "ask".

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApprovalCard, ApprovalsState } from '../shared/protocol.js';

export interface Verdict {
  safe: boolean;
  /** Why it isn't (empty when it is), each a short phrase for the card. */
  reasons: string[];
}

export interface JudgeOptions {
  home?: string;
  /** Folders anyone may write to besides the worker's own. */
  temp?: string[];
}

// ---- Reading a shell command -------------------------------------------------------------------

interface Redirect {
  op: string;
  target: string;
}

interface Segment {
  words: string[];
  redirects: Redirect[];
  /** `$( … )` and backtick bodies: commands run as part of this one. */
  subs: string[];
  /** What a `<<` heredoc fed it. */
  heredoc?: string;
  /** What joined it to the one before: `|`, `&&`, `||`, `;`, `&` or a newline. */
  after: string;
  /** Joined to the one after it by a pipe. */
  pipes: boolean;
}

const MAX_COMMAND = 8000;
const MAX_DEPTH = 3;

class Unreadable extends Error {}

/** Splits a command into its simple commands. Throws Unreadable for anything it isn't sure about. */
function parse(src: string): Segment[] {
  const segs: Segment[] = [];
  let seg: Segment = { words: [], redirects: [], subs: [], after: '', pipes: false };
  let word = '';
  let inWord = false;
  let redirect: string | undefined;
  let herestring = false;
  const heredocs: { delim: string; strip: boolean; seg: Segment }[] = [];
  let i = 0;
  const n = src.length;

  const endWord = () => {
    if (!inWord) return;
    if (redirect) {
      seg.redirects.push({ op: redirect, target: word });
      redirect = undefined;
    } else if (herestring) {
      herestring = false;
    } else seg.words.push(word);
    word = '';
    inWord = false;
  };
  const endSeg = (after: string) => {
    endWord();
    if (redirect) throw new Unreadable('a redirect with no target');
    if (seg.words.length || seg.redirects.length || seg.subs.length) {
      segs.push(seg);
    }
    // The one just finished feeds the next through a pipe.
    if ((after === '|' || after === '|&') && segs.length) segs[segs.length - 1].pipes = true;
    seg = { words: [], redirects: [], subs: [], after, pipes: false };
  };
  /** The text between `open` at src[from - 1] and its matching close, and where it ends. */
  const balanced = (from: number, open: string, close: string): [string, number] => {
    let depth = 1;
    let j = from;
    while (j < n) {
      const c = src[j];
      if (c === '\\') j++;
      else if (c === "'") {
        const k = src.indexOf("'", j + 1);
        if (k < 0) throw new Unreadable('an unclosed quote');
        j = k;
      } else if (c === '"') {
        j++;
        while (j < n && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      } else if (c === open) depth++;
      else if (c === close && --depth === 0) return [src.slice(from, j), j + 1];
      j++;
    }
    throw new Unreadable(`an unclosed ${open}`);
  };

  while (i < n) {
    const c = src[i];
    if (c === '\\') {
      if (src[i + 1] === '\n') {
        i += 2;
        continue;
      }
      word += src[i + 1] ?? '';
      inWord = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      const k = src.indexOf("'", i + 1);
      if (k < 0) throw new Unreadable('an unclosed quote');
      word += src.slice(i + 1, k);
      inWord = true;
      i = k + 1;
      continue;
    }
    if (c === '"') {
      inWord = true;
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\') {
          word += src[i + 1] ?? '';
          i += 2;
        } else if (src[i] === '$' && src[i + 1] === '(' && src[i + 2] !== '(') {
          const [body, end] = balanced(i + 2, '(', ')');
          seg.subs.push(body);
          word += '$(…)';
          i = end;
        } else if (src[i] === '`') {
          const k = src.indexOf('`', i + 1);
          if (k < 0) throw new Unreadable('an unclosed backtick');
          seg.subs.push(src.slice(i + 1, k));
          word += '$(…)';
          i = k + 1;
        } else word += src[i++];
      }
      if (i >= n) throw new Unreadable('an unclosed quote');
      i++;
      continue;
    }
    if (c === '$' && src[i + 1] === '(') {
      inWord = true;
      if (src[i + 2] === '(') {
        // Arithmetic: $(( … )).
        const [, end] = balanced(i + 2, '(', ')');
        word += '0';
        i = end;
        if (src[i] === ')') i++;
        continue;
      }
      const [body, end] = balanced(i + 2, '(', ')');
      seg.subs.push(body);
      word += '$(…)';
      i = end;
      continue;
    }
    if (c === '`') {
      inWord = true;
      const k = src.indexOf('`', i + 1);
      if (k < 0) throw new Unreadable('an unclosed backtick');
      seg.subs.push(src.slice(i + 1, k));
      word += '$(…)';
      i = k + 1;
      continue;
    }
    if (c === '$' && src[i + 1] === '{') {
      inWord = true;
      const [body, end] = balanced(i + 2, '{', '}');
      word += `\${${body}}`;
      i = end;
      continue;
    }
    if (c === ' ' || c === '\t') {
      endWord();
      i++;
      continue;
    }
    if (c === '#' && !inWord) {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '\n') {
      endSeg('\n');
      i++;
      // A heredoc's body starts on the next line.
      for (const h of heredocs.splice(0)) {
        const lines: string[] = [];
        let done = false;
        while (i <= n) {
          const e = src.indexOf('\n', i);
          const line = src.slice(i, e < 0 ? n : e);
          i = e < 0 ? n + 1 : e + 1;
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) {
            done = true;
            break;
          }
          lines.push(line);
        }
        if (!done) throw new Unreadable('a heredoc that never ends');
        h.seg.heredoc = (h.seg.heredoc ?? '') + lines.join('\n');
      }
      continue;
    }
    if (c === '&' && src[i + 1] === '&') {
      endSeg('&&');
      i += 2;
      continue;
    }
    if (c === '|') {
      const two = src[i + 1] === '|' || src[i + 1] === '&';
      endSeg(src.slice(i, i + (two ? 2 : 1)));
      i += two ? 2 : 1;
      continue;
    }
    if (c === ';') {
      endSeg(';');
      i += src[i + 1] === ';' ? 2 : 1;
      continue;
    }
    if (c === '&' && src[i + 1] !== '>') {
      endSeg('&');
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      endSeg(c);
      i++;
      continue;
    }
    if (c === '<' || c === '>' || (c === '&' && src[i + 1] === '>')) {
      // `2>`: the file descriptor is not a word.
      if (inWord && /^\d+$/.test(word)) {
        word = '';
        inWord = false;
      }
      endWord();
      let op = c === '&' ? '&>' : c;
      i += c === '&' ? 2 : 1;
      while (src[i] === c || (op === '>' && (src[i] === '|' || src[i] === '&'))) {
        op += src[i];
        i++;
      }
      if (op === '<<<') {
        herestring = true;
      } else if (op === '<<' || op === '<<-') {
        while (src[i] === ' ' || src[i] === '\t') i++;
        let delim = '';
        while (i < n && !/[\s;&|<>()]/.test(src[i])) {
          if (src[i] === "'" || src[i] === '"') {
            const q = src[i];
            const k = src.indexOf(q, i + 1);
            if (k < 0) throw new Unreadable('an unclosed quote');
            delim += src.slice(i + 1, k);
            i = k + 1;
          } else if (src[i] === '\\') {
            delim += src[i + 1] ?? '';
            i += 2;
          } else delim += src[i++];
        }
        if (!delim) throw new Unreadable('a heredoc with no delimiter');
        heredocs.push({ delim, strip: op === '<<-', seg });
      } else if (op === '>&' || op === '<&') {
        // `2>&1`: a file descriptor, unless it's `>&file`.
        let j = i;
        while (src[j] === ' ') j++;
        const m = /^(\d+|-)/.exec(src.slice(j));
        if (m) i = j + m[1].length;
        else redirect = op;
      } else redirect = op;
      continue;
    }
    word += c;
    inWord = true;
    i++;
  }
  endSeg('');
  if (heredocs.length) throw new Unreadable('a heredoc that never ends');
  return segs;
}

// ---- What counts as safe -----------------------------------------------------------------------

const SENSITIVE = [
  /\/\.ssh(\/|$)/,
  /\/\.aws(\/|$)/,
  /\/\.gnupg(\/|$)/,
  /\/\.kube(\/|$)/,
  /\/\.config\/(gh|gcloud|git\/credentials|op)(\/|$)/,
  /\/\.docker\/config\.json$/,
  /\/\.(netrc|npmrc|pypirc|git-credentials|pgpass)$/,
  /\/\.codex\/(auth\.json|config\.toml)$/,
  /\/\.claude(\.json|\/\.credentials\.json)$/,
  /^\/etc\/(shadow|gshadow|sudoers|ssh)(\/|$)/,
  /^\/proc\/[^/]+\/environ$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /\.(pem|p12|pfx|keystore)$/,
  // The office's own data: its accounts, sign-ins, hook tokens and settings.
  /\/\.agent-office\/(?!worktrees(\/|$)|bin(\/|$))/,
  /\/\.config\/agent-office(\/|$)/,
  /\/office\.env$/,
];

/** Folders whose contents anyone rebuilds: `rm -rf` of them is routine. */
const DISPOSABLE = /^(node_modules|dist|build|out|target|coverage|tmp|temp|\.tmp|\.cache|\.next|\.nuxt|\.turbo|\.parcel-cache|\.gradle|\.tox|\.venv|venv|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.vite|\.svelte-kit|\.angular|\.expo|[^/]+\.egg-info)$/;

const READ_ONLY = new Set(
  `ls cat head tail wc grep egrep fgrep rg ag tree stat file du df diff cmp sort uniq cut tr echo printf pwd date whoami id uname hostname which type whereis basename dirname realpath readlink true false test [ sleep seq xxd od hexdump strings jq yq [[ column fold nl rev md5sum sha1sum sha256sum sha512sum shasum cksum base64 env printenv ps pgrep lsof ss netstat uptime free nproc dig nslookup host ping man help less more comm paste join expand unexpand tac look getconf locale lscpu lsblk groups tty arch nm objdump ldd readelf whoami`.split(/\s+/),
);

/** Builtins that change nothing outside the shell. */
const SHELL_BUILTINS = new Set('export unset alias unalias set shopt ulimit umask trap read wait jobs fg bg history clear hash let : return break continue shift local declare typeset getopts'.split(' '));

/** Compilers and project tools, run the usual way. */
const BUILD_TOOLS = new Set(
  'make cmake ninja gcc g++ cc c++ clang clang++ rustc cargo go javac java mvn gradle gradlew dotnet tsc tsx ts-node vite vitest jest mocha eslint prettier esbuild webpack rollup swc biome ruff black isort flake8 mypy pyright pytest tox nox uv poetry pdm hatch pipenv ruby bundle gem rake php composer lua luajit swift elixir mix erl rebar3 ghc cabal stack sbt scala kotlinc deno bun playwright cypress'.split(' '),
);

const PYTHON = /^python([0-9.]*)$/;
const INTERPRETERS = new Set(['node', 'nodejs', 'ruby', 'perl', 'php', 'lua', 'deno', 'bun', 'tsx', 'ts-node']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const PKG = new Set(['npm', 'pnpm', 'yarn', 'pip', 'pip3', 'npx', 'pnpx']);
const LOCAL_NPX = new Set('tsc tsx vite vitest jest eslint prettier playwright ts-node next esbuild tailwindcss prisma mocha cypress biome turbo nx wrangler'.split(' '));

/** Programs that run with someone else's authority, or change the machine rather than the project. */
const SYSTEM = new Set(
  'sudo su doas pkexec chown chgrp setfacl mount umount dd mkfs fdisk parted losetup swapon swapoff modprobe insmod rmmod sysctl iptables ip6tables nft ufw useradd userdel usermod groupadd groupdel passwd chpasswd crontab at visudo reboot shutdown halt poweroff init telinit apt apt-get aptitude dpkg yum dnf rpm snap flatpak pacman apk brew launchctl service kill pkill killall'.split(' '),
);
const REMOTE = new Set('ssh scp sftp rsync nc ncat netcat socat telnet ftp mosh'.split(' '));
const CLOUD = new Set('docker podman kubectl helm terraform tofu pulumi aws gcloud az ansible ansible-playbook vagrant flyctl heroku vercel netlify railway wrangler'.split(' '));

const brief = (s: string, n = 70) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

class Judge {
  readonly reasons: string[] = [];
  private readonly home: string;
  private readonly writable: string[];
  private readonly temp: string[];

  constructor(
    private root: string,
    opts: JudgeOptions,
  ) {
    this.home = opts.home ?? os.homedir();
    this.temp = [...(opts.temp ?? ['/tmp', '/var/tmp', os.tmpdir()])].filter(Boolean).map((p) => path.resolve(p));
    this.writable = [root, ...this.temp];
  }

  ask(reason: string) {
    if (!this.reasons.includes(reason)) this.reasons.push(reason);
  }

  /** The absolute path `p` names from `cwd`, or undefined when it depends on something that isn't known yet. */
  resolve(p: string, cwd: string): string | undefined {
    if (!p || p.includes('$(…)')) return undefined;
    let q = p;
    if (q === '~' || q.startsWith('~/')) q = this.home + q.slice(1);
    else if (/^\$\{?HOME\}?(\/|$)/.test(q)) q = q.replace(/^\$\{?HOME\}?/, this.home);
    else if (/^\$\{?(PWD|TMPDIR)\}?(\/|$)/.test(q)) q = q.replace(/^\$\{?(PWD|TMPDIR)\}?/, (_, v) => (v === 'PWD' ? cwd : '/tmp'));
    else if (q.includes('$')) return undefined;
    // A glob: judge the folder it starts in.
    const glob = q.search(/[*?[{]/);
    if (glob >= 0) q = q.slice(0, q.lastIndexOf('/', glob) + 1) || './';
    return path.resolve(cwd, q);
  }

  within(abs: string, roots = this.writable): boolean {
    return roots.some((r) => abs === r || abs.startsWith(r.endsWith('/') ? r : `${r}/`));
  }

  sensitive(abs: string): boolean {
    return SENSITIVE.some((re) => re.test(abs));
  }

  /** A path read from: anywhere, but not the places secrets live. */
  read(p: string, cwd: string, what: string) {
    const abs = this.resolve(p, cwd);
    if (abs && this.sensitive(abs)) this.ask(`${what} ${brief(p, 40)}, where credentials or the office's own secrets are kept`);
  }

  /** A path written to: inside the worker's folder or a temp folder. */
  write(p: string, cwd: string, what: string): string | undefined {
    if (/^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/.test(p)) return undefined;
    const abs = this.resolve(p, cwd);
    if (!abs) {
      this.ask(`${what} a path the command works out as it runs (${brief(p, 40)})`);
      return undefined;
    }
    if (this.sensitive(abs)) this.ask(`${what} ${brief(p, 40)}, where credentials or the office's own secrets are kept`);
    else if (!this.within(abs)) this.ask(`${what} ${brief(p, 40)}, outside the worker's own folder`);
    return abs;
  }

  /** Judges a whole command line (or script). */
  command(src: string, cwdStart: string, depth = 0) {
    if (depth > MAX_DEPTH) return this.ask('a command nested too deeply to read');
    let segs: Segment[];
    try {
      segs = parse(src);
    } catch (e) {
      if (e instanceof Unreadable) return this.ask(`a command the office can't read safely (${e.message})`);
      throw e;
    }
    let cwd = cwdStart;
    for (let k = 0; k < segs.length; k++) {
      const seg = segs[k];
      for (const sub of seg.subs) this.command(sub, cwd, depth + 1);
      for (const r of seg.redirects) {
        if (r.op === '<' || r.op === '<&') this.read(r.target, cwd, 'reads');
        else this.write(r.target, cwd, 'writes to');
      }
      // Something fetched from the network and piped into an interpreter runs unseen.
      const next = segs[k + 1];
      if (seg.pipes && next && /^(curl|wget)$/.test(this.name(seg.words))) {
        const to = this.name(next.words);
        if (SHELLS.has(to) || PYTHON.test(to) || INTERPRETERS.has(to) || to === 'sudo') this.ask(`runs a script it downloads without looking at it (\`${brief(seg.words.join(' '), 40)} | ${to}\`)`);
      }
      cwd = this.simple(seg, cwd, depth, k > 0 && segs[k - 1].pipes) ?? cwd;
    }
  }

  /** The program a simple command runs, past assignments and wrappers. */
  private name(words: string[]): string {
    return this.strip(words).cmd ?? '';
  }

  private strip(words: string[]): { cmd?: string; args: string[]; assigns: string[] } {
    let i = 0;
    const assigns: string[] = [];
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) assigns.push(words[i++]);
    // Words that just introduce a command, and wrappers that run the next one.
    while (i < words.length && /^(if|then|else|elif|do|while|until|!|\{|\}|time|nohup|command|builtin|exec|stdbuf|nice|ionice|setsid|unbuffer)$/.test(words[i])) {
      const w = words[i++];
      if ((w === 'nice' || w === 'ionice') && /^-/.test(words[i] ?? '')) i += words[i] === '-n' || words[i] === '-c' ? 2 : 1;
    }
    if (words[i] === 'timeout') {
      i++;
      while (/^-/.test(words[i] ?? '')) i += /^-[sk]$/.test(words[i]) ? 2 : 1;
      i++; // the duration
    }
    if (words[i] === 'env') {
      i++;
      while (i < words.length && (/^-/.test(words[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) {
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) assigns.push(words[i]);
        i++;
      }
    }
    return { cmd: words[i], args: words.slice(i + 1), assigns };
  }

  /** Judges one simple command. Returns the folder it leaves the shell in. */
  private simple(seg: Segment, cwd: string, depth: number, piped: boolean): string | undefined {
    const { cmd: raw, args, assigns } = this.strip(seg.words);
    for (const a of assigns) {
      if (/^(LD_PRELOAD|LD_LIBRARY_PATH|PATH|SHELL|BASH_ENV|ENV|PYTHONPATH|PYTHONSTARTUP|NODE_OPTIONS|GIT_SSH_COMMAND|GIT_EXTERNAL_DIFF|GIT_ASKPASS|EDITOR|VISUAL|PAGER)=/.test(a)) this.ask(`changes how programs start (\`${a.split('=')[0]}\`)`);
    }
    if (!raw) return undefined;
    if (raw.includes('$(…)') || (raw.includes('$') && !/^\$\{?HOME\}?\//.test(raw))) {
      this.ask(`runs a program whose name is worked out as it runs (${brief(raw, 30)})`);
      return undefined;
    }
    // Structural words of loops and conditions.
    if (/^(for|select|done|fi|esac|in)$/.test(raw)) return undefined;
    if (raw === 'case') return void this.ask('uses a shell `case` statement, which the office does not read');
    if (raw === 'function' || /^[A-Za-z_][\w-]*\(\)$/.test(raw)) return void this.ask('defines a shell function');

    const ctx: Ctx = { cwd, depth, seg, piped };
    if (raw.includes('/')) {
      // `./script`, `.venv/bin/python`, `/usr/bin/env`: a program in the worker's own folder is the worker's own.
      const abs = this.resolve(raw, cwd);
      const base = path.basename(raw);
      if (abs && (this.within(abs, [this.root]) || /^\/(usr|bin|opt)\//.test(abs))) {
        if (PYTHON.test(base) || INTERPRETERS.has(base) || BUILD_TOOLS.has(base) || PKG.has(base) || base === 'git' || READ_ONLY.has(base) || SHELLS.has(base)) return this.known(base, args, ctx);
        if (this.within(abs, [this.root])) {
          for (const o of this.operands(args)) this.read(o, cwd, 'reads');
          return undefined;
        }
      }
      return void this.ask(`runs \`${brief(raw, 40)}\`, a program outside the worker's own folder`);
    }
    return this.known(raw, args, ctx);
  }

  /** The arguments that aren't options (everything after `--` counts). */
  private operands(args: string[]): string[] {
    const out: string[] = [];
    let rest = false;
    for (const a of args) {
      if (!rest && a === '--') rest = true;
      else if (rest || !a.startsWith('-') || a === '-') out.push(a);
    }
    return out;
  }

  private known(cmd: string, args: string[], ctx: Ctx): string | undefined {
    const { cwd, depth, seg } = ctx;
    const opts = args.filter((a) => a.startsWith('-') && a !== '-' && a !== '--');
    const operands = this.operands(args);
    const shortFlags = opts.filter((o) => !o.startsWith('--')).join('').replace(/-/g, '');
    const has = (...flags: string[]) => flags.some((f) => (f.startsWith('--') ? opts.some((o) => o === f || o.startsWith(`${f}=`)) : shortFlags.includes(f)));

    if (cmd === 'cd' || cmd === 'pushd') {
      const target = operands[0];
      if (!target) return undefined;
      const abs = this.resolve(target, cwd);
      if (!abs) return void this.ask(`moves to a folder it works out as it runs (${brief(target, 40)})`);
      this.read(target, cwd, 'moves into');
      return abs;
    }
    if (cmd === 'popd') return undefined;
    if (SHELL_BUILTINS.has(cmd)) return undefined;
    if (cmd === 'source' || cmd === '.') {
      const f = operands[0];
      const abs = f ? this.resolve(f, cwd) : undefined;
      if (!abs || !this.within(abs, [this.root])) this.ask(`runs a script from outside the worker's own folder (${brief(f ?? '', 40)})`);
      return undefined;
    }
    if (cmd === 'eval') return void this.ask('runs text it builds as it goes (`eval`)');
    if (SYSTEM.has(cmd)) {
      const why = /^(sudo|su|doas|pkexec)$/.test(cmd) ? 'runs as root' : /^(kill|pkill|killall)$/.test(cmd) ? 'stops running processes' : 'changes the machine, not just the project';
      return void this.ask(`${why} (\`${brief([cmd, ...args].join(' '), 50)}\`)`);
    }
    if (REMOTE.has(cmd)) return void this.ask(`talks to another machine (\`${brief([cmd, ...args].join(' '), 50)}\`)`);
    if (CLOUD.has(cmd)) return this.cloud(cmd, operands, args);
    if (SHELLS.has(cmd)) return this.shell(cmd, args, operands, ctx);
    if (PYTHON.test(cmd)) return this.python(args, operands, ctx);
    if (INTERPRETERS.has(cmd)) return this.interpreter(cmd, args, operands, ctx);
    if (PKG.has(cmd)) return this.packages(cmd, args, operands);
    if (BUILD_TOOLS.has(cmd)) {
      if (cmd === 'make' && operands.some((o) => /^(install|uninstall)$/.test(o))) this.ask('installs into the system (`make install`)');
      if (cmd === 'cargo' && operands[0] === 'publish') this.ask('publishes a package (`cargo publish`)');
      if (cmd === 'composer' && operands[0] === 'global') this.ask('changes the machine-wide tools');
      if (cmd === 'gem' && !/^(list|which|env|help|search|info|query)$/.test(operands[0] ?? '')) this.ask('installs or changes gems');
      return undefined;
    }
    if (cmd === 'git') return this.git(args, cwd);
    if (cmd === 'gh') return void this.gh(operands, args);
    if (cmd === 'curl' || cmd === 'wget') return void this.fetch(cmd, args, opts, cwd);
    if (cmd === 'systemctl') {
      if (!/^(status|show|is-active|is-enabled|is-failed|cat|list-[a-z-]+|get-default)$/.test(operands[0] ?? '')) this.ask(`controls a system service (\`systemctl ${operands[0] ?? ''}\`)`);
      return undefined;
    }
    if (cmd === 'journalctl' || cmd === 'loginctl') return undefined;

    if (cmd === 'rm') return void this.rm(args, operands, cwd, has);
    if (cmd === 'cp' || cmd === 'install') {
      let dest: string | undefined;
      let sources = operands;
      const ti = args.findIndex((a) => a === '-t' || a === '--target-directory');
      const tl = opts.find((o) => o.startsWith('--target-directory='));
      if (ti >= 0) {
        dest = args[ti + 1];
        sources = operands.filter((o) => o !== dest);
      } else if (tl) dest = tl.split('=')[1];
      else {
        dest = operands[operands.length - 1];
        sources = operands.slice(0, -1);
      }
      for (const s of sources) this.read(s, cwd, 'copies');
      if (dest) this.write(dest, cwd, 'copies into');
      return undefined;
    }
    if (cmd === 'mv') {
      for (const o of operands) this.write(o, cwd, 'moves');
      return undefined;
    }
    if (/^(mkdir|touch|rmdir|truncate|ln|mkfifo)$/.test(cmd)) {
      for (const o of operands) this.write(o, cwd, cmd === 'rmdir' ? 'removes' : 'creates');
      return undefined;
    }
    if (cmd === 'mktemp') return undefined;
    if (cmd === 'chmod') {
      const mode = /^([ugoa]*[-+=][rwxXstugo]+(,[ugoa]*[-+=][rwxXstugo]+)*|[0-7]{3,4})$/;
      if (has('R', '--recursive')) this.ask(`changes permissions recursively (\`${brief(['chmod', ...args].join(' '), 50)}\`)`);
      if (args.some((a) => /^(0?777|a\+rwx|[ugoa]*\+s)$/.test(a))) this.ask(`opens up permissions (\`${brief(['chmod', ...args].join(' '), 40)}\`)`);
      for (const o of args.filter((a) => !a.startsWith('-') || a === '-')) if (!mode.test(o)) this.write(o, cwd, 'changes permissions of');
      return undefined;
    }
    if (cmd === 'tee') {
      for (const o of operands) this.write(o, cwd, 'writes to');
      return undefined;
    }
    if (cmd === 'sed') {
      const inPlace = has('i', '--in-place');
      const scripted = has('e', 'f', '--expression', '--file');
      for (const f of operands.slice(scripted ? 0 : 1)) {
        if (inPlace) this.write(f, cwd, 'edits');
        else this.read(f, cwd, 'reads');
      }
      return undefined;
    }
    if (cmd === 'awk' || cmd === 'gawk' || cmd === 'mawk') {
      if (/system\s*\(|\|\s*getline|print[^;}]*>|"\s*\|/.test(args.join(' '))) this.ask('runs commands or writes files from awk');
      for (const f of operands.slice(1)) this.read(f, cwd, 'reads');
      return undefined;
    }
    if (cmd === 'find') return void this.find(args, cwd, depth);
    if (cmd === 'xargs') {
      let i = 0;
      while (i < args.length && args[i].startsWith('-')) i += /^-[IJLnPsdEa]$/.test(args[i]) ? 2 : 1;
      const inner = args.slice(i);
      if (!inner.length) return undefined;
      if (READ_ONLY.has(inner[0]) || /^(cp|mv|mkdir|touch|echo|sed|git|wc|grep|chmod)$/.test(inner[0])) this.command(inner.map(quote).join(' '), cwd, depth + 1);
      else this.ask(`feeds a list into \`${brief(inner[0], 30)}\` with xargs`);
      return undefined;
    }
    if (cmd === 'tar') return void this.tar(args, opts, operands, cwd, has);
    if (/^(unzip|zip|gzip|gunzip|bzip2|bunzip2|xz|unxz|zcat|7z)$/.test(cmd)) {
      const d = args.findIndex((a) => a === '-d');
      if (d >= 0 && args[d + 1]) this.write(args[d + 1], cwd, 'unpacks into');
      for (const o of operands) {
        if (cmd === 'zcat' || cmd === 'unzip') this.read(o, cwd, 'reads');
        else if (/^(gzip|gunzip|bzip2|bunzip2|xz|unxz)$/.test(cmd)) this.write(o, cwd, 'rewrites');
      }
      return undefined;
    }
    if (cmd === 'perl') {
      if (/\b(system|exec|unlink|rmdir|fork)\b|`|open\s*\(?\s*[^)]*\|/.test(args.join(' '))) this.ask('runs commands or deletes files from perl');
      if (has('i')) for (const f of operands.slice(1)) this.write(f, cwd, 'edits');
      return undefined;
    }
    if (cmd === 'patch') {
      for (const f of operands) this.write(f, cwd, 'patches');
      return undefined;
    }
    if (cmd === 'open' || cmd === 'xdg-open') return undefined;
    if (cmd === 'osascript' || cmd === 'xdotool') return void this.ask(`controls the desktop (\`${cmd}\`)`);

    if (READ_ONLY.has(cmd)) {
      for (const o of operands) if (!/^[+-]?\d+$/.test(o)) this.read(o, cwd, 'reads');
      return undefined;
    }
    return void this.ask(`runs \`${brief(cmd, 30)}\`, which isn't one of the everyday commands the office knows`);
  }

  private rm(args: string[], operands: string[], cwd: string, has: (...f: string[]) => boolean) {
    const recursive = has('r', 'R', '--recursive');
    const text = `rm ${brief(args.join(' '), 40)}`;
    for (const o of operands) {
      const abs = this.write(o, cwd, 'deletes');
      if (!abs) continue;
      const glob = /[*?[{]/.test(o);
      const whole = abs === this.root || abs === path.dirname(this.root) || abs === this.home || abs === '/' || this.temp.includes(abs);
      if (/^(\.\/)?(\*{1,2}|\.\*)$/.test(o) || /^(\.|\.\.|~|\/)$/.test(o) || (whole && (!glob || /\/\*$/.test(o)))) {
        this.ask(`deletes everything in a folder, or the folder itself (\`${text}\`)`);
      } else if (recursive) {
        // Inside the worker's own folder (even when that is itself under /tmp) only the usual build folders go freely;
        // anywhere else in a temp folder is scratch space.
        const inRoot = this.within(abs, [this.root]);
        const rel = inRoot ? path.relative(this.root, abs).split('/') : [];
        if (inRoot ? !rel.some((seg) => DISPOSABLE.test(seg)) : !this.within(abs, this.temp)) this.ask(`deletes a folder and everything in it, which can't be undone (\`${text}\`)`);
      }
    }
  }

  private find(args: string[], cwd: string, depth: number) {
    const text = args.join(' ');
    if (/(^|\s)-delete(\s|$)/.test(text)) this.ask('deletes every file it finds (`find … -delete`)');
    if (/(^|\s)-(fprint|fprintf|fls)\d?(\s|$)/.test(text)) this.ask('writes files from `find`');
    const exec = args.findIndex((a) => /^-(exec|execdir|ok|okdir)$/.test(a));
    if (exec >= 0) {
      const end = args.findIndex((a, i) => i > exec && (a === ';' || a === '\;' || a === '+'));
      const inner = args.slice(exec + 1, end < 0 ? undefined : end).filter((a) => a !== '{}');
      if (!inner.length) this.ask('runs a command on every file it finds');
      else if (READ_ONLY.has(inner[0]) || /^(chmod|cp|mv|git|sed|wc|grep|touch|mkdir)$/.test(inner[0])) this.command(`${inner.map(quote).join(' ')} x`, cwd, depth + 1);
      else this.ask(`runs \`${brief(inner[0], 30)}\` on every file it finds`);
    }
    // The places it starts looking.
    for (const a of args) {
      if (a.startsWith('-') || a === '!' || a === '(') break;
      this.read(a, cwd, 'searches');
    }
  }

  private tar(args: string[], opts: string[], operands: string[], cwd: string, has: (...f: string[]) => boolean) {
    if (opts.some((o) => /^--(absolute-names|to-command|checkpoint-action|use-compress-program)/.test(o)) || has('P')) this.ask('unpacks with options that can run programs or write anywhere');
    const c = args.findIndex((a) => a === '-C' || a === '--directory');
    if (c >= 0 && args[c + 1]) this.write(args[c + 1], cwd, 'unpacks into');
    const creating = has('c', '--create') || /^c/.test(args[0] ?? '');
    let file: string | undefined;
    const f = args.findIndex((a) => a === '-f' || a === '--file');
    if (f >= 0) file = args[f + 1];
    else if (opts.some((o) => o.startsWith('--file='))) file = opts.find((o) => o.startsWith('--file='))!.split('=')[1];
    else if (/^-?[a-zA-Z]*f[a-zA-Z]*$/.test(args[0] ?? '')) file = operands[0];
    if (file) {
      if (creating) this.write(file, cwd, 'writes the archive');
      else this.read(file, cwd, 'reads');
    }
  }

  private shell(cmd: string, args: string[], operands: string[], ctx: Ctx): string | undefined {
    const c = args.findIndex((a) => /^-[a-zA-Z]*c$/.test(a));
    if (c >= 0) {
      if (args[c + 1] === undefined) return void this.ask(`runs \`${cmd} -c\` with nothing to read`);
      this.command(args[c + 1], ctx.cwd, ctx.depth + 1);
      return undefined;
    }
    if (operands[0] && operands[0] !== '-') {
      const abs = this.resolve(operands[0], ctx.cwd);
      if (!abs || !this.within(abs, [this.root])) this.ask(`runs a shell script from outside the worker's own folder (${brief(operands[0], 40)})`);
      return undefined;
    }
    if (ctx.seg.heredoc !== undefined) {
      this.command(ctx.seg.heredoc, ctx.cwd, ctx.depth + 1);
      return undefined;
    }
    this.ask(`runs a shell fed from somewhere the office can't see (\`${cmd}\`)`);
    return undefined;
  }

  private python(args: string[], operands: string[], ctx: Ctx): undefined {
    const c = args.findIndex((a) => a === '-c');
    const m = args.findIndex((a) => a === '-m');
    if (c >= 0 && args[c + 1] !== undefined) this.code('Python', args[c + 1], PY_RISKS);
    if (ctx.seg.heredoc !== undefined) this.code('Python', ctx.seg.heredoc, PY_RISKS);
    if (m >= 0 && /^(pip|ensurepip)$/.test(args[m + 1] ?? '')) this.packages('pip', args.slice(m + 2), this.operands(args.slice(m + 2)));
    const script = c < 0 && m < 0 ? operands[0] : undefined;
    if (script && script !== '-') this.read(script, ctx.cwd, 'runs');
    else if (c < 0 && m < 0 && ctx.seg.heredoc === undefined && ctx.piped) this.ask('runs Python code piped in from another command');
    return undefined;
  }

  private interpreter(cmd: string, args: string[], operands: string[], ctx: Ctx): undefined {
    const js = cmd === 'node' || cmd === 'nodejs' || cmd === 'deno' || cmd === 'bun' || cmd === 'tsx' || cmd === 'ts-node';
    const e = args.findIndex((a) => a === '-e' || a === '--eval' || a === '-p' || a === '--print' || a === '-r');
    if (e >= 0 && args[e + 1] !== undefined) this.code(cmd, args[e + 1], js ? JS_RISKS : GENERIC_RISKS);
    if (ctx.seg.heredoc !== undefined) this.code(cmd, ctx.seg.heredoc, js ? JS_RISKS : GENERIC_RISKS);
    if (e < 0 && operands[0] && operands[0] !== '-') this.read(operands[0], ctx.cwd, 'runs');
    else if (e < 0 && ctx.seg.heredoc === undefined && ctx.piped) this.ask(`runs ${cmd} code piped in from another command`);
    return undefined;
  }

  /** Inline code: its own kind of command, scanned for the few things worth stopping for. */
  private code(lang: string, src: string, risks: [RegExp, string][]) {
    for (const [re, why] of risks) if (re.test(src)) this.ask(`${lang} code that ${why}`);
    // What it shells out to is judged as a shell command too.
    for (const m of src.matchAll(/(?:os\.system|subprocess\.(?:run|call|check_call|check_output|Popen)|execSync|exec|spawnSync)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) this.command(m[2], this.root, 1);
  }

  private packages(cmd: string, args: string[], operands: string[]): undefined {
    const sub = operands[0] ?? '';
    const globalFlag = args.some((a) => a === '-g' || a === '--global' || a === '--location=global');
    if (/^(publish|unpublish|deprecate|login|logout|adduser|token|owner|access|dist-tag|team|org|hook)$/.test(sub) && !cmd.startsWith('pip')) this.ask(`changes what's published on a package registry (\`${cmd} ${sub}\`)`);
    else if (globalFlag && /^(install|i|add|uninstall|remove|rm|update|up|link)$/.test(sub)) this.ask(`changes tools installed for the whole machine (\`${cmd} ${sub} -g\`)`);
    else if (sub === 'global') this.ask(`changes tools installed for the whole machine (\`${cmd} global\`)`);
    else if ((cmd === 'npx' || cmd === 'pnpx') && !LOCAL_NPX.has(operands[0] ?? '')) this.ask(`downloads and runs a package (\`${brief(`${cmd} ${operands[0] ?? ''}`, 40)}\`)`);
    else if (/^(dlx|create|init)$/.test(sub) && operands[1] && cmd !== 'pip') this.ask(`downloads and runs a package (\`${cmd} ${sub} ${brief(operands[1], 30)}\`)`);
    else if (cmd.startsWith('pip') && args.some((a) => /^--(break-system-packages|target|prefix|root)/.test(a))) this.ask('installs outside the project (`pip --break-system-packages` or similar)');
    return undefined;
  }

  private cloud(cmd: string, operands: string[], args: string[]): undefined {
    const verb = operands[0] === 'compose' ? (operands[1] ?? '') : (operands[0] ?? '');
    const readOnly = (cmd === 'docker' || cmd === 'podman') && /^(ps|images|image|logs|inspect|version|info|stats|top|port|history|search|ls)$/.test(verb);
    const kube = cmd === 'kubectl' && /^(get|describe|logs|version|config|top|explain|api-resources|cluster-info)$/.test(operands[0] ?? '');
    const tf = (cmd === 'terraform' || cmd === 'tofu') && /^(plan|validate|fmt|show|output|version|providers|graph)$/.test(operands[0] ?? '');
    if (!readOnly && !kube && !tf) this.ask(`controls containers or cloud infrastructure (\`${brief([cmd, ...args].join(' '), 50)}\`)`);
    return undefined;
  }

  private fetch(cmd: string, args: string[], opts: string[], cwd: string) {
    const text = ` ${args.join(' ')}`;
    const method = /\s(?:-X|--request)[ =]?(\w+)/.exec(text)?.[1]?.toUpperCase();
    if ((method && method !== 'GET' && method !== 'HEAD') || /\s(-d|--data[\w-]*|-F|--form[\w-]*|-T|--upload-file|--json|--post-data|--post-file|--body-data|--body-file)(?=[\s=]|$)/.test(text)) {
      this.ask(`sends data to a server, not just fetches (\`${brief([cmd, ...args].join(' '), 50)}\`)`);
    }
    const out = args.findIndex((a) => a === '-o' || a === '--output' || a === '--output-document' || (cmd === 'wget' && a === '-O'));
    if (out >= 0 && args[out + 1] && (!args[out + 1].startsWith('-') || args[out + 1] === '-')) {
      if (args[out + 1] !== '-') this.write(args[out + 1], cwd, 'saves the download to');
    }
    for (const o of opts) {
      const m = /^--(?:output|output-document)=(.+)$/.exec(o);
      if (m) this.write(m[1], cwd, 'saves the download to');
    }
  }

  private gh(operands: string[], args: string[]) {
    const [group = '', verb = ''] = operands;
    if (group === 'api') {
      const text = ` ${args.join(' ')}`;
      const method = /\s(?:-X|--method)[ =]?(\w+)/.exec(text)?.[1]?.toUpperCase();
      if ((method && method !== 'GET') || /\s(-f|-F|--field|--raw-field|--input)(?=[\s=]|$)/.test(text)) this.ask(`changes something on GitHub through its API (\`${brief(`gh ${args.join(' ')}`, 50)}\`)`);
      return;
    }
    const read = /^(view|list|status|diff|checks|search|browse|watch|download|ls|get|show|clone|checkout)$/.test(verb);
    if (/^(secret|variable|ssh-key|gpg-key|extension|alias|config|codespace|cache|ruleset)$/.test(group)) this.ask(`changes GitHub account or repository settings (\`gh ${group} ${verb}\`)`);
    else if (group === 'auth' && verb !== 'status' && verb !== 'token') this.ask(`changes the GitHub sign-in (\`gh auth ${verb}\`)`);
    else if (group === 'repo' && /^(delete|create|edit|transfer|archive|rename|fork|sync|deploy-key)$/.test(verb)) this.ask(`changes a GitHub repository itself (\`gh repo ${verb}\`)`);
    else if (group === 'release' && !read) this.ask(`publishes or deletes a release (\`gh release ${verb}\`)`);
    else if (group === 'workflow' && /^(run|enable|disable)$/.test(verb)) this.ask(`starts or switches a workflow (\`gh workflow ${verb}\`)`);
    else if ((group === 'pr' && /^(merge|close|lock)$/.test(verb)) || (group === 'issue' && /^(delete|transfer|lock|pin)$/.test(verb))) this.ask(`closes or merges something on GitHub (\`gh ${group} ${verb}\`)`);
    else if (group === 'run' && /^(delete|cancel|rerun)$/.test(verb)) this.ask(`changes a workflow run (\`gh run ${verb}\`)`);
  }

  private git(args: string[], cwd: string): string | undefined {
    // Options before the subcommand: -C <dir>, -c k=v, --git-dir…
    let i = 0;
    let where = cwd;
    while (i < args.length && args[i].startsWith('-')) {
      if (args[i] === '-C' && args[i + 1]) {
        const abs = this.resolve(args[i + 1], cwd);
        if (!abs || !this.within(abs)) this.ask(`works in a repository outside the worker's own folder (${brief(args[i + 1], 40)})`);
        else where = abs;
        i += 2;
      } else if (args[i] === '-c' && args[i + 1]) {
        if (/^(core\.(sshCommand|fsmonitor|hooksPath|pager|editor)|alias\.|credential\.|protocol\.|http\.proxy|url\.)/i.test(args[i + 1])) this.ask(`changes how git runs programs (\`-c ${brief(args[i + 1], 30)}\`)`);
        i += 2;
      } else if (/^--(git-dir|work-tree|exec-path|namespace)$/.test(args[i])) i += 2;
      else i++;
    }
    const sub = args[i] ?? '';
    const rest = args.slice(i + 1);
    const flags = rest.filter((a) => a.startsWith('-') && a !== '--');
    const operands = this.operands(rest);
    const has = (...f: string[]) => f.some((x) => (x.startsWith('--') ? flags.some((o) => o === x || o.startsWith(`${x}=`)) : flags.some((o) => /^-[a-zA-Z]+$/.test(o) && o.includes(x[1]))));
    const risky = (what: string) => this.ask(`${what} (\`git ${brief([sub, ...rest].join(' '), 50)}\`)`);
    switch (sub) {
      case 'push':
        if (flags.some((f) => f.startsWith('--force')) || has('-f')) risky('overwrites history on the remote');
        else if (has('-d', '--delete', '--mirror', '--prune') || operands.some((o) => o.startsWith('+') || o.startsWith(':'))) risky('deletes branches or tags on the remote');
        break;
      case 'reset':
        if (has('--hard', '--merge', '--keep')) risky('throws away uncommitted work');
        break;
      case 'clean':
        if (!has('-n', '--dry-run')) risky('deletes files git is not tracking');
        break;
      case 'checkout':
      case 'switch':
        if (has('-f', '--force', '--discard-changes') || rest.includes('--') || (sub === 'checkout' && operands.includes('.'))) risky('throws away uncommitted changes');
        break;
      case 'restore':
        if (!(has('--staged') && !has('--worktree', '-W'))) risky('throws away uncommitted changes');
        break;
      case 'branch':
        if (has('-D', '-M') || (has('-d', '--delete') && has('-f', '--force'))) risky('force-deletes or moves a branch');
        break;
      case 'stash':
        if (/^(drop|clear)$/.test(operands[0] ?? '')) risky('throws away stashed work');
        break;
      case 'reflog':
        if (/^(expire|delete)$/.test(operands[0] ?? '')) risky('erases the record of past states');
        break;
      case 'gc':
        if (flags.some((f) => f.startsWith('--prune'))) risky('permanently removes history git still holds');
        break;
      case 'prune':
      case 'filter-branch':
      case 'filter-repo':
      case 'replace':
        risky('permanently rewrites or removes repository history');
        break;
      case 'update-ref':
        if (has('-d')) risky('deletes a reference');
        break;
      case 'worktree':
        if (operands[0] === 'remove' && has('-f', '--force')) risky('force-removes a worktree');
        break;
      case 'config':
        if (has('--global', '--system', '--worktree', '-f', '--file')) risky('changes git settings for the whole machine');
        if (/^(core\.(sshCommand|fsmonitor|hooksPath|pager|editor)|alias\.|credential\.)/i.test(operands[0] ?? '') && !has('--get', '--list', '-l')) risky('changes how git runs programs');
        break;
      case 'clone':
      case 'init': {
        const dest = operands[sub === 'clone' ? 1 : 0];
        if (dest && !/^[a-z]+:\/\//.test(dest) && !dest.includes('@')) this.write(dest, where, 'creates a repository in');
        break;
      }
      case 'rm':
        for (const o of operands) this.write(o, where, 'removes');
        break;
      default:
        break;
    }
    return undefined;
  }
}

interface Ctx {
  cwd: string;
  depth: number;
  seg: Segment;
  /** What this command reads comes from another command's output. */
  piped: boolean;
}

/** A word, quoted so the shell reads it back as one. */
const quote = (w: string) => `'${w.replace(/'/g, `'\\''`)}'`;

const PY_RISKS: [RegExp, string][] = [
  [/\bshutil\.rmtree\b|\brmtree\s*\(/, 'deletes whole folders'],
  [/\bos\.(remove|unlink|rmdir|removedirs)\b|\.unlink\s*\(|\.rmdir\s*\(|\bsend2trash\b/, 'deletes files'],
  [/\bos\.(system|popen|exec[lv]p?e?|spawn[lv]p?e?)\b/, 'runs shell commands (os.system and friends)'],
  [/\brequests\.(post|put|delete|patch)\b|\bhttpx\.(post|put|delete|patch)\b|urlopen\([^)]*data\s*=|\bsmtplib\b|\bftplib\b|\bparamiko\b|\bsocket\.socket\b/, 'sends data over the network'],
  [/open\s*\(\s*['"](\/etc|\/root|\/var|\/usr|\/bin|\/boot|~\/\.(ssh|aws|gnupg|config))/, 'writes to system or credential folders'],
  [/\bsubprocess\.\w+\(\s*\[\s*['\"](rm|sudo|dd|mkfs|chmod|chown|kill|pkill|shutdown|reboot)['\"]/, 'runs destructive shell commands'],
  [/\bos\.chmod\s*\([^)]*0o?777|\bos\.chown\b|\bos\.setuid\b/, 'changes ownership or opens permissions'],
  [/\bctypes\b|\b__import__\s*\(|\beval\s*\(|\bexec\s*\(\s*(requests|urllib|base64)/, 'builds and runs code on the fly'],
];

const JS_RISKS: [RegExp, string][] = [
  [/\.(rmSync|rmdirSync|unlinkSync|rm|rmdir|unlink|remove|emptyDir|emptyDirSync)\s*\(|\brimraf\b/, 'deletes files or folders'],
  [/\bchild_process\b.*\b(rm|sudo|dd|mkfs|chmod|chown)\b|\bexecSync\s*\(\s*['"`]\s*(rm|sudo)\b/, 'runs destructive shell commands'],
  [/\bfetch\s*\([^)]*method\s*:\s*['"](POST|PUT|DELETE|PATCH)|\baxios\.(post|put|delete|patch)\b|\bnet\.connect\b|\bnodemailer\b/, 'sends data over the network'],
  [/\beval\s*\(|\bnew Function\s*\(|\bvm\.run/, 'builds and runs code on the fly'],
  [/\bprocess\.env\b[^;]*\b(fetch|http|axios)\b/, 'sends environment values over the network'],
];

const GENERIC_RISKS: [RegExp, string][] = [
  [/\b(system|exec|popen|unlink|rmdir|rm_rf|rmtree|FileUtils\.rm)\b|`[^`]+`/, 'runs shell commands or deletes files'],
];

/**
 * Whether a shell command is obviously fine to run without asking: `safe` when every part is on the
 * everyday list and stays in the worker's own folder (`cwd`) or a temp folder.
 */
export function judgeCommand(command: string, cwd: string, opts: JudgeOptions = {}): Verdict {
  const root = path.resolve(cwd || '/nonexistent-workspace');
  const j = new Judge(root, opts);
  if (!cwd) j.ask("the worker's folder isn't known");
  if (!command.trim()) j.ask('an empty command');
  else if (command.length > MAX_COMMAND) j.ask('a very long command the office would rather not guess about');
  else j.command(command, root);
  return { safe: j.reasons.length === 0, reasons: j.reasons };
}

// ---- The lever ---------------------------------------------------------------------------------

/** What the hook for a permission request told the office. */
export interface PermissionRequest {
  workerId: string;
  workerName: string;
  floor?: string;
  tool: string;
  /** For a shell command: what it runs. Otherwise a short account of what the tool wants. */
  command?: string;
  description?: string;
  cwd?: string;
}

export interface Review {
  /** Answer it for the worker, so it never asks. */
  allow: boolean;
  card?: ApprovalCard;
}

const MAX_CARD_COMMAND = 1200;
const SHELL_TOOLS = /^(Bash|shell|local_shell|exec_command|container\.exec)$/;

/**
 * The state of the lever (kept in <data>/approvals.json), and what the office does with a permission
 * request: answers it when the lever is up and the command is obviously fine, and otherwise turns it
 * into a card for people to see.
 */
export class Approvals {
  private easy = false;
  private by?: string;
  private at?: number;
  private cards = new Map<string, ApprovalCard>();
  private readonly file: string;

  constructor(
    dataDir: string,
    private emit: (state: ApprovalsState) => void,
  ) {
    this.file = path.join(dataDir, 'approvals.json');
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as { easy?: unknown; by?: unknown; at?: unknown };
      this.easy = s.easy === true;
      this.by = typeof s.by === 'string' ? s.by : undefined;
      this.at = typeof s.at === 'number' ? s.at : undefined;
    } catch {
      // never set: the lever is down
    }
  }

  get on(): boolean {
    return this.easy;
  }

  state(): ApprovalsState {
    return { easy: this.easy, by: this.by, at: this.at, cards: [...this.cards.values()] };
  }

  set(easy: boolean, by: string) {
    if (easy === this.easy) return;
    this.easy = easy;
    this.by = by;
    this.at = Date.now();
    if (!easy) this.cards.clear();
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ easy, by, at: this.at }), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the easy approvals lever: ${(err as Error).message}`);
    }
    this.emit(this.state());
  }

  /** A worker's card goes when it's answered (or it goes home). */
  clear(workerId: string) {
    if (this.cards.delete(workerId)) this.emit(this.state());
  }

  /** Looks at a permission request: answers it, or puts up a card for it. Nothing happens with the lever down. */
  review(req: PermissionRequest, opts: JudgeOptions = {}): Review {
    if (!this.easy) return { allow: false };
    if (SHELL_TOOLS.test(req.tool) && req.command) {
      const verdict = judgeCommand(req.command, req.cwd ?? '', opts);
      if (verdict.safe) {
        this.clear(req.workerId);
        return { allow: true };
      }
      return { allow: false, card: this.card(req, verdict.reasons) };
    }
    return { allow: false, card: this.card(req, [`${req.tool} wants to do something the office doesn't judge`]) };
  }

  private card(req: PermissionRequest, reasons: string[]): ApprovalCard {
    const card: ApprovalCard = {
      workerId: req.workerId,
      worker: req.workerName,
      floor: req.floor,
      tool: req.tool,
      command: req.command?.slice(0, MAX_CARD_COMMAND),
      description: req.description?.slice(0, 400),
      reasons: reasons.slice(0, 5),
      at: Date.now(),
    };
    this.cards.set(req.workerId, card);
    this.emit(this.state());
    return card;
  }
}
