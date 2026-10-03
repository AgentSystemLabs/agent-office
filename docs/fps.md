# Office Strike: two-player FPS

Back to the [README](../README.md).

Open the **3D office**, click **FPS · 1V1** (or press **F8** while in mouse-look), then **加入竞技场**. Ask the other player to open the same office server, sign in and join the arena. The first player waits until the second joins; after a three-second countdown, the round begins. The office has one arena with two seats. A third player receives a message that it is full. The 2D `/lite` office cannot join.

For two computers, use your existing shared office URL, HTTPS reverse proxy or SSH tunnel. A server listening only on `127.0.0.1` is available on that computer only; for a trusted LAN, start the office with `--host 0.0.0.0` and your office password, then use `http://<server-LAN-IP>:4600` on both computers. Keep the existing office authentication enabled. Two separate browser windows or profiles also work for testing.

| Control | Action |
| --- | --- |
| WASD | Move relative to where you look |
| Mouse | Aim (click the scene to capture the pointer if needed) |
| Left mouse button | Fire; hold for automatic fire |
| Shift | Walk slowly |
| Space | Jump |
| R | Reload |
| Esc / 暂停 | Open the match menu; the round clock continues |
| ✕ / Esc in the menu | Resume mouse-look |
| 退出对战 | Leave the arena and return to the office |

Each player starts with 100 health, a 30-round rifle magazine and 90 reserve rounds. Body hits deal 34 damage; a headshot deals 100. Cover blocks bullets. Reloading takes 1.8 seconds and prevents firing. The server checks movement, ray intersections, fire rate, ammunition and round results; browsers cannot report their own hits or scores.

Hit feedback uses the same server-confirmed shot endpoint as damage. Body hits create a small directional blood burst and a short impact/confirmation sound; headshots have a brighter two-tone sound and an orange hit marker. A player taking damage also hears a brief low thump. Metal containers, timber crates and concrete walls produce different impact sounds and small sparks or debris, with no blood or hit marker on a miss. Sounds vary slightly between shots and respect the office volume/mute settings. Blood clears within 0.28 seconds and cover debris within 0.16 seconds; particles are depth-tested and cleared on leaving or resetting a round.

There is no hitstop, slowdown, camera shake or automatic aim kick. Movement, input, firing cadence and collision continue normally during feedback. The existing visual rifle kick moves only the weapon model, without moving the camera or aim. No new armor, blocking or damage rules are introduced.

Eliminating the opponent wins a round. A round lasts 90 seconds; if neither player is eliminated it is a draw with no point awarded. After 3.5 seconds both players receive fresh health and ammunition, exchange spawn points and count down for the next round. The first player to win **five rounds** wins the match. In the match menu, both players click **准备再战** to reset the scores and start again.

Leaving the arena, switching floors, disconnecting or refreshing releases your seat. The remaining player returns to waiting, and a replacement starts a new match with fresh scores. Losing focus or opening a window releases movement and firing; it does not freeze the match. Matches are temporary and do not survive an office restart.

This is a focused tactical duel inspired by Counter-Strike. It includes a dedicated dock arena, cover, a rifle, headshots and rounds; it does not include bomb planting, weapon purchases, teams or ranked matchmaking.

The arena uses generated concrete, worn metal and timber albedo textures, and the lobby features original dock artwork. Textures are loaded when entering FPS, with world-scale UVs so walls and cover retain consistent detail. Artwork changes only appearance; the shared collision and hit geometry still determines gameplay. See [FPS art sources and generation prompts](fps-art.md) to reproduce or replace the assets.

## AI practice and aim sensitivity

The FPS lobby also offers **人机单挑**. Choose one of three opponents, then click **挑战 AI** to begin a private match after the same three-second countdown. Each match remains a 1v1, first to five rounds, with the same health, rifle, ammunition and damage rules. Other people can practice independently or use the shared human-versus-human arena at the same time. The scoreboard shows the AI name and current difficulty.

| Opponent | Style |
| --- | --- |
| 突击手 | Closes distance and fires at the body |
| 游击手 | Patrols in the opposite direction and strafes during fights |
| 神枪手 | Prefers longer distances and aims at the head |

Difficulty is **简单 / 普通 / 困难 / 专家**, with **困难** as the initial default. Higher levels react sooner, aim more precisely and fire more frequently; expert bots still obey the rifle's firing interval. Bots use the existing office pathfinder adapted to arena cover, detect visible targets, and stop tracking/firing when cover blocks their sight. They send ordinary controls through the same server movement, collision, reload, ray-hit and scoring code as players. Difficulty never grants extra health, damage, ammunition or penetration.

During practice, press **Esc**, select an AI or difficulty and click **应用人机设置**. This changes the opponent's behavior immediately without resetting the score, health or round. At the end of a training match, **再战一局** needs only your vote. Leaving, changing floors or disconnecting removes your bot and releases the private match. Using F8 to switch to human matchmaking releases the training match; joining practice from a human match leaves that match.

**瞄准灵敏度** is available in both the lobby and Esc menu. Set it from **0.20×** to **3.00×**, with **1.00×** matching the original aim speed. It applies immediately to FPS mouse-look and the existing drag fallback, persists in this browser, and restores the previous office sensitivity when you leave. AI preferences are also saved in this browser. Closing a menu with ✕ or Esc resumes mouse-look; the match continues while the menu is open.
