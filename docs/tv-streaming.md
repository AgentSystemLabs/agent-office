# Streaming to the TV

Back to the [README](../README.md), or see [Features](features.md) for the short version.

The big TV on the east wall — the one in front of the couch, 6.4 m across — used to have exactly one
thing to show: whoever was screen sharing. It now plays links too. Paste a YouTube link, a direct
`.mp4`, anything with an embeddable player, and everyone on the floor sees it on the same TV at the
same moment, controlled from the TV itself.

- [What plays](#what-plays)
- [Everyone stays in step](#everyone-stays-in-step)
- [Theatre mode](#theatre-mode)
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

## Theatre mode

There is a light switch on the wall beside the TV, at the height you flip one at, and it is a
real switch in the room: anyone on the floor can press **E** on it and the office's own light goes
down, so the picture on the 6.4 m screen is the brightest thing in the room. The room comes down
over about a second, the way a dimmer does, and the switch's own rocker tips over and its little
lamp lights while it is. Nothing about the film changes: the switch is the light's, so the video
carries on exactly where it was (`Tv.theatre` deliberately doesn't touch `at`, the second the
position is measured from).

The dim is done in the sky's own shader, per fragment, rather than by turning lights off
(`Sky.setTheatre`, `client/world/sky.ts`):

- Everything the sun, the sky and the office's lamps have given a fragment **inside the office's
  walls** is scaled down by `THEATRE_DIM`, the emissive lamp globes included, so the room goes dark
  in the middle of the afternoon as well as at night. Fragments outside are untouched: the street
  keeps its lamps, and the daylight still comes in through the windows.
- The unlit materials (glass, the board signs, the meeting panel) are dimmed in the fog pass
  instead, since they never had any light to take away — except the TV's screen, which carries
  `userData.theatreLit` and is skipped. A link's picture is HTML over the canvas and was never lit at
  all, but a **screen share** is painted on that mesh, so without the flag the switch would put out
  the one thing it exists to make brighter. The picture is the only thing in the room the switch
  cannot touch.
- The halos round the office's own bulbs are points, not lit materials, so they are sorted by
  whether they are in the room (`indoors` in sky.ts) and dimmed on the CPU. The street's go on.
- `Sky.lightAt` dims your own hands by the same amount, or you would be the one lit thing in the
  picture.

The light the screen throws on the wall round it is a soft additive patch just off the wall
(`client/world/theatre.ts`), which fades up with the dim and only while there is something on the
screen. The picture itself is drawn over the canvas, so the patch is the spill round its edge and
never washes over it.

The state is the floor's, in `theatre` on the same `TvState` as the link, so it rides the same
message, the same `tv.json` and the same hosted-floor path. The **🎬 Lights down / 💡 Lights back
up** row in the TV window is the same switch, for anyone who is on the couch rather than standing
at the wall.

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
3. What's in front of the TV becomes the frame's own mask (`TvScreen.occlude`). Ordinary HTML can't
   be depth-tested against the scene, so the screen is divided into a small grid and each cell is
   asked whether a wall, a desk, a plant or someone standing there is between your eye and that
   point. The cells that are spoken for go into a little canvas the browser stretches over the frame
   as its `mask-image`, so the picture is hidden behind what's in front of it rather than painted
   over it. Glass and fences don't count, being things you can see through; people do, though they
   aren't colliders. It's worked out at most every 80 ms, into a 32×18 grid, and only the colliders
   whose outline on screen can reach the TV's are tested at all — the office has a few hundred and
   most of them are nowhere near the lounge.
4. The layer is set to `display: none` whenever the TV can't be seen at all: you're on the roof, on
   another map, the camera has turned past it, or every last cell of the mask is behind something.
   The meeting room's and the loft's glass panes are colliders with `glass: true`, so looking at the
   TV *through* glass still shows it.

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
| **E** at the switch, or **🎬 / 💡** in the window | `tv.theatre { on }` | The room's light down for the picture, or back up — without moving the film |

The server answers every one of them with `{ t: 'tv', state }`, which the browser keeps in
`store.tv` under the `tv` topic, exactly like `jukebox`. Arriving on a floor gets the whole state in
`FloorView.tv`.

## What each file does

| File | Piece |
| --- | --- |
| `src/shared/tv.ts` | `TvState` (with `theatre`), `checkTvUrl`, `classify` (YouTube / media / embed), `youtubeId`, `embedUrl`, `startSeconds` (reading `t=`/`start=`), `positionAt` — one source of truth for client and server |
| `src/server/tv.ts` | `class Tv`: the five operations above, `tv.json` kept with mode `0o600`, like `Jukebox` |
| `src/server/floor.ts` | `Floor.tv`, one per floor's checkout |
| `src/server/server.ts` | The `tv.*` cases in the message router, `tvChanged` to the floor, `tv:` in `floorView()` |
| `src/shared/protocol.ts` | The five messages, `{ t: 'tv', state }` and `FloorView.tv` |
| `src/client/state.ts` | The `tv` topic, `store.tv`, `enter()` and `apply()` |
| `src/client/tvscreen.ts` | The layer: what to load for a link, keeping every player in step, the per-frame projection, and the mask of what's in front of it |
| `src/client/world/sky.ts` | `setTheatre` and the `skyRoomLight` dim in the shader, `indoors` for the halos |
| `src/client/world/theatre.ts` | `buildTheatre`: the switch on the wall, its rocker and lamp, and the light off the screen |
| `src/client/world/office.ts` | The TV itself is unchanged; its glass panes are colliders marked `glass: true`, so they don't hide it, and the switch's bit of wall is a fixture so no picture hangs over it |
| `src/client/main.ts` | Wiring: **E** at the TV and at the switch, the hint bar, painting the screen dark under the picture, the per-frame `update` |
| `src/client/ui/tv.ts` | The TV window: what's on, ▶️/⏸️/⏹️, a scrubber, the **The room** row, the link box, **Open in a tab ↗**, **Share screen** and your own sound (mute and volume) |
| `tests/tv.test.ts` | Link parsing and validation, `positionAt`, the switch leaving the film alone, and `class Tv` surviving a restart |

## Controls

- **E** at the TV opens the window. While someone's screen sharing it still watches that full
  screen, as before — putting a link on takes one paste in the window.
- In the window: paste a link and **📺 Play**, pause and resume, drag to seek, **⏹️ Stop**, and
  **Your sound** — a mute button and a volume slider for your own speakers, the same row ⚙️ Settings
  gives the TV. It's just yours, like the jukebox's volume, and it sticks between visits. A player
  that won't take the order (an arbitrary embed has no sound knob at all) says so.
- **🖥️ Share screen** is there too, because sharing used to be what **E** at the TV did; starting one
  turns the link off the screen (see above), and **▶️ Play** brings it back once the share ends.
- The hint bar over the TV says what's on before you press anything.
- **E** at the switch by the wall puts the room in theatre mode and **E** again brings the light
  back. It's the floor's, not yours, so it works the same from the **🎬 / 💡** row in the TV window
  (handy from the couch), and the office says who threw it either way.

## Limits, and what's deliberately left out

- **Embedding is at the site's discretion.** Sites that send `X-Frame-Options` or a CSP
  `frame-ancestors` won't appear; the office can't and doesn't proxy them.
- **Audio is local, and distance-aware where the player allows it.** Direct videos and YouTube use
  the same inverse-distance falloff as the jukebox, so they get quieter as you walk away; arbitrary
  cross-origin embeds cannot expose a volume control and keep the browser's own media volume. The
  TV still has its own volume and mute in the TV window and under ⚙️ Settings → **TV**, and it's
  yours alone.
- **Pause and seek only reach players with an API** (YouTube, `<video>`). For an arbitrary embed,
  everyone still starts together; drift after that is the embed's business.
- **No full-screen viewer yet** — sitting on the couch opens the full-screen viewer for a *share*,
  as before, but a link plays on the TV itself, which is 6.4 m across. A second screen elsewhere in
  the room (the walls are all spoken for: boards, windows, the ladder, the hoop, the elevator) would
  need its own seating, and is the obvious next step if two things need to be on at once.
- **Theatre mode dims the whole office, not just the lounge.** The room is one open space, so the
  switch can't light one end of it without the other, and the shader works out "inside the office's
  walls" rather than "near the TV". The lamps' halos are sorted the same way, so the balcony and
  the street keep their lights.
- **The switch stays where it was left.** Turning the TV off doesn't turn the lights back on,
  because a switch is a switch; the **💡 Lights back up** row, or **E** at the plate, is how you
  undo it, and the state is kept in `tv.json` with everything else about the screen.
