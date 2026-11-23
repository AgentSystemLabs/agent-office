# Neon HQ theme — design

- **Date:** 2026-11-23
- **Status:** approved (owner)
- **Branch:** `neon-hq-theme` (worktree off `origin/main`)

## Intent and why

The owner wants the Agent Office to read like the neon cyberpunk HQ in a reference
Instagram reel: dark reflective floor, magenta laser strips, purple fog, hologram
signage. The office already has a server-backed theme picker (🕯 Halloween / 🎄
Christmas), so the look ships as a **fourth selectable theme** for everyone. The
bright cartoon office stays the default and is unchanged when the theme is off.

## Goals

1. A `Neon HQ` pick in ⚙️ Settings → Theme, alongside Auto / Halloween / Christmas / Off.
2. Main hall dressed: magenta laser strips along the ceiling and along the floor
   edges, slowly pulsing.
3. Atmosphere: purple-magenta fog, daylight dimmed to a permanent dusk, cool indoor tint.
4. Three holographic room signs (COMPLIANCE, AGENTS, IT) using the existing
   `textPlane` helper.
5. A dark, faintly gridded floor overlay so the floor reads wet/reflective without
   a renderer overhaul.

## Non-goals

- True reflections (SSR / planar mirrors / renderer changes).
- Rebuilding walls as dark glass; no glass material changes.
- Neon costumes for characters, the dog or the hands.
- Reskinning the Agentic OS dashboard or the 2D `/lite` view.
- A calendar slot in `auto` (auto stays Halloween in October, Christmas in December).

## Anti-goals (failure even if it works)

- The theme leaking into the default look, or mutating shared materials in a way
  that cannot be undone when the theme is switched off.
- A noticeable framerate cost: no new shadow-casting lights. Emissive materials
  plus at most two unshadowed point lights.
- `tests/size.test.ts` going red, or theme code landing in `main.ts` / `server.ts`.

## Constraints

- `AGENTS.md`: new features are their own modules; branch work in a worktree.
- One-line type union edits in `shared/protocol/settings.ts` are unavoidable and
  allowed; no feature code goes into the protocol.
- Owner's other sessions have uncommitted work in the main checkout — this branch
  never touches it.

## Approaches considered

- **A. New `world/neon.ts` module, registered like the holiday dress-up (chosen).**
  Isolated, testable, matches the repo's module rules and the existing
  `Holiday`/`Sky.setTheme` pattern.
- **B. Extend `world/holiday.ts` with a third group.** Fewer wiring edits, but
  pushes that file past 1,200 lines and stretches a "holidays" concept to cover a
  non-holiday theme.
- **C. Lighting-only override.** Cheapest, but delivers none of the signs, strips
  or floor read the owner picked.

## Design

### Protocol and theme plumbing

- `src/shared/protocol/settings.ts`: `Theme` gains `'neon'`.
- `src/shared/theme.ts`: `THEME_PICKS` gains `'neon'`; `calendarTheme` unchanged.
- `src/client/ui/settings.ts`: `THEME_LABEL` gains `neon: '⚡ Neon HQ'`.
- Server (`src/server/theme.ts`) is already generic — no change.

### New module `src/client/world/neon.ts`

`class Neon` owning one `THREE.Group`, built once in the constructor:

- **Strips:** thin emissive planes (or boxes) along the main hall's ceiling edges
  and the floor perimeter, colours taken from the reel (`#ff2a6d` magenta and
  `#05d9e8` cyan). Pulsing via material opacity/emissive intensity in `update(t)`.
- **Signs:** three `textPlane` holograms (COMPLIANCE / AGENTS / IT) with an
  emissive backing plane, placed on interior walls facing the hall.
- **Floor overlay:** a plane just above the floor, dark translucent with faint
  grid lines, `depthWrite: false`, no shadows.
- **Lights:** two unshadowed `PointLight`s (magenta, cyan) at low intensity.

API mirrors `Holiday`:

- `set(theme: Theme | null)` — shows the group only when `theme === 'neon'`.
- `update(t: number)` — pulses strips/signs.
- `group` is public so visibility can follow the existing in-office rules.

### Wiring

- `src/client/core/scene.ts`: construct `Neon`, add to the scene, expose `Stage.neon`.
- `src/client/core/loop.ts`: call `neon.update(t)` where `holiday.update(...)` runs.
- `src/client/features/workers/views.ts` `dressUp()`: `neon.set(theme)` beside
  `holiday.set(theme)`. Costume calls receive the theme too, so pass
  `theme === 'neon' ? null : theme` to `setCostume` to avoid unknown-theme drift.
- `src/client/core/travel.ts` and `core/maps.ts`: hide `neon.group` under the same
  conditions they hide `holiday.group` (not in office / up top / other maps).

### Sky

`Sky.setTheme` gains an eased `neon` factor (pattern of `spooky`/`festive`, ~12 s):
purple-magenta fog and background, daylight dimmed roughly as Halloween's, sun and
hemisphere tinted toward violet. It eases back out cleanly when the theme changes.

## What is left to the builder

- Exact sign wording/positions, colour values, pulse timings, light intensities.
- Whether the grid overlay needs a small generated texture or plain line geometry.
- Whether the lab pages (`theme=` parameter) need a `neon` entry for screenshots.

## Verification

- `npm run typecheck`, `npm test`, `npm run build` in the worktree.
- A model test (Node + `three`, following `tests/holiday`-style tests) asserting
  `set('neon')` shows only the neon group and `set(null)` hides it.
- A headless-browser screenshot with the theme on and off, to confirm the default
  look is untouched.
- Ship as a PR from `neon-hq-theme` (never commit the owner's other sessions' work).
