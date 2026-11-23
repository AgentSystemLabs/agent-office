# Neon HQ Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pickable **⚡ Neon HQ** theme — magenta/cyan strips, purple fog and dusk light, hologram signs, dark grid floor — beside Halloween and Christmas, leaving the default cartoon office untouched.

**Architecture:** The existing theme picker (`Themes` server + `ThemeState` broadcast + `dressUp()` client) already frames this. `Theme` stays `'halloween' | 'christmas'` (so `holiday.ts`, `sky.ts` and every `Record<Theme, …>` never grow); a new `ActiveTheme = Theme | 'neon'` widens the picker, and `decorTheme()` maps `'neon'` to `null` so no costume or holiday decoration ever sees it. A new `world/neon.ts` module builds the geometry and paints a per-frame tint over what the sky wrote.

**Tech Stack:** TypeScript, three.js 0.186 (toon + OutlineEffect), Vite 8, node:test.

**Spec:** `docs/superpowers/specs/2026-11-23-neon-theme-design.md`

## Global Constraints

- Node >= 20. Verify with `npm run typecheck`, `npm test`, `npm run build` (all from the worktree).
- `AGENTS.md`: new features are their own module; no theme code in `main.ts` / `server.ts`; one-line type edits in `src/shared/protocol/settings.ts` only.
- `tests/size.test.ts`: no `src/` file over 600 lines except the listed ceilings. `sky.ts` (966) and `holiday.ts` (702) are **at** their ceilings — this plan never adds a line to either.
- Work in the worktree `/Users/kylerobinson559/Downloads/agent-office-neon` on branch `neon-hq-theme`. Never touch the main checkout's uncommitted files.
- No new shadow-casting lights; at most two unshadowed point lights.
- Every commit message ends with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## Review Focus

1. **Theme switched back off** — the default cartoon office must return completely (colors, fog, background, floor). Covered by Task 2's `neonLight(0, …)` test and Task 4's off screenshot.
2. **Characters while neon is on** — dog, hands, players and workers must wear nothing (no drift into an unknown theme). Covered by Task 1's `decorTheme('neon') === null` test.
3. **Up on the roof / in another map (castle, station)** — no neon geometry must follow you. Covered by Task 3's wiring mirrors + its grep verification; checked visually in Task 4.
4. **Neon by day vs night** — the office must stay readable and the signs legible at both. Covered by Task 4's screenshots (the office allows a day/night override in the settings; if not, take one at whatever the clock gives and note it).
5. **Persistence and the picker** — `'neon'` must be accepted by the server's restore path and listed once in ⚙️ Settings. Covered by Task 1's `isThemePick('neon')` / `THEME_PICKS` test.

---

### Task 1: Theme plumbing (`ActiveTheme`, `decorTheme`, label, call sites)

**Files:**
- Modify: `src/shared/protocol/settings.ts:135-141`
- Modify: `src/shared/theme.ts`
- Modify: `src/client/ui/settings.ts:21`
- Modify: `src/client/features/workers/views.ts:126`, `src/client/features/peers/index.ts:59`
- Modify: `src/server/ws/handlers/settings.ts:70-82` (the `theme.set` toast)
- Test: `tests/theme.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type ActiveTheme = Theme | 'neon'` and `ThemePick = ActiveTheme | 'auto' | 'off'`, `ThemeState.active: ActiveTheme | null` (`src/shared/protocol/settings.ts`).
  - `decorTheme(active: ActiveTheme | null): Theme | null` — `null` for `'neon'`, else the theme (`src/shared/theme.ts`).
  - `activeTheme(...)` now returns `ActiveTheme | null`.

- [ ] **Step 1: Link dependencies in the worktree**

Run: `ln -s ../agent-office/node_modules node_modules && npm run typecheck`
Expected: typecheck passes on the untouched tree (this only proves the symlink resolves).

- [ ] **Step 2: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_PICKS, activeTheme, decorTheme, isThemePick } from '../src/shared/theme.js';

test('neon is a pick, never a calendar theme', () => {
  assert.deepEqual(THEME_PICKS, ['auto', 'halloween', 'christmas', 'neon', 'off']);
  assert.ok(isThemePick('neon'));
  assert.equal(activeTheme('neon', Date.UTC(2026, 9, 5), 0), 'neon');
  assert.equal(activeTheme('auto', Date.UTC(2026, 9, 5), 0), 'halloween');
  assert.equal(activeTheme('auto', Date.UTC(2026, 10, 5), 0), null);
});

test('neon dresses no holiday costume', () => {
  assert.equal(decorTheme('neon'), null);
  assert.equal(decorTheme('halloween'), 'halloween');
  assert.equal(decorTheme('christmas'), 'christmas');
  assert.equal(decorTheme(null), null);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --import tsx --import=#tests/css --test tests/theme.test.ts`
Expected: FAIL — `decorTheme` is not exported / `THEME_PICKS` lacks `'neon'`.

- [ ] **Step 4: Widen the types**

In `src/shared/protocol/settings.ts`, above `ThemePick`:

```ts
/** What the office can be dressed as: a holiday, or the Neon HQ look. */
export type ActiveTheme = Theme | 'neon';
export type ThemePick = ActiveTheme | 'auto' | 'off';
```

and change `ThemeState.active` to `ActiveTheme | null`. Everything else in that file stays byte-identical.

In `src/shared/theme.ts`: `THEME_PICKS` becomes `['auto', 'halloween', 'christmas', 'neon', 'off']`; `activeTheme` returns `ActiveTheme | null` (import it); add:

```ts
/** The holiday someone's dressed for, if any: the Neon HQ look wears no holiday costume. */
export function decorTheme(active: ActiveTheme | null): Theme | null {
  return active === 'neon' ? null : active;
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `node --import tsx --import=#tests/css --test tests/theme.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Fix the two call sites the compiler now rejects, and the label**

Run `npm run typecheck`; it must fail on `views.ts:126` and `peers/index.ts:59`, each passing `store.theme.active` into `setCostume(theme: Theme | null)`. Wrap both as `decorTheme(store.theme.active)` and import `decorTheme` from `../../shared/theme` (adjust relative depth per file). Then in `src/client/ui/settings.ts:21` add `neon: '⚡ Neon HQ'` to `THEME_LABEL` (it is `Record<ThemePick, string>`, so the compiler demands it). In the same file's `paintTheme` note (line ~152, the `active === 'halloween' : active === 'christmas'` chain), add a branch before the fallback:

```ts
active === 'neon'
  ? 'Neon HQ: magenta and cyan light strips, a purple haze and holographic signs — the building glows, but nobody’s in costume.'
  : 'No decorations up right now.'
```

Finally, in `src/server/ws/handlers/settings.ts`'s `theme.set` toast chain, add `msg.pick === 'neon' ? \`⚡ ${who} switched the office to Neon HQ\`` before the calendar fallback (otherwise picking neon announces "decorations to follow the calendar"). Run `npm run typecheck` — clean.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all green, including `tests/size.test.ts` and `tests/docs.test.ts`.

- [ ] **Step 8: Commit (with the design doc and this plan)**

```bash
git add src/shared/protocol/settings.ts src/shared/theme.ts src/client/ui/settings.ts src/client/features/workers/views.ts src/client/features/peers/index.ts src/server/ws/handlers/settings.ts tests/theme.test.ts docs/superpowers
git commit -m "feat(theme): accept a Neon HQ pick that dresses no holiday"
```

---

### Task 2: `world/neon.ts` — strips, signs, grid, lights, tint

**Files:**
- Create: `src/client/world/neon.ts`
- Test: `tests/neon-model.test.ts` (create)

**Interfaces:**
- Consumes: `ActiveTheme` (Task 1), `mesh`/`textPlane` from `./toon`, `FLOOR` and `WALL_HEIGHT` from `../../shared/layout`.
- Produces:
  - `export interface NeonParts { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; ambient: THREE.AmbientLight; scene: THREE.Scene }`
  - `export function neonLight(fade: number, parts: NeonParts): void` — `fade` 0 leaves every value exactly as the sky left it; 1 is full neon dusk.
  - `export class Neon { readonly group: THREE.Group; constructor(withSigns?: boolean); set(theme: ActiveTheme | null): void; update(t: number, parts: NeonParts): void }` — `group.visible` starts false and is owned by the place wiring (Task 3), exactly like `holiday.group`; `set()` never touches it, so a theme change on the roof cannot summon the strips.

**Decision (from the spec's "Sky" section):** the spec's eased `neon` factor in `Sky.setTheme` becomes a post-sky tint inside `neon.ts` instead, because `sky.ts` sits at its 966-line ceiling. Visual intent is unchanged; the fade lives here.

- [ ] **Step 1: Write the failing model test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Neon, neonLight } from '../src/client/world/neon.js';

/** Lights and a fog set the way world/sky.ts sets them each frame. */
function parts() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#bfe3ff', 20, 160);
  scene.background = new THREE.Color('#bfe3ff');
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
  const hemi = new THREE.HemisphereLight('#fff5e6', '#c9a27a', 1.5);
  const ambient = new THREE.AmbientLight('#ffffff', 0.5);
  return { scene, sun, hemi, ambient };
}

test('fade 0 leaves the sky’s work exactly as it was', () => {
  const p = parts();
  neonLight(0, p);
  assert.equal(p.hemi.color.getHexString(), new THREE.Color('#fff5e6').getHexString());
  assert.equal(p.sun.intensity, 2.2);
  assert.equal((p.scene.fog as THREE.Fog).color.getHexString(), new THREE.Color('#bfe3ff').getHexString());
});

test('fade 1 makes a neon dusk: violet light, dimmed sun, magenta haze', () => {
  const p = parts();
  neonLight(1, p);
  assert.notEqual(p.hemi.color.getHexString(), new THREE.Color('#fff5e6').getHexString());
  assert.ok(p.sun.intensity < 1.5, `sun dimmed, got ${p.sun.intensity}`);
  assert.notEqual((p.scene.fog as THREE.Fog).color.getHexString(), new THREE.Color('#bfe3ff').getHexString());
});

test('the group is built once, and set() never forces it visible', () => {
  const neon = new Neon(false); // no canvas in node: no signs
  assert.equal(neon.group.visible, false);
  assert.ok(neon.group.children.length > 0);
  neon.set('neon');
  assert.equal(neon.group.visible, false, 'visibility belongs to the place wiring (roof/castle stay clean)');
  neon.set('halloween');
  neon.set(null);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --import=#tests/css --test tests/neon-model.test.ts`
Expected: FAIL — cannot find module `../src/client/world/neon.js`.

- [ ] **Step 3: Implement `src/client/world/neon.ts`**

Module header comment: one line saying it's the Neon HQ look from ⚙️ Settings, built once and painted over the sky's light each frame (like a map's own `mood`).

Module constants (exact values; the reel's magenta/cyan):

```ts
const MAGENTA = '#ff2a6d';
const CYAN = '#05d9e8';
const NEON_HEMI = new THREE.Color('#3a1d6e');   // violet sky light
const NEON_AMBIENT = new THREE.Color('#241238');
const NEON_SUN = new THREE.Color('#c56bff');
const NEON_FOG = new THREE.Color('#2a0f3d');    // purple fog and background
```

`neonLight(fade, { sun, hemi, ambient, scene })`:

```ts
hemi.color.lerp(NEON_HEMI, fade * 0.6);
ambient.color.lerp(NEON_AMBIENT, fade * 0.5);
sun.color.lerp(NEON_SUN, fade * 0.6);
sun.intensity *= 1 - 0.5 * fade;
hemi.intensity *= 1 - 0.3 * fade;
ambient.intensity *= 1 - 0.2 * fade;
if (scene.fog instanceof THREE.Fog) scene.fog.color.lerp(NEON_FOG, fade * 0.75);
if (scene.background instanceof THREE.Color) scene.background.lerp(NEON_FOG, fade * 0.7);
```

Comment: `// Sky.update() rewrites these each frame (world/sky.ts), so tinting after it is idempotent and fades out cleanly.`

`class Neon`, constructor `(withSigns = true)`:
- `this.group = new THREE.Group(); this.group.visible = false;`
- **Strips** — a local `strip(w, h, d, color, x, y, z)` making `new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))`; push each `material` into `this.pulse: THREE.MeshBasicMaterial[]`. Four magenta ceiling strips at `y = WALL_HEIGHT - 0.5`: `box(35, 0.08, 0.08)` at `z = ±12.7`, `box(0.08, 0.08, 25)` at `x = ±17.7`. Four cyan floor strips at `y = 0.04` with the same footprint.
- **Floor grid** — `const grid = new THREE.GridHelper(36, 72, MAGENTA, '#3d1660'); grid.position.y = 0.015; grid.scale.z = 26 / 36;` set its material to `transparent: true, opacity: 0.3, depthWrite: false` (cast to `THREE.Material`; GridHelper's type is `Material | Material[]`).
- **Signs** (`if (withSigns)`) — for `[['COMPLIANCE', -9], ['AGENTS', 0], ['IT', 9]]` at `z = FLOOR.minZ + 0.1`, `y = 4.2`, facing +z: a backing `Mesh(PlaneGeometry(4, 1.6), MeshBasicMaterial({ color: MAGENTA, transparent: true, opacity: 0.15, depthWrite: false }))` at `z - 0.02`, plus `textPlane(name, { color: CYAN, size: 160 })` at `z + 0.01`.
- **Lights** — `new THREE.PointLight(MAGENTA, 12, 30, 2)` at `(-9, 5, 0)` and `new THREE.PointLight(CYAN, 8, 30, 2)` at `(9, 5, 0)`; neither casts shadows.
- `set(theme)`: `this.active = theme === 'neon';` only — never `group.visible` (comment: the place wiring owns that, like the holiday's; see Task 3).
- `update(t, parts)`: `this.fade += ((this.active ? 1 : 0) - this.fade) * 0.02;` then `neonLight(this.fade, parts);` then for each `m` in `this.pulse`: `m.opacity = 0.55 + 0.35 * Math.sin(t * 2 + i)` (index-staggered so strips breathe unevenly), and pulse the sign backings with the same phase offset.

File stays well under 200 lines; `tests/size.test.ts` stays green.

- [ ] **Step 4: Run the test to see it pass**

Run: `node --import tsx --import=#tests/css --test tests/neon-model.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck, size test, commit**

```bash
npm run typecheck && node --import tsx --import=#tests/css --test tests/size.test.ts
git add src/client/world/neon.ts tests/neon-model.test.ts
git commit -m "feat(world): add the Neon HQ strips, signs, grid and dusk tint"
```

---

### Task 3: Wire it in — scene, loop, place visibility, dress-up

**Files:**
- Modify: `src/client/core/scene.ts:35`, `src/client/core/scene.ts:85-90`
- Modify: `src/client/core/loop.ts:168-181`
- Modify: `src/client/core/travel.ts:277`
- Modify: `src/client/core/maps.ts:77`
- Modify: `src/client/features/workers/views.ts:375-390`

**Interfaces:**
- Consumes: `Neon`, `NeonParts` (Task 2); `decorTheme`, `ActiveTheme` (Task 1).
- Produces: `Stage.neon: Neon` (`src/client/core/scene.ts`), for `loop.ts` and `travel.ts`/`maps.ts` via `parts.stage.neon`.

- [ ] **Step 1: Build it in the scene**

In `src/client/core/scene.ts`: import `Neon` from `../world/neon`; add `readonly neon: Neon;` to `interface Stage`; after the `holiday` lines:

```ts
// The Neon HQ look (see world/neon.ts), up while the building's set to it (see dressUp).
const neon = new Neon();
scene.add(neon.group);
```

add `noOutline(neon.group);` beside the holiday line, and include `neon` in the returned `Stage`. Run `npm run typecheck`.

- [ ] **Step 2: Paint it each frame after the sky**

In `src/client/core/loop.ts` `updateSky`, destructure `neon` from `parts.stage` and, on the existing in-office line, add the call beside the holiday's:

```ts
if (!core.upTop && ctx.inOffice()) holiday.update(t, sky.lampsOn, camera);
if (!core.upTop && ctx.inOffice()) neon.update(t, { sun, hemi, ambient, scene });
```

Order matters: `sky.update` and `mood` have already run, so the tint is applied last. Run `npm run typecheck`.

- [ ] **Step 3: Hide it everywhere the holiday decorations hide**

- `src/client/core/travel.ts` (line ~277): below `holiday.group.visible = !up && inOffice();` add `neon.group.visible = !up && inOffice();` (take `neon` from the module-level `parts.stage` the same way `holiday` is taken there).
- `src/client/core/maps.ts` (line ~77): below `holiday.group.visible = inOffice() && !core.upTop;` add `neon.group.visible = inOffice() && !core.upTop;` (same `parts.stage` route).

- [ ] **Step 4: Dress up and undress**

Replace `dressUp()`'s body in `src/client/features/workers/views.ts:375-390` with:

```ts
const theme = store.theme.active;
const decor = decorTheme(theme);
holiday.set(decor);
sky.setTheme(decor);
neon.set(theme);
parts.dog.setCostume(decor);
hands.setCostume(decor);
me.setCostume(decor);
for (const r of parts.peers.remotes.values()) r.person.setCostume(decor);
for (const v of workerViews.values()) v.model.setCostume(decor);
for (const a of parts.worlds.idleAgents()) a.model.setCostume(decor);
ctx.world().herald?.person.setCostume(decor);
```

Change the top of `installWorkerViews` (`const { holiday } = parts.stage;`, line 65) to `const { holiday, neon } = parts.stage;`, and add `decorTheme` to the imports. `sky` there comes from `ctx`, unchanged.

- [ ] **Step 5: Verify the wiring mirrors the holiday's exactly**

Run: `grep -n "holiday.group.visible\|neon.group.visible" src/client/core/travel.ts src/client/core/maps.ts`
Expected: each file has the two lines, with identical right-hand sides.
Run: `grep -n "neon.set\|neon.update\|new Neon" src/client -r`
Expected: exactly one `new Neon`, one `neon.set(theme)`, one `neon.update(...)`.

- [ ] **Step 6: Typecheck, whole suite, commit**

```bash
npm run typecheck && npm test
git add src/client/core/scene.ts src/client/core/loop.ts src/client/core/travel.ts src/client/core/maps.ts src/client/features/workers/views.ts
git commit -m "feat(theme): wire Neon HQ into the scene, sky and place rules"
```

---

### Task 4: Docs, build, screenshots, PR

**Files:**
- Modify: `docs/features.md:17`, `docs/how-it-works.md:27`

**Interfaces:**
- Consumes: everything above.
- Produces: the shipped branch and its PR.

- [ ] **Step 1: Document the pick**

`docs/features.md`, retitle the bullet to `- **Halloween, Christmas and Neon HQ.**` and append, before the *By the calendar* sentence:

> Pick **⚡ Neon HQ** (⚡ → *Theme*) for a cyberpunk headquarters instead: magenta and cyan light strips along the ceiling and the floor's edge, a purple haze and a permanent dusk, holographic **COMPLIANCE**, **AGENTS** and **IT** signs on the back wall, and a dark, faintly glowing grid across the floor. It dresses the building, not the people: no costumes.

`docs/how-it-works.md:27`, append to the same bullet:

> *Neon HQ* is the one theme that isn't a holiday: `src/client/world/neon.ts` builds its strips, signs and floor grid and tints the light after the sky has drawn each frame (`core/loop.ts`), so it fades back out cleanly; `decorTheme()` in `src/shared/theme.ts` keeps `'neon'` away from every costume and decoration.

- [ ] **Step 2: Full checks**

```bash
npm run typecheck && npm test && npm run build
```

Expected: all green; `tests/docs.test.ts` and `tests/size.test.ts` included.

- [ ] **Step 3: See it**

```bash
npm run build
mkdir -p /tmp/neon-check/.agent-office && printf '{"pick":"neon","by":"check","at":0}' > /tmp/neon-check/.agent-office/theme.json
node bin/agent-office.js /tmp/neon-check --port 4601 --password dev --no-open
```

Open `http://localhost:4601/`, password `dev`. Screenshot the hall; check strips, fog, dusk, signs and grid. Then write `{"pick":"off","by":"check","at":0}` to `/tmp/neon-check/.agent-office/theme.json`, restart, and screenshot again: the office must look exactly like stock (compare against the owner's running copy on 4600, which is untouched). Check the roof shows no strips. If another map is reachable from that workspace, enter it once too. Kill the server when done.

- [ ] **Step 4: Commit docs and open the PR**

```bash
git add docs/features.md docs/how-it-works.md
git commit -m "docs: describe the Neon HQ theme"
git push -u origin neon-hq-theme
gh pr create --fill --title "Neon HQ theme" --body "$(cat <<'EOF'
Adds a pickable ⚡ Neon HQ theme beside Halloween and Christmas: magenta/cyan light strips along the ceiling and floor edges, purple dusk light and haze, holographic COMPLIANCE / AGENTS / IT signs, and a dark grid floor, in a new `src/client/world/neon.ts` module that tints the light after the sky each frame.

`Theme` stays `'halloween' | 'christmas'`; a new `ActiveTheme = Theme | 'neon'` widens the picker, and `decorTheme()` maps `'neon'` to `null` so no costume or holiday decoration ever sees it. Switching the theme off restores the stock office exactly.

Design: `docs/superpowers/specs/2026-11-23-neon-theme-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
