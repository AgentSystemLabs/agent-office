# Controls

Back to the [README](../README.md).

| Key | Action |
| --- | --- |
| W A S D / arrows | Walk (hold Shift to run); on the ladder, W and S climb; in a car, W is the gas, S brakes and reverses, A and D steer |
| Space | Jump (you can land on desks, couches and the cars in the garage); in a car, brake |
| Mouse drag / wheel | Orbit / zoom the camera |
| E | Interact: hire a worker, open its terminal, read a board, take an issue's note off the board, prompt a board agent, call a meeting in the meeting room, draw on the whiteboard, read the docs at the bookshelf, watch the TV, sit down (or get up), ride the elevator, climb the ladder (or get off it), slide down a fire pole, grab a coffee, take a smoke break, tee off at the golf tee, pet the dog, pick up the basketball (then hold E and let go to shoot), order a drink at the rooftop bar, blow the DJ's air horn, step up to the dart board or the axe lane on the roof (then hold Space and let go to throw), get into one of the cars in the garage (behind the wheel, or beside whoever's driving) or out of it, knock through the north wall past the gong for 2 more desks (at the **🚧 Room to grow** sign). In the [castle](maps.md#the-castle): sit on the throne, where E is for whoever's first in line (or the Hand of the King, with nobody waiting), and speak to the Hand to send out a new worker. On the [space station](maps.md#the-space-station) it's the captain's chair and the First Officer |
| K | On the castle's throne (or in the station's captain's chair): speak to the Hand of the King (the First Officer), to send out a new worker |
| P | Prompt: give a task to a new worker, or to the one at this desk |
| C | Changes: the files the worker at this desk changed and their diff; commit, discard or open a PR |
| B | Open a shared shell at an empty desk |
| R | Resume a sleeping worker (or restart a shell) |
| X | Send a worker home (frees the desk; a worker with its own worktree asks what to do with it). In the [castle](maps.md#the-castle), the Kingsguard takes it down to the dungeon; on the [space station](maps.md#the-space-station), Security puts it out of the airlock |
| L | Hang a big sign over the desk you face (*Operations*, *Code cleanup*), in one of seven colors; again to change it or take it down |
| O | Open a pull request for a worker on its own branch, or see the one it has (a worker across several projects gets one in each) |
| N | Go to the worker that has waited longest on someone; again for the next one |
| F | Hang a picture from the web on a wall (scroll to size it, click to hang it) |
| Q | Put back the issue card you're carrying, or drop the basketball |
| H | These controls; in a car, honk the horn |
| T / Enter | Chat |
| G / 1–6 | Emote: hold G for the wheel (point and let go) or press 1–6 to wave, give a thumbs up, clap, dance, point or facepalm; everyone on your floor sees it |
| / | Search the chat and every terminal on your floor |
| Ctrl + K (⌘K on a Mac) | Command palette: find a worker, issue, PR, service, board, teammate or action; Enter opens it, Shift+Enter walks you there first |
| V | Join voice; in voice, hold to talk (you're muted when you let go) |
| M | Mute / unmute in voice |
| Ctrl + Space | Dictate, in a worker's terminal or a prompt box: hold it and talk, and what you said is typed in when you let go. A quick tap leaves it listening until the next tap. The **🎤** does the same |
| Tab | The ☰ menu: every window, and what shows on screen |
| Esc | Close any window (a terminal too) and get back to looking around |
| Ctrl + [ | Send Esc to a terminal instead, to close a menu like Claude's `/skills` or interrupt Claude. **⎋ Esc** in the terminal's header does the same |

You can also click a nearby desk to interact with it, or click a worker in the Workers panel (**🤖 Workers**, top right) to open its terminal.

On a phone, use the 2D view at `/lite` instead: a terminal there has a row of keys under it (**1** **2** **3**, the arrows, Enter, Tab, Esc, Ctrl+C) and a box to send a prompt. See [Features](features.md).

## In a terminal

The prompt edits the way it does in your own terminal (iTerm2's *Natural Text Editing*, or VS Code's), in Claude Code, Codex, OpenCode and a shell alike:

| Key | Action |
| --- | --- |
| Shift + Enter | A new line in an agent's prompt, without sending it (in a shell it runs the line, like Enter) |
| Ctrl + Space | Dictate: hold it and talk, and what you said is typed in at the cursor when you let go (see [Features](features.md)). **🎤 Dictate** in the terminal's header does the same |
| Ctrl + ⌫ / ⌥ + ⌫ | Delete the word before the cursor |
| ⌘ + ⌫ | Delete to the start of the line (Mac) |
| ⌘ + ⌦ | Delete to the end of the line (Mac) |
| ⌘ + ← / → | Jump to the start / end of the line (Mac) |
