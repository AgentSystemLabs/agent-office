# Office Strike art

Back to [FPS controls and rules](fps.md).

These four original images were generated with the built-in Codex image-generation tool on 2026-10-03, then encoded as JPEG at quality 85 without resizing. No external asset packs or third-party game images are included. The PNG originals remain in the generating machine's Codex generated-images folder; the shipped project assets are listed below.

| Asset | Purpose | Size |
| --- | --- | --- |
| `src/client/features/fps/assets/concrete.jpg` | Walls and floor | 1254 × 1254 |
| `src/client/features/fps/assets/metal.jpg` | Containers, beams and rifle metal | 1254 × 1254 |
| `src/client/features/fps/assets/wood.jpg` | Cover crates | 1254 × 1254 |
| `src/client/features/fps/assets/dock.jpg` | Lobby environment illustration | 1536 × 1024 |

`art.ts` exports bundler-resolved asset URLs and makes sRGB repeating albedo textures. Box UVs project at two meters per tile; rifle UVs use a smaller scale. Rendering supplies lighting and material color; the generated textures do not supply collision, damage, spawn positions or enemy silhouettes. Three surface images total about 1.2 MB and load only when the arena is first constructed. The lobby illustration is about 0.3 MB.

Keep replacements in this feature's asset folder and preserve the no-text/no-logo material treatment. Use flat, evenly illuminated tiles for surfaces; baked shadows look incorrect when the player moves. Check actual arena screenshots after replacing an image.

## Generation prompts

### concrete

```text
Use case: stylized-concept. Asset type: production seamless albedo texture for a Three.js tactical FPS training dock. Generate one square 1024x1024 tile of weathered cool gray poured concrete, flat orthographic close-up filling every pixel. Subtle pale aggregate, fine pores, shallow hairline cracks, faint grime, restrained hand-painted realistic game-art finish, medium-low contrast so enemies remain legible. Neutral diffuse illumination with NO directional lighting or baked shadows. Completely flat surface; seamless matching opposite edges; consistent scale, no big landmarks, no border, no text, no logo, no perspective, no objects. This is a color texture only, not a rendered cube or material sphere.
```

### metal

```text
Use case: stylized-concept. Asset type: seamless square 1024x1024 albedo texture for shipping containers, structural metal and rifle surfaces in a Three.js tactical FPS training dock. One flat sheet of light neutral gray painted industrial steel, scattered tiny worn paint chips exposing dark metal, subtle scratches and sparse brown oxidation. Restrained hand-painted realistic game art, medium-low contrast. Neutral diffuse illumination, no baked lighting or shadows, no corrugation (mesh supplies ridges), no seams or bolts, no text, no logos, no border, no perspective, no material sphere. Perfectly matching opposite edges. Neutral desaturated coloring so code can tint blue or orange. Fill entire image with texture.
```

### wood

```text
Use case: stylized-concept. Asset type: seamless square 1024x1024 albedo texture for wooden cover crates in a Three.js tactical FPS training dock. Orthographic flat close-up of weathered wooden shipping-crate boards, warm desaturated natural timber with fine grain, small knots, shallow scuffs, delicate narrow parallel board joints. All boards run vertically, consistent medium scale. Restrained hand-painted realistic game art, medium-low contrast and even neutral diffuse lighting. Seamlessly matching opposite edges. No perspective, no border, no text, no stamps, no hardware, no objects, no cast shadows. Fill entire image with wood surface.
```

### dock

```text
Use case: stylized-concept. Asset type: wide 1536x1024 in-game lobby illustration for the existing OFFICE STRIKE tactical FPS. Primary request: polished atmospheric illustration of a compact industrial dock training arena, weathered concrete yard, stacked muted teal and rust-orange shipping containers and timber crates making readable tactical lanes, corrugated hangar beyond, distant harbor gantry crane and soft maritime haze. Original environment art with grounded stylized realism and crisp architectural shapes that suit a low-poly 3D game. Cinematic late-afternoon side light, cool blue shadows, warm golden highlights. Composition: wide establishing view slightly above eye level looking down a lane, strong depth and clear negative space upper third; no people, no guns, no combat, no UI, no words, no logos, no watermark. This is an environment splash illustration, not a screenshot with interface.
```
