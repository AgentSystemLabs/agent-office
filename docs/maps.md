# Maps

Back to the [README](../README.md).

The office is one map the building can be. Under **⚙️ Settings → 🏢 Building → Map**, anyone can change it for everyone, on every floor: to the **🏰 Castle**, or to a map of your own. Everything that makes the office work comes along: the workers and their terminals, the issues and PR boards, the task queue and its agent, the services board, meetings, the merge gong, the budget and the limits. Workers keep their seats, since every map places the same seats (see [Seats](#seats)), so a map can change while they work.

The office has plenty of its own that a map doesn't (the elevator, the balcony, the rooftop bar, the lounge, the dog, pictures on the walls). On another map you go to another project from the floor list in the top-left corner (or **☰ → Floors**), and each project's hall is dressed in its own colors.

## The castle

A long stone hall with a timber roof, pillars and pointed arches down both sides, stained glass high in the walls and fire everywhere.

- **The throne.** At the far end, up on a dais, is a throne of iron blades. You arrive on it (if nobody else is sitting there). Walk off, or jump, to get up; **E** at it sits you back down.
- **The line.** A worker that's done, or waiting on you, gets up from its table and comes to stand in line before the throne, the one that has waited longest at the front. From the throne, **E** is for whoever's first in line (its terminal; **P** to prompt it, **O** for its PR, **X** to send it home, as at a desk). Once it's been seen to, it walks back to its seat and the rest shuffle up. There's room for eight: anyone past that waits at their table, jumping, as in the office.
- **The Hand of the King.** He stands at your left. Speak to him (**E** by him, or from the throne when nobody's in line) and say what a new worker should do: it runs off to the first free seat at the tables and gets started. A worker the task queue sends comes in through the great doors.
- **The tables.** Two long tables down each side of the hall, benches along them. The workers work at open tomes, whose pages show their terminals. The seats toward the middle of the hall fill first; the ones along the walls come out when they're all taken, as the office's bean bags do.
- **Wear and tear.** Workers here dress as peasants, and the longer one works the more worn out it looks: a beard that grows out and goes from brown to grey to white, down to the floor, dirt and patched clothes, bags under its eyes, a hunch and a slower walk. It's fully spent after 30 minutes of work (`agents.ageMinutes`). Only time spent working counts, over the worker's whole stay, and the office keeps it through a restart.
- **The boards** hang on the side walls, with a scribe at a lectern under each of the issues, queue and PR boards (the board agents). The **small council**'s round table, near the dais, is the meeting room: **E** at it calls a meeting, and its easel shows what the meeting writes. The gong is by the dais, and there's ale by the hearth (it works like the office's coffee).

## Maps of your own

A map is plain JSON. Put a file in the office's `.agent-office/maps/` folder: `~/agent-office/.agent-office/maps/` for an office started without a project, or `<dir>/.agent-office/maps/` for `agent-office <dir>`. It's read whenever someone opens ⚙️ Settings or joins, so there's nothing to restart: open Settings and it's in the list. A map that won't load is listed with why.

The easy way is to start from the castle and change only what you want. This one moves the issues board to the first bay and makes the line shorter:

```json
{
  "id": "my-hall",
  "name": "My hall",
  "extends": "castle",
  "boards": { "issues": { "z": -21 } },
  "lineup": { "count": 5 }
}
```

`extends` fills in everything you leave out from the map you name. Objects are merged key by key (so `boards.issues.z` changes one number of one board), and lists replace the whole list (give `tables` or `props` and they're all yours). A map can extend another map of your own, a few deep. The office itself is built in code, so it can't be extended; extend `castle` instead.

Units are meters. The hall runs from `x = -width/2` (west) to `width/2` (east) and from `z = -length/2` (north) to `length/2` (south); `y` is up. Angles (`rotY`) are in radians: `0` faces south (+z), `π/2` (1.5708) east, `π` north and `-π/2` west. The castle's config, [`src/shared/maps/castle.ts`](../src/shared/maps/castle.ts), is a full example of every part.

### What a map has

| Field | What it is |
| --- | --- |
| `id` | Lowercase letters, digits and dashes. The building's pick is saved by it. |
| `name`, `icon`, `description` | What Settings shows. |
| `extends` | Another map's `id` to start from. |
| `style` | Which builder puts it up. `"castle"` is the only one so far. |
| `hall` | `{ width, length, height }`: the room, and how high its walls are (up to 110 m either way). |
| `spawn` | `{ x, z, rotY }`: where you stand when you arrive and the throne's taken. |
| `door` | `{ x, z }`: just inside the way in and out. The doorway goes in the nearest wall; workers come in and go home through it. |
| `throne` | `{ x, z, rotY, dais: { width, depth, height, steps } }`: your seat, on a dais that runs 2.4 m in front of it and the rest behind. Optional. |
| `herald` | `{ x, z, rotY, name, says }`: who sends out new workers. Optional. |
| `lineup` | `{ x, z, rotY, step: [dx, dz], count }`: the first spot in line, and each next one `step` further on, all facing `rotY`. Optional. |
| `tables` | `[{ x, z, length, seats, width?, rotY?, sides?, name? }]`: where the workers sit. `seats` is per side; `sides` is `"both"` (the default), `"inner"` or `"outer"`; `rotY` 0 runs the table along z. |
| `stations` | `{ issues, queue, pulls }`, each `{ x, z, rotY }`: the board agents' lecterns. `rotY` is the way the agent faces; it stands 0.55 m behind its lectern. |
| `council` | `{ x, z, rotY }`: the meeting table. Five chairs go round it, the head of the table at `rotY`'s side, and its easel 2.5 m behind the other way. |
| `boards` | `{ issues, queue, pulls, services }`, each `{ x, y, z, rotY, width, height, label? }`: the boards on the walls, `rotY` the way each faces. |
| `props` | `[{ kind, x, z, … }]`: everything else, from the list below. |
| `agents` | `{ outfit: "peasant" \| "none", ageMinutes }`: how the workers dress, and how many minutes of work until they look spent (`0`: never). |
| `palette` | `{ stone, floor, carpet, wood, trim }`: CSS colors. The banners and shields take each floor's own color. |

### Seats

Every map has the same seats, by id, so that the server, the task queue, meetings and saved workers work on any of them: 16 regular seats (`desk-1` to `desk-16`), 12 more that come out once those are taken (`beanbag-1` to `beanbag-12`), the three board agents' places and the five meeting chairs. The tables' seats are handed out in order: first the side of every table toward the middle of the hall (its inner side), table by table in the order they're listed, then their other sides the same way. Along a table they go from one end to the other, north to south for one that runs along z. So `desk-1` is the first seat on the first table's inner side, and a map's tables must seat at least 28 between them; any seats past that are just bench.

### Props

| `kind` | What it is |
| --- | --- |
| `pillar` | A stone pillar, floor to roof. Pillars in a row (the same `x`, up to 9 m apart) get pointed arches between them. `scale` widens it. |
| `torch` | A torch in an iron sconce, `y` up a wall or pillar, burning toward `rotY`. |
| `brazier` | A fire in an iron bowl on legs. |
| `chandelier` | A ring of candles hanging from the roof at `y`. |
| `banner` | A banner hanging on a wall, its top at `y`, `width` by `height`, facing `rotY`. One 3 m wide or more is the great banner, with the project's name on it. |
| `window` | A tall pointed stained-glass window, its sill at `y`, `width` by `height`. |
| `rose` | A round stained-glass window, its middle at `y`, `width` across. |
| `carpet` | A carpet runner, `width` by `length` along `rotY`. |
| `statue` | A stone knight on a plinth. |
| `armor` | A suit of armour with a halberd. |
| `shield` | A shield and crossed swords, hung at `y`. |
| `hearth` | A fireplace against a wall, `width` wide, facing `rotY`. |
| `gong` | The merge gong (one at most). |
| `cask` | Casks of ale: **E** for a drink that perks you up, like the office's coffee. |
| `table` | A table with nothing to sit at, `width` by `length`. |
| `candles` | A tall iron candle stand. |

Give a `torch`, `brazier` or `hearth` `"light": true` and it lights the room for real (the first eight do; the rest glow). What stands on the floor is walked round by the workers and bumped into by you; what hangs on a wall isn't in the way.

## Adding to the code

- **The model** is in [`src/shared/maps/`](../src/shared/maps): `types.ts` is the schema, `index.ts` checks a config and works out its plan (every seat, the line, the boards and what's in the way for walking round), `props.ts` has the props and the floor each takes, and `castle.ts` is the castle. The server keeps the building's pick in `.agent-office/map.json` ([`src/server/maps.ts`](../src/server/maps.ts)) and checks where people sit against the map.
- **A new prop kind** is its name and footprint in `props.ts`, and how it looks in the style's builder ([`src/client/world/castle.ts`](../src/client/world/castle.ts)).
- **A new style** is a builder that turns a plan into a `World` ([`src/client/world/world.ts`](../src/client/world/world.ts)): a scene group, colliders, what can be used, a view for every seat, the four boards, a walk grid, the ways in and out, and optionally a gong, the meeting's board, a mood (how it's lit) and a herald. Add it to `MAP_STYLES` and to `worldFor` in `main.ts`.
- **Workers walking about** (lining up, coming back, running to their seats) is [`src/client/world/court.ts`](../src/client/world/court.ts), for any map with a `lineup`.
