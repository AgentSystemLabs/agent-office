# Maps

Back to the [README](../README.md).

The office is one map the building can be. Under **⚙️ Settings → 🏢 Building → Map**, anyone can change it for everyone, on every floor: to the **🏰 Castle**, or to a map of your own. Everything that makes the office work comes along: the workers and their terminals, the issues and PR boards, the task queue and its agent, the services board, meetings, the merge gong, the budget and the limits. Workers keep their seats, since every map places the same seats (see [Seats](#seats)), so a map can change while they work.

The office has plenty of its own that a map doesn't (the elevator, the balcony, the rooftop bar, the lounge, the dog, pictures on the walls). On another map you go to another project from the floor list in the top-left corner (or **☰ → Floors**), and each project's hall is dressed in its own colors.

## The castle

A long stone hall with a timber roof, pillars and pointed arches down both sides, stained glass high in the walls and fire everywhere.

- **The throne.** At the far end, up on a dais, is a throne of iron blades. You arrive on it (if nobody else is sitting there). Walk off, or jump, to get up; **E** at it sits you back down.
- **The line.** A worker that's done, or waiting on you, gets up from its table and comes to stand in line before the throne, the one that has waited longest at the front. From the throne, **E** is for whoever's first in line (its terminal; **P** to prompt it, **O** for its PR, **X** to send it home, as at a desk). Once it's been seen to, it walks back to its seat and the rest shuffle up. There's room for eight: anyone past that waits at their table, jumping, as in the office.
- **The Hand of the King.** He stands at your left. Speak to him (**E** by him, **K** from the throne, or **E** from the throne when nobody's in line) and say what a new worker should do: it runs off to the first free seat at the tables and gets started. Hand him an issue card and he sends someone out for it. A worker the task queue sends comes in through the great doors.
- **The tables.** Two long tables down each side of the hall, benches along them. The workers work at open tomes, whose pages show their terminals. The seats toward the middle of the hall fill first; the ones along the walls come out when they're all taken, as the office's bean bags do.
- **Wear and tear.** Workers here dress as peasants, and the longer one works the more worn out it looks: a beard that grows out and goes from brown to grey to white, down to the floor, dirt and patched clothes, bags under its eyes, a hunch and a slower walk. It's fully spent after 30 minutes of work (`agents.ageMinutes`). Only time spent working counts, over the worker's whole stay, and the office keeps it through a restart.
- **The dungeon.** Send a worker home (**X**) and it doesn't walk out: the **Kingsguard**, on watch down in the dungeon, comes running up the stairs to its seat, says his piece, waits while it packs its things into a box, and marches it off with a hand on its shoulder, down the carpet, down the stairs by the east wall, to a cell. The door swings open, he throws it in, and the door slams. It stays there for good. Everyone ever sent home is kept, and wastes away: thinner and paler by the hour, until after a day it starves to death (☠️ on its name tag) and keels over on the straw. Then it rots, its bones showing through, down to a bare skeleton (💀) half a day later. You can walk down the stairs (behind the rail south of the east tables) and look in on them; the living ones mutter at you now and then. There are 67 seats in the 9 cells, filled round the cells one each: once they're all taken, the oldest are thrown on the heap of bones at the west end. It's the same for workers that go home on their own when their pull request merges, ones another worker sends home, and ones the task queue sends home to make room; a meeting's workers, let go when it's over, still just walk out. Each floor has its own dungeon (kept in the project's `.agent-office/jail.json`).
- **The boards** hang on the side walls, with a scribe at a lectern under each of the issues, queue and PR boards (the board agents). The **small council**'s round table, near the dais, is the meeting room: **E** at it calls a meeting, and its easel shows what the meeting writes. The gong is by the dais, and there's ale by the hearth (it works like the office's coffee).

## Maps of your own

A map is plain JSON. Put a file in the office's `.agent-office/maps/` folder: `~/agent-office/.agent-office/maps/` for an office started without a project, or `<dir>/.agent-office/maps/` for `agent-office <dir>`. It's read whenever someone opens ⚙️ Settings or joins, so there's nothing to restart: open Settings and it's in the list. A map that won't load is listed with why.

The easy way is to start from the castle and change only what you want. This one moves the issues board, and the Issues agent's lectern under it, three bays down the west wall, and makes the line shorter:

```json
{
  "id": "my-hall",
  "name": "My hall",
  "extends": "castle",
  "boards": { "issues": { "z": 3 } },
  "stations": { "issues": { "z": 3 } },
  "lineup": { "count": 5 }
}
```

`extends` fills in everything you leave out from the map you name. Objects are merged key by key (so `boards.issues.z` changes one number of one board), and lists replace the whole list (give `tables` or `props` and they're all yours). `null` takes away one of the optional parts (`"herald": null`: no Hand of the King). A map can extend another map of your own, a few deep. The office itself is built in code, so it can't be extended; extend `castle` instead.

To change the lists (move a pillar, resize the hall and everything in it), start from a copy of the whole castle instead: [`docs/maps/castle.json`](maps/castle.json) is it, as a map of your own called *My castle*. Copy it into the folder and it's in Settings; change what you like from there.

Or write one from nothing. This is about the least a map can be: a hall, a door, tables to seat 32, the board agents, a meeting table and the four boards. Everything else (the throne, the line, the herald, the props) is optional:

```json
{
  "id": "barn",
  "name": "The barn",
  "icon": "🐄",
  "style": "castle",
  "hall": { "width": 20, "length": 30, "height": 8 },
  "door": { "x": 0, "z": 13.6 },
  "tables": [
    { "name": "West table", "x": -5, "z": 0, "length": 12, "seats": 5 },
    { "name": "Middle table", "x": 0, "z": -2, "length": 10, "seats": 6 },
    { "name": "East table", "x": 5, "z": 0, "length": 12, "seats": 5 }
  ],
  "stations": {
    "issues": { "x": -8.6, "z": -11, "rotY": -1.5708 },
    "queue": { "x": -8.6, "z": 9, "rotY": -1.5708 },
    "pulls": { "x": 8.6, "z": -11, "rotY": 1.5708 }
  },
  "council": { "x": 0, "z": -11, "rotY": 0 },
  "boards": {
    "issues": { "x": -9.92, "y": 3, "z": -6, "rotY": 1.5708, "width": 4, "height": 2.4 },
    "queue": { "x": -9.92, "y": 3, "z": 5, "rotY": 1.5708, "width": 4, "height": 2.4 },
    "pulls": { "x": 9.92, "y": 3, "z": -6, "rotY": -1.5708, "width": 4, "height": 2.4 },
    "services": { "x": 9.92, "y": 3, "z": 5, "rotY": -1.5708, "width": 4, "height": 2.4 }
  },
  "props": [{ "kind": "brazier", "x": 0, "z": 6, "light": true }]
}
```

The folder's first 24 files are read, up to 256 KB each, and a map can have up to 40 tables, 12 seats a side and 400 props.

Units are meters. The hall runs from `x = -width/2` (west) to `width/2` (east) and from `z = -length/2` (north) to `length/2` (south); `y` is up. Angles (`rotY`) are in radians: `0` faces south (+z), `π/2` (1.5708) east, `π` north and `-π/2` west. Put the boards on the inside of a wall (`±(width/2 - 0.08)`), facing into the hall.

### When a map breaks

A map that won't load (bad JSON, something outside the hall, too few seats, a prop reaching over the walls…) is listed in Settings in red, with the reason, and can't be picked. If it's the one the building is on, the building goes back to the office, for everyone, with a note saying why, and comes back to your map by itself once the file loads again. The folder is read again when someone opens Settings or joins. To put the building back to the office by hand, pick 🏢 Office in Settings, or delete `.agent-office/map.json`.

### What a map has

| Field | What it is |
| --- | --- |
| `id` | Lowercase letters, digits and dashes, up to 40. The building's pick is saved by it. **Required.** |
| `name`, `icon`, `description` | What Settings shows. `name` is **required**. |
| `extends` | Another map's `id` to start from. |
| `style` | Which builder puts it up. `"castle"` is the only one so far. **Required.** |
| `hall` | `{ width, length, height }`: the room (8 to 110 m either way), and how high its walls are (4 to 40 m). **Required.** |
| `spawn` | `{ x, z, rotY }`: where you stand when you arrive and the throne's taken. Without it, at the door, facing the middle. |
| `door` | `{ x, z }`: just inside the way in and out. The doorway goes in the nearest wall; workers come in and go home through it. **Required.** |
| `throne` | `{ x, z, rotY, dais: { width, depth, height, steps }, label }`: your seat, on a dais that runs 2.4 m in front of it and the rest behind, with `steps` (up to 10) down its front. Without a `dais` it's 8 m by 4.5 m and 0.9 m high, with 3 steps. `label` is what its hint says (`👑 Throne`). Optional. |
| `herald` | `{ x, z, rotY, name, says, ask, button }`: who sends out new workers. `says` goes under their name, `ask` in the box you type in, and `button` on the button. Optional. |
| `lineup` | `{ x, z, rotY, step: [dx, dz], count }`: the first spot in line, and each next one `step` further on, all facing `rotY`. Optional. |
| `tables` | `[{ x, z, length, seats, width?, rotY?, sides?, name? }]`: where the workers sit. `seats` is per side (1 to 12); `width` is 1.4 m unless you say; `sides` is `"both"` (the default), `"inner"` or `"outer"`; `rotY` 0 runs the table along z. **Required.** |
| `stations` | `{ issues, queue, pulls }`, each `{ x, z, rotY }`: the board agents' lecterns. The agent stands 0.55 m from its lectern the way `rotY` points (toward the wall, usually) and faces back across it into the hall. **Required.** |
| `council` | `{ x, z, rotY }`: the meeting table. Five chairs go round it, the head of the table at `rotY`'s side, and its easel 2.5 m behind the other way. **Required.** |
| `boards` | `{ issues, queue, pulls, services }`, each `{ x, y, z, rotY, width, height, label? }`: the boards on the walls, `rotY` the way each faces. **Required.** |
| `props` | `[{ kind, x, z, … }]`: everything else, from the list below. |
| `agents` | `{ outfit: "peasant" \| "none", ageMinutes }`: how the workers dress, and how many minutes of work until they look spent (`0`, the default: never). |
| `palette` | `{ stone, floor, carpet, wood, trim }`: CSS colors. The banners and shields take each floor's own color. |
| `dungeon` | A dungeon under the hall: see [The dungeon](#the-dungeon). Optional (`null` takes the castle's away). |
| `sendHome` | What happens to a worker sent home: see [Sending workers home](#sending-workers-home). Without it (or `null`), it packs up and walks out of the door. |

### Seats

Every map has the same seats, by id, so that the server, the task queue, meetings and saved workers work on any of them: 16 regular seats (`desk-1` to `desk-16`), 4 for the office's back office (`desk-17` to `desk-20`, only sat at once that floor's back office is built out that far), 12 more that come out once those are taken (`beanbag-1` to `beanbag-12`), the three board agents' places and the five meeting chairs. The tables' seats are handed out in order: first the side of every table toward the middle of the hall (its inner side), table by table in the order they're listed, then their other sides the same way. Along a table they go from one end to the other, north to south for one that runs along z. So `desk-1` is the first seat on the first table's inner side, and a map's tables must seat at least 32 between them; any seats past that are just bench.

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

### The dungeon

`dungeon` digs a vault under the hall: `{ x, z, width, length, depth, stairs, cells, pillars, torches, ossuary }`. It has to be under the hall (0.2 m in from its walls), its floor `depth` meters below the hall's (2.6 to 20). Its ceiling is the underside of the hall's floor.

| Field | What it is |
| --- | --- |
| `x`, `z`, `width`, `length`, `depth` | The vault: its middle, its size (`width` along x, `length` along z), and how far down it goes. **Required.** |
| `stairs` | `{ x, z, rotY, width }`: the middle of the top step's edge, and the way down (`rotY`, a quarter turn: `0` goes down toward +z). A hole opens in the hall's floor over them, with a stone rail round three sides. They go down 0.34 m a step, a step no more than 0.24 m high, until they reach the vault's floor, so the deeper the vault, the longer they are: they have to fit in it, and come up clear of the tables and props. A low wall runs down whichever side isn't against the vault's wall. `width` is 2.2 m unless you say. **Required.** |
| `cells` | `[{ x, z, rotY, width, depth }]`: each cell's front (the middle of its bars), the way its bars face (`rotY`, a quarter turn, out into the vault), how wide it is across the bars (2 to 12 m) and how deep behind them (1.8 to 10 m). A barred door in the middle of the bars; walls between cells, and at the back unless that's the vault's wall. Prisoners sit along its back wall, then down its sides, about 1.15 m apart. Up to 40. **Required.** |
| `pillars` | `[{ x, z }]`: stone pillars holding the vault up. |
| `torches` | `[{ x, z, rotY }]`: torches on its walls or pillars, burning toward `rotY`. While you're down there, the hall's lit fires light the torches nearest you instead. |
| `ossuary` | `{ x, z }`: where the heap of bones goes once every seat in every cell has been taken. |

### Sending workers home

`sendHome` is a script: the `steps` a worker sent home goes through, one after another, and an `escort` who comes for it. The castle's is:

```json
{
  "id": "castle-script",
  "name": "The castle's script",
  "extends": "castle",
  "sendHome": {
    "escort": { "name": "Kingsguard", "post": { "x": 6.3, "z": 21.8, "rotY": -1.5708, "below": true }, "color": "#8e1b1b" },
    "steps": [
      { "do": "fetch" },
      { "do": "say", "who": "escort", "text": ["By order of the crown, you’re coming with me.", "Up. The dungeon’s waiting."] },
      { "do": "pack" },
      { "do": "say", "text": ["🙏 Mercy, my liege!", "😰 But my pull request…"] },
      { "do": "walk", "to": "cell" },
      { "do": "jail" },
      { "do": "say", "who": "escort", "text": "🔒 Rot in there." },
      { "do": "return" }
    ],
    "starveHours": 24,
    "rotHours": 12
  }
}
```

| Step | What it does |
| --- | --- |
| `{ "do": "pack" }` | It packs its things into a box at its seat, and its laptop (or tome) shuts. |
| `{ "do": "fetch", "run": false }` | The escort comes from its post to the worker, at a run (or a walk, with `"run": false`), and stands by it. |
| `{ "do": "say", "who": "escort", "text": […] }` | The worker (or with `"who": "escort"`, the escort) says something over its head: `text` is one line, or a list to pick one from at random. |
| `{ "do": "walk", "to": …, "run": true }` | The worker gets up and walks somewhere, the escort marching it along with a hand on its shoulder if it has fetched it. `to` is `"door"` (out through the doors), `"stairs"` (the top of the dungeon stairs), `"dungeon"` (the foot of them), `"cell"` (its own cell's door), `"post"` (the escort's post), or `{ "x", "z", "below" }` (a spot in the hall, or with `"below": true`, in the dungeon). Up and down the stairs as it needs to. |
| `{ "do": "jail" }` | It's thrown into its cell and locked in, for good. Needs a `dungeon`. |
| `{ "do": "leave" }` | It shrinks away, gone, wherever it is. |
| `{ "do": "wait", "seconds": 2 }` | A pause (up to 30 s). |
| `{ "do": "return" }` | The escort walks back to its post. |

Once it's jailed or gone, only the escort's steps can follow. A script that ends with the worker still standing about sees it shrink away, and an escort not sent back walks back by itself. Up to 30 steps. With a `jail` step, everyone sent home on this map is kept by the office (see [the dungeon](#the-castle)) and wastes away: thinner till it starves to death after `starveHours` (24 unless you say), then rotting to the bone over `rotHours` more (12). Try `"starveHours": 0.05` to watch it happen in three minutes.

`escort` is `{ name, post: { x, z, rotY, below }, color }`: who comes for workers, where they keep watch (down in the dungeon, with `"below": true`) and the color of their surcoat. A map that extends the castle and moves the escort up into the hall has to say `"below": false`, since objects are merged. If more than one worker is sent home at once, up to three more like them come out to help, and go back in afterwards.

A map without a dungeon can still have a script: a guard who walks each worker to the door, say.

```json
{
  "id": "walked-out",
  "name": "Walked out",
  "extends": "castle",
  "dungeon": null,
  "sendHome": {
    "escort": { "name": "Steward", "post": { "x": -3, "z": 26, "rotY": 0, "below": false }, "color": "#1f4d3a" },
    "steps": [{ "do": "fetch", "run": false }, { "do": "pack" }, { "do": "say", "who": "escort", "text": "This way, please." }, { "do": "walk", "to": "door" }, { "do": "leave" }, { "do": "return" }]
  }
}
```

### What it can't do (yet)

- Arches only join pillars in a row along z, and the roof's trusses run across x: a hall is long along z.
- To resize the castle, change its props too: `extends` can't move a list's items one by one, so start from [`castle.json`](maps/castle.json).
- The workers' looks are the office's or the peasant's, and they work at the castle's tomes.

## Adding to the code

- **The model** is in [`src/shared/maps/`](../src/shared/maps): `types.ts` is the schema, `index.ts` checks a config and works out its plan (every seat, the line, the tables and the meeting table with what was left out filled in, the boards and what's in the way for walking round), `props.ts` has the props, the floor each takes and how high it reaches, and `castle.ts` is the castle ([`docs/maps/castle.json`](maps/castle.json) is written from it: `UPDATE_CASTLE_JSON=1 node --import tsx --test tests/maps.test.ts`). The server keeps the building's pick in `.agent-office/map.json` ([`src/server/maps.ts`](../src/server/maps.ts)) and checks where people sit against the map.
- **A new prop kind** is its name in `PROP_KINDS`, the floor it takes (`propFootprint`) and how high it reaches (`propTop`) in `props.ts`, and how it looks in the style's builder's `PROPS` table ([`src/client/world/castle/props.ts`](../src/client/world/castle/props.ts)), which won't compile without it.
- **A new style** is its name in `MAP_STYLES` and a builder in [`src/client/world/styles.ts`](../src/client/world/styles.ts) that turns a plan into a `World` ([`src/client/world/world.ts`](../src/client/world/world.ts)): a scene group, colliders, what can be used, a view for every seat, the four boards, a walk grid, the ways in and out, its room (wall thickness, roofed or not), and optionally a gong, the meeting's board, a herald, how it sounds, how it's lit (`mood`) and `dispose`. [`src/client/core/worlds.ts`](../src/client/core/worlds.ts), which puts it up, needs nothing else. The plan puts the seats, lecterns, meeting chairs and throne where the castle's furniture has them (a bench 0.85 m out from each place at a table, and so on), and that's what the workers walk round, so a new style builds its furniture there.
- **Workers walking about** (lining up, coming back, running to their seats) is [`src/client/world/court.ts`](../src/client/world/court.ts), for any map other than the office.
- **The dungeon and sending workers home**: [`src/shared/maps/dungeon.ts`](../src/shared/maps/dungeon.ts) checks a map's `dungeon` and `sendHome`, works out the vault, the stairs and the cells' seats, how far a prisoner has wasted away (`wasting`) and the way between the hall and the dungeon (`levelRoute`). The client builds it in [`src/client/world/dungeon.ts`](../src/client/world/dungeon.ts), acts a script out in [`src/client/features/workers/sendhome.ts`](../src/client/features/workers/sendhome.ts) and shows the prisoners in [`src/client/features/workers/jail.ts`](../src/client/features/workers/jail.ts); the server keeps each floor's prisoners in `.agent-office/jail.json` ([`src/server/jail.ts`](../src/server/jail.ts)) and hands them out with the `worker.remove` that took them away. **A new kind of step** is its name in `SEND_HOME_STEPS`, its checking in `planSendHome`, and its `begin` and `tick` in `features/workers/sendhome.ts`.
