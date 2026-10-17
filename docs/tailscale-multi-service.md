# The office next to other apps on one tailnet machine

Back to the [README](../README.md) · [Your own server](self-hosting.md)

A machine on your tailnet has one name, `https://<machine>.<your-tailnet>.ts.net`, and [Tailscale Serve](https://tailscale.com/kb/1312/serve) can put only one app at the root of each HTTPS port. If another app on the same machine (Paperclip, a dashboard, Home Assistant) already has `https://<machine>.<your-tailnet>.ts.net/`, the office can't have it too. And the office can't live under a path like `/office/`: its pages, its assets and its WebSocket all expect to be at the root.

You don't need a reverse proxy for this. Serve gives every HTTPS port its own root, with the same real certificate, so give each app its own port.

## Which way round

**An office you set up by hand** (`agent-office` started yourself, on a Mac mini, a home server, in Docker): put the office on a port of its own and leave the other app where it is.

**An office set up with `deploy/provision.sh --tailscale` or `deploy/aws.sh up --tailscale`**: keep the office on 443 and move the other app. Those set-ups install `agent-office-serve`, which opens a port on the tailnet for each worker's web server and closes every other port that points at the office, except 443. If you move the office to another port, it closes that port too, about ten seconds after the office starts. See [Workers' servers](aws.md#tailscale).

## The office on a port of its own

The other app keeps 443:

```bash
tailscale serve --bg --https=443  http://127.0.0.1:3100   # the other app, unchanged
tailscale serve --bg --https=8444 http://127.0.0.1:4600   # the office
```

The office is then at `https://<machine>.<your-tailnet>.ts.net:8444/`. Start it with `--trust-proxy`, as behind any proxy, so its cookies are `Secure` and sign-in limits count each person separately:

```bash
agent-office --trust-proxy
```

Check that both are there:

```bash
tailscale serve status
```

```
https://<machine>.<your-tailnet>.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:3100

https://<machine>.<your-tailnet>.ts.net:8444 (tailnet only)
|-- / proxy http://127.0.0.1:4600
```

`--bg` keeps the setting after a restart of the machine. To take the office off again: `tailscale serve --https=8444 off`.

## The other app on a port of its own

On a `--tailscale` office, Serve already has the office on 443. Give the other app another port:

```bash
tailscale serve --bg --https=3100 http://127.0.0.1:3100
```

It's then at `https://<machine>.<your-tailnet>.ts.net:3100/`. Don't pick a port a worker's web server might use (5173, 3000, 8080 and the like): the office would take that port over for the worker's server.

## What to know

- **Voice and screen sharing work on any port.** The browser needs HTTPS with a certificate it trusts, and Serve's certificate is for the machine's name, so it covers every port.
- **Any port works on the tailnet.** Only [Funnel](https://tailscale.com/kb/1223/funnel), which opens a port to the internet, is limited to 443, 8443 and 10000. The office on Funnel is open to anyone who finds the link, behind its sign-in only: give everyone an account and turn the shared password off (**🔑 Accounts**) first.
- **The port is part of the link.** Teammates open `https://<machine>.<your-tailnet>.ts.net:8444/`, not the bare name.
- **Paths don't mix with the office.** Serve can route `/app` on one port to one app and `/` to another (`tailscale serve --set-path=/app …`). Other apps can share the office's port that way, but the office has to be at `/`.
- **Subdomains need more than Serve.** A machine gets one name on the tailnet, so `office.<machine>.…` and `app.<machine>.…` aren't available. To give each app a name of its own, run a second Tailscale node for it, for example the [Tailscale Docker container](https://tailscale.com/kb/1282/docker) next to the app, with its own hostname.
