# Floor hosts: running a floor on someone else's machine

Back to the [README](../README.md). The engineering plan is
[remote-agents-plan.md](remote-agents-plan.md).

A **floor host** lets one machine serve a floor for an office running on another. Everyone still joins
the *same* office — one address, one chat, one set of boards — and a floor whose checkout lives on
your laptop runs there, as you, on your disk, with your sign-ins.

The laptop dials the office. Nothing listens on your machine, and nothing inbound is needed: no port,
no firewall change, no NAT traversal.

> **Status: the mechanism is built and tested; the office's screens are not wired to it yet.** A
> machine can pair, connect, and be asked for floors, and the office holds a proxy for each one — but
> a hosted floor does not appear in the elevator yet, so it cannot be entered from the browser. See
> [what is not done](#what-is-not-done) before relying on this.

## Pairing

On the **office**:

```bash
agent-office hosts pair --name "Alice's laptop"
```

That prints a code, valid for 30 minutes and good once. Give it to whoever is bringing the machine.

On **their** machine:

```bash
agent-office floor-host --office wss://the-office.example --code FB9N-0HA3 --name "Alice's laptop"
```

The `--code` is only for the first time. The office answers with a **token**, which the machine keeps
at `~/.agent-office-floor-host.json` in mode `0600` and reuses. Nobody carries a token between
machines, and the office keeps only a hash of it — a copy of its `hosts.json` admits nobody.

After that:

```bash
agent-office floor-host --office wss://the-office.example
```

The address is whatever reaches the office: `ws://localhost:4600` for a local one, or the tunnel's
hostname if it is behind one. `http`/`https` are accepted and turned into `ws`/`wss`.

## Managing machines, on the office

```bash
agent-office hosts                     # what is admitted, and whether each is connected
agent-office hosts seats <name> 4      # how many workers it will seat across its floors
agent-office hosts accept <name> on    # whether an automation hire may seat there
agent-office hosts revoke <name>       # end it
```

`accept` is the only place a person and a robot differ. **A person may always hire onto any machine.**
A queue task or a board agent — a stranger's prompt arriving by automation — may only hire onto a
machine whose owner has turned `accept` on. Every refusal is about capacity or kind and names the
machine: *"Alice's laptop has no free desk"*, never anything about who is asking.

`revoke` is total and immediate. The token stops working at the next connection, every floor that
machine carried goes offline at once, and pairing again makes a **new** machine rather than reviving
the old one — so revoking is not something undone by accident.

## What hosting a machine means

**There is no container isolation.** A worker on a hosted floor runs as you, on your machine, with
your environment. Everyone in the office can type into its terminal, which means everyone in the
office can reach what you can: `~/.ssh`, `~/.config/gh`, `.env` files, cloud credentials.

That is a deliberate decision, and it is the thing to understand before pairing. The containment is
not a sandbox — it is that **you hold the connection**:

- Close the laptop and the floor stops receiving work immediately.
- `Ctrl+C` the `floor-host` and the same.
- Nothing in the office can reach your machine while that process is not running.

Three features are refused on a hosted floor rather than served, because they are files in the
floor's own data directory and the office must never read a checkout it does not own — the
**whiteboard**, the **dog** and the **docs**. Each says so, and names the machine.

## Whose sign-ins

A hosted floor's workers run on **the host machine's** sign-ins, always. The office does not send its
own, and cannot ask a hosted floor to use them. That is enforced where the floor's context is built:
`runAs` and `forgeAs` are simply not given to it.

Its commits carry its own git identity too, so work from a hosted floor is attributed to the person
whose machine ran it.

## How a floor gets there

The office decides *what* runs on a machine; the machine decides *whether to answer*. On the office:

1. Add the floor to the building as usual, in the office's own project folder.
2. Its `FloorDef` gains a `host` naming the paired machine, and its `dir` becomes the path **on that
   machine**.

The machine is told which floors the office wants when it connects, and serves the ones whose `dir`
exists there. One that does not is skipped and said so, rather than pretended.

## What is not done

Stated plainly, because the alternative is someone finding out the hard way:

| | |
|---|---|
| **A hosted floor does not appear in the elevator.** | The office holds the proxy and knows the machine, but the screens read the local floor list. Selecting one from the browser is not wired yet. |
| **The host does not yet run a real `Floor`.** | It opens the checkout and announces the floor, and answers a call with a refusal that names the machine rather than doing nothing. Running the floor's own workers, queue and forge there is the next piece. |
| **A machine is not yet told its floors by the office's building list at startup** in every path. | `floorsFor` reads the building, so it is correct for a floor added with a `host`; adding one from the UI is not wired. |

None of these is a design problem — each is a piece of wiring with a named place to land. What is
built is the hard part: the pairing, the socket, the direction, the proxy and the refusals, with the
tests to match.

## Trying it without two machines

```bash
npx tsx scripts/e2e-floor-host.mjs
```

Runs both sides in one process: a pairing code, a token kept at `0600`, a floor served, the machine
going away, and the same machine coming back with its token and no code.

```bash
npm run demo:floor-host
```

Shows the proxy itself: a hire shipped over the socket, a read answered with nothing on the wire, and
every later call refused by name once the machine goes.

## The pieces

| | |
|---|---|
| `src/server/hosts.ts` | the pairing registry, `hosts.json`, and `agent-office hosts` |
| `src/server/floor-hosts.ts` | the `/floor-host` socket and the connected machines |
| `src/server/remote-floor.ts` | the proxy the office holds in place of a `Floor` |
| `src/server/floor-actions.ts` | the surface both satisfy, and why it splits the way it does |
| `src/server/floor-host-cli.ts` | `agent-office floor-host` |
| `src/shared/floorhost.ts` | the frames, the 45 floor cases, and the validators |
