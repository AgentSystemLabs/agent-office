# The Scranton room extension

Back to the [README](../README.md) · [Ambient office](ambient-office.md)

The Dunder Mifflin cast has a dedicated replica of its television workspace adjoining the original Agent Office. The existing coding-agent desks, boards, lounge, elevator, garage, rooftop and expandable back office remain available. The new suite is permanent on the regular office map and does not occupy any hiring slots.

## Find it

On the east wall, between the **Services** board and the **TV**, walk through the doorway labeled **Dunder Mifflin →**. Follow the enclosed hallway north, then turn left into the annex. From there, the kitchen connects to the sales bullpen, reception, Michael's office and the conference room. Walk back through the same hallway to return to your coding agents. There is no map switch or teleport.

## Where the staff works

- **Reception:** a curved wooden counter, desk phone, computer, waiting couch and Dunder Mifflin sign. Erin staffs reception in the Season 6 ensemble.
- **Sales bullpen:** Jim and Dwight sit on opposing sides of their pod; Andy and Pam occupy the next pod. Stanley and Phyllis sit together, with Meredith and Creed in the copier/quality-assurance area.
- **Accounting:** Angela, Oscar and Kevin have individual desks beside one another.
- **Michael's office:** a private workspace beside reception, with glass frontage, horizontal blinds, his nameplate and boss mug.
- **Conference room:** beside Michael's office, with glass and blinds, rows of chairs and a whiteboard. Staff take their seats for ambient meetings here.
- **Kitchen and break room:** counters, fridge, tables and vending machines; staff meet here during breaks and office celebrations.
- **Annex:** HR and customer-service workstations for Toby and Kelly, with a visiting workspace for Darryl. Ryan has a small closet office off the kitchen.
- **Building details:** the stairwell core and restroom partitions complete the recognizable room arrangement. The stair core is scenery; travel between project floors still uses the original elevator.

The room layout uses [RoomSketcher's published Dunder Mifflin floor plan](https://www.roomsketcher.com/blog/american-the-office-floor-plan/) as a visual reference, alongside the supplied character bible. The reconstruction uses original procedural geometry, scaled to the game's avatars and navigation clearances rather than surveyed set measurements. It contains no downloaded television imagery or video. Furniture, signs, desktop computers, blinds, fluorescent fittings and props are created in code.

## Routines and interaction

Character homes, lunch spots and scene destinations all point into the replica. During ordinary work they sit at their assigned desks; meetings use the conference chairs. The original ambient schedule and optional work scratchpad continue unchanged. The **Dunder Mifflin** clock stays available on the main office floor, so you can open the directory without walking over. Quiet mode hides dialogue; hiding coworkers leaves the replica room in place.

Player collision uses the extension's floor, ceiling, partitions and furniture. Its navigation grid uses those same wall and furniture footprints. The camera recognizes the suite and narrow connecting corridor as indoor spaces and restores the original room bounds on return. Indoor lighting and sound also follow the visitor into the extension. Staff movement and assistance remain local to each browser; other real players still share their usual multiplayer positions.

## Code and verification

The feature is `src/client/features/scranton/`: `world.ts` is an office fixture, `props.ts` makes the furniture, `batch.ts` batches solid static geometry while retaining lettering textures and transparent panes, `routines.ts` adapts the cast's spatial dependency, and `index.ts` registers camera and indoor-context handling. Shared physical data is in `src/shared/scranton.ts`. The fixture joins the floor-build registry, its east doorway joins `src/shared/office-openings.ts`, and `src/shared/office-footprints.ts` keeps scenery trees out of the extension. The ambient feature accepts the room through a small space dependency.

`tests/scranton.test.ts` checks that every character has a reachable workstation, room connections remain open, seating matches the chosen era, and all autonomous scenes stay within the replica. Headless-browser verification walks through the actual original-office doorway and corridor, checks grounded entry and camera restoration, and captures the replica's floor plan and bullpen. Run `npm run typecheck`, `npm test` and `npm run build` as usual.
