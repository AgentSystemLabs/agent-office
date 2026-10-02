# Workers' servers on your own computer

Back to the [README](../README.md).

When the office runs on a server, the web servers its workers start (`npm run dev`, a preview build, `python -m http.server`) listen on that machine, not on yours. `agent-office tunnel` brings them to you: run it once on your own computer and leave it running, and whenever a worker starts a server, the same port opens on your computer. `http://localhost:5173` in your browser is the worker's `localhost:5173`. When the worker stops the server, the port closes again a few seconds later. There's no command per server, and nothing to restart when a new one shows up.

```bash
agent-office tunnel office@203.0.113.7
```

That's the SSH address **👥 Invite teammates** shows (on Railway, Fly.io and Dokploy it looks like `ssh://office@host:2222`). It opens the SSH tunnel to the office, opens the office in your browser, and then follows the workers:

```
  🔌 agent-office tunnel

  opening the tunnel to office@203.0.113.7…
  the office: http://localhost:4600 (over SSH to office@203.0.113.7)

  Every web server a worker starts opens on the same port here. Leave this running; Ctrl-C closes them all.

  + http://localhost:5173  Vite App — vite --port 5173 (Byte on agent-office)
  + http://localhost:3000  api — tsx watch src/server.ts (Mochi on agent-office)
  - localhost:5173 closed: Byte stopped the server
```

Already have the office open in a browser? Give it that address instead, and it leaves the way you get there alone:

```bash
agent-office tunnel                              # http://localhost:4600: deploy/aws.sh open, or the ssh command, is running
agent-office tunnel http://localhost:4601        # a tunnel on another port
agent-office tunnel https://office.example.com   # an office on its own domain
agent-office tunnel https://agent-office.tail1234.ts.net   # or on your tailnet
```

The **🌐 Services** board in the office shows the command for the way you came in, ready to copy.

## Getting the command

It's part of `agent-office`, so it needs Node.js 20 or newer and the office installed on your computer (you don't have to run one there). To install without starting an office:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.sh | AGENT_OFFICE_INSTALL_ONLY=1 bash
```

```powershell
$env:AGENT_OFFICE_INSTALL_ONLY = 1; irm https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.ps1 | iex
```

The office it talks to has to be new enough to list its workers' servers. If it isn't, the command says so: upgrade the office (**⬆️ Upgrade the office** in the **☰** menu, or the deploy script's `update`).

## Signing in

It signs in the way a browser does. The first time, it asks for the office password (or your name and your own password, if you have an account) in the terminal. It keeps the session, not the password, in `~/.config/agent-office/tunnel.json`, which only you can read, so it doesn't ask again for two weeks. Delete that file to sign it out.

For a script, set `AGENT_OFFICE_PASSWORD` (and `--name` or `AGENT_OFFICE_NAME` for an account).

## What it opens, and for whom

- **The same port, or not at all.** A worker's server on 5173 is `localhost:5173` on your computer, so links, redirects and a front end that calls `localhost:3000` all work as they do for the worker. If something on your computer already has that port, the tunnel says so and leaves it alone, then opens it by itself once the port is free.
- **Web servers.** The ones on the **🌐 Services** board: ports that answer HTTP, WebSockets included, so hot reload works. Every floor's servers open, not just the floor you're standing on.
- **For anything on your computer.** The tunnel is signed in, so a browser, `curl`, a test run or another agent on your computer can use the ports without the office's sign-in. They listen on `127.0.0.1` and `::1` only, and take requests for `localhost` only, so a web page somewhere else can't point a name of its own at them. Ctrl-C closes them all.
- **Through the office.** Everything goes to the office's own port, and the office relays it to the worker's server. So an invited SSH key, which may forward to that one port and nothing else, is enough, and nothing new is opened on the office's machine. The worker's server never sees the office's session.
- **A restart isn't a stop.** A port stays open for about ten seconds after its server leaves the office's list, so a dev server that restarts itself, or an office too busy to see it for a moment, doesn't cut you off. Until it's back, the office answers with a page that says the server isn't running.
- **A tunnel that drops comes back.** Given an SSH address, it notices within a minute that the connection is gone (the laptop slept, the Wi-Fi changed) and opens it again. The ports stay open meanwhile.

## Options

```
agent-office tunnel [where] [options] [-- <ssh options>]

  -p, --port <n>          With an SSH address: the port the office gets on this computer
                          (default: the same as --office-port)
      --office-port <n>   With an SSH address: the office's port on its own machine (default 4600)
      --name <name>       Sign in with this account (env AGENT_OFFICE_NAME)
      --password <pw>     The password, instead of being asked for it (env AGENT_OFFICE_PASSWORD)
      --no-open           With an SSH address: don't open the office in a browser
      --insecure          Accept a certificate nobody vouches for (an office started with --self-signed)
```

Everything after `--` goes to `ssh`, for a key that isn't your default one: `agent-office tunnel office@203.0.113.7 -- -i ~/.ssh/office`.

One server at a time still works, with nothing to install: click it on the **🌐 Services** board to copy an `ssh` command that opens just that one (*Reviewing what workers build* in the [AWS reference](aws.md)).
