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

Eliminating the opponent wins a round. A round lasts 90 seconds; if neither player is eliminated it is a draw with no point awarded. After 3.5 seconds both players receive fresh health and ammunition, exchange spawn points and count down for the next round. The first player to win **five rounds** wins the match. In the match menu, both players click **准备再战** to reset the scores and start again.

Leaving the arena, switching floors, disconnecting or refreshing releases your seat. The remaining player returns to waiting, and a replacement starts a new match with fresh scores. Losing focus or opening a window releases movement and firing; it does not freeze the match. Matches are temporary and do not survive an office restart.

This is a focused tactical duel inspired by Counter-Strike. It includes a dedicated dock arena, cover, a rifle, headshots and rounds; it does not include bomb planting, weapon purchases, teams or ranked matchmaking.

The arena uses generated concrete, worn metal and timber albedo textures, and the lobby features original dock artwork. Textures are loaded when entering FPS, with world-scale UVs so walls and cover retain consistent detail. Artwork changes only appearance; the shared collision and hit geometry still determines gameplay. See [FPS art sources and generation prompts](fps-art.md) to reproduce or replace the assets.
