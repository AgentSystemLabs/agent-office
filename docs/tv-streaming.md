# Streaming to the TV

Back to the [README](../README.md), or see [Features](features.md) for the short version.

The big TV on the east wall — the one in front of the couch, 6.4 m across — used to have exactly one
thing to show: whoever was screen sharing. It now plays links too. Paste a YouTube link, a direct
`.mp4`, anything with an embeddable player, and everyone on the floor sees it on the same TV at the
same moment, controlled from the TV itself.

- [What plays](#what-plays)
- [Everyone stays in step](#everyone-stays-in-step)
- [Why the picture is HTML, not a texture](#why-the-picture-is-html-not-a-texture)
- [The state, and where it lives](#the-state-and-where-it-lives)
- [What each file does](#what-each-file-does)
- [Controls](#controls)
- [Limits, and what's deliberately left out](#limits-and-whats-deliberately-left-out)

## What plays

You press **E** at the TV with a link in your hand (well, on the clipboard) and the office works out
how to show it:

| You paste | How it plays |
| --- | --- |
| A YouTube link (`watch?v=`, `youtu.be`, `/shorts/`, `/live/`, `/embed/`) | The YouTube IFrame player on `youtube-nocookie.com`, driven through YouTube's IFrame API so play, pause and seek reach everyone |
| A direct media file (`.mp4`, `.webm`, `.mov`, `.ogg`, `.mp3`, `.wav`…) | A plain `<video>` element, played and seeked directly |
| Vimeo, and any other site that offers an embed | Its player in an `<iframe>`: it plays, and everyone starts together, but play/pause from the TV only reach the ones that have an API |
| Anything else | An `<iframe>`. Most sites refuse to be framed (`X-Frame-Options` / `frame-ancestors`) — those show nothing, and the **Open in a tab ↗** link in the TV window is the way to watch instead |

If YouTube's API can't be had at all (blocked, offline), a YouTube link falls back to the plain
iframe too, which starts where it's told and then runs as it likes.

A link with a timestamp in it (`…watch?v=…&t=1h2m3s`, `…&start=90`) starts at that moment for
everyone. Links are checked on the way in (`checkTvUrl`, shared by the server and the browser): only
`http`/`https`, at most 2048 characters, and not your own office (a page of your own origin inside
the TV would be able to reach out and touch the page it's framed in).

Screen sharing still wins the TV while it's live, and it takes the TV rather than sharing it: the
moment a share starts, the browser turns the link off with `tv.stop` (the link itself is kept, so
**▶️ Play** puts it back on once the share ends). The two are never on the screen at once, so there
is no picture to fight the share for the screen — and **E** at the TV watches the share full screen
while it lasts, as before.

## Everyone stays in step

This is the same trick the jukebox uses (see [How it works](how-it-works.md#jukebox)), with pause and
seek on top:

```ts
TvState = { on, url, by, playing, position, at }
```

`position` (seconds into the video) and `playing` are what was true at `at`, on the office's clock.
Each browser works out where the TV must be *right now* from `store.officeNow()` — the office clock
it lines itself up with from the quickest `pong` — and seeks its own player when it drifts more than
a couple of seconds. Nobody streams video through the server: the server keeps four numbers and a
link, and every browser plays the link itself. So it costs a websocket message to start, pause or
seek, and nothing at all to keep running.

The state sits with the rest of a floor's things in `<project>/.agent-office/tv.json`, so a restart
brings back what was on. Each floor has its own TV: what's on yours says nothing about another
project's.

## Why the picture is HTML, not a texture

WebGL can only draw pixels it is allowed to read, and a cross-origin player (YouTube's, Vimeo's)
hands out none of them. The office already proxies images for the walls through `/api/image`, but
that endpoint refuses HTML on purpose, and copying a live, DRM-ish, *playing* iframe into a canvas
isn't possible in a browser at all. So the picture is an ordinary HTML element — an `<iframe>` or a
`<video>` — living in a layer over the canvas, re-projected onto the TV's rectangle every frame:

1. The four corners of the TV's screen mesh are taken in world space and projected through the
   camera to viewport pixels.
2. The 2D projective transform (a homography, solved as an 8×8 system) that maps the element's four
   corners onto those four points becomes a CSS `matrix3d(...)`.
3. The layer is set to `display: none` whenever the TV can't be seen: you're on the roof, on another
   map, behind the wall it hangs on (a ray from your eye to the middle of the screen, tested against
   the world's colliders), or the camera has turned past it. The meeting room's and the loft's glass
   panes are colliders with `glass: true`, so looking at the TV *through* glass still shows it.

`pointer-events: none` throughout: the TV is scenery, so clicks and mouse-look pass straight through
it. That's also why the player's own controls aren't clickable — the TV window (**E**) is where you
pause, seek and stop. It sits below the HUD and the windows in the page, so nothing it does covers
your controls.

The alternative — CSS3DRenderer — was rejected: it wants scene units to be CSS pixels, the office
measures in metres, and it draws over geometry regardless of depth. A single projected quad needs
neither.

## The state, and where it lives

Four messages, all floor-wide, all validated server-side (`src/server/tv.ts`):

| You do | Message | What it means |
| --- | --- | --- |
| Paste a link and press **📺 Play** | `tv.play { url, position? }` | On, from `position` (default: the link's own timestamp, else 0) |
| **▶️ / ⏸️** | `tv.play` / `tv.pause` | Carry on from where it was paused, or stop it where the office works out it has got to |
| Drag the scrubber | `tv.seek { position }` | Jump, keeping play and pause as they were |
| **⏹️ Stop** | `tv.stop` | Off; the link stays so **Play** puts it on again |

The server answers every one of them with `{ t: 'tv', state }`, which the browser keeps in
`store.tv` under the `tv` topic, exactly like `jukebox`. Arriving on a floor gets the whole state in
`FloorView.tv`.

## What each file does

| File | Piece |
| --- | --- |
| `src/shared/tv.ts` | `TvState`, `checkTvUrl`, `classify` (YouTube / media / embed), `youtubeId`, `embedUrl`, `startSeconds` (reading `t=`/`start=`), `positionAt` — one source of truth for client and server |
| `src/server/tv.ts` | `class Tv`: the four operations above, `tv.json` kept with mode `0o600`, like `Jukebox` |
| `src/server/floor.ts` | `Floor.tv`, one per floor's checkout |
| `src/server/server.ts` | The `tv.*` cases in the message router, `tvChanged` to the floor, `tv:` in `floorView()` |
| `src/shared/protocol.ts` | The four messages, `{ t: 'tv', state }` and `FloorView.tv` |
| `src/client/state.ts` | The `tv` topic, `store.tv`, `enter()` and `apply()` |
| `src/client/tvscreen.ts` | The layer: what to load for a link, keeping every player in step, and the per-frame projection |
| `src/client/world/office.ts` | The TV itself is unchanged; its glass panes are colliders marked `glass: true`, so they don't hide it |
| `src/client/main.ts` | Wiring: **E** at the TV, the hint bar, painting the screen dark under the picture, the per-frame `update` |
| `src/client/ui/tv.ts` | The TV window: what's on, ▶️/⏸️/⏹️, a scrubber, the link box, **Open in a tab ↗**, **Share screen** and your own 🔇/🔊 |
| `tests/tv.test.ts` | Link parsing and validation, `positionAt`, and `class Tv` surviving a restart |

## Controls

- **E** at the TV opens the window. While someone's screen sharing it still watches that full
  screen, as before — putting a link on takes one paste in the window.
- In the window: paste a link and **📺 Play**, pause and resume, drag to seek, **⏹️ Stop**, and
  **🔇 / 🔊** for your own speakers — that one is just yours, like the jukebox's volume (a player that
  won't take the order says so).
- **🖥️ Share screen** is there too, because sharing used to be what **E** at the TV did; starting one
  turns the link off the screen (see above), and **▶️ Play** brings it back once the share ends.
- The hint bar over the TV says what's on before you press anything.

## Limits, and what's deliberately left out

- **Embedding is at the site's discretion.** Sites that send `X-Frame-Options` or a CSP
  `frame-ancestors` won't appear; the office can't and doesn't proxy them.
- **No audio routing.** The TV plays through the browser's own media volume, not the office's Web
  Audio mix, so it isn't quieter when you walk away (a cross-origin player can't be routed through
  Web Audio at all — the jukebox's stream has the same rule).
- **Pause and seek only reach players with an API** (YouTube, `<video>`). For an arbitrary embed,
  everyone still starts together; drift after that is the embed's business.
- **No full-screen viewer yet** — sitting on the couch opens the full-screen viewer for a *share*,
  as before, but a link plays on the TV itself, which is 6.4 m across. A second screen elsewhere in
  the room (the walls are all spoken for: boards, windows, the ladder, the hoop, the elevator) would
  need its own seating, and is the obvious next step if two things need to be on at once.
