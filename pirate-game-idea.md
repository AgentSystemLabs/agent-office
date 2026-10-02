# Pirate game idea — living concept and implementation plan

Last updated: 2026-10-02 (Europe/Vilnius).

Status: concept direction accepted; mechanics below are proposed defaults unless marked as decided. A [dedicated development plan](pirate-game-plan/README.md) now records architecture, individual DEV tasks, mandatory review, stage/PROD promotion, verification, and operations. Planning must satisfy its readiness gate before implementation starts. This does not authorize starting game implementation or changing agent-office's runtime.

Working names: PromptCraft / PromptyCraft. Final name and availability remain open.

## Product promise

**Build an island home with your friends, design your ship with AI, and sail into an ocean of treasure and adventure.**

A browser multiplayer pirate game combining personal building, cooperative expeditions, ship customization, and optional naval conflict. AI helps players turn their ideas into editable buildings and boats. Exploration provides materials and unlocks that give construction a purpose.

Initial audience assumption: ages 8–14, with parents managing accounts and payments. The exact age range, launch countries, and suitability of competitive modes must be decided before a children’s pilot.

## Direction established in the conversation

- Four friends form a crew and start on a small shared island.
- Players build bases and a boat, fish, salvage supplies, and explore the ocean.
- Server-owned, uninhabited islands provide treasure, resources, and discoveries. Ordinary discovery islands cannot be claimed.
- Ship upgrades support longer and more challenging expeditions.
- Naval encounters, stolen island charts, and subsequent raids are part of the longer-term vision.
- Larger islands may eventually support towns and multiple crews.
- Environmental events such as volcanic activity give communities shared objectives.
- Animated NPC builders make AI construction visible and make settlements feel alive.

The user accepted the proposed plan as a basis for further development. Exact rules, numbers, and later feature scope remain subject to refinement.

## Core gameplay loop

1. Build and prepare at the home island.
2. Choose an expedition objective and sail with the crew.
3. Fish, explore, solve encounters, salvage wrecks, and optionally battle.
4. Return with materials, treasure, and blueprints.
5. Upgrade the island and ship, opening new expedition opportunities.

Each expedition should have an achievable objective and a satisfying return: iron for a hull upgrade, a lighthouse blueprint, an unusual fish, or a rescued builder. The game must remain enjoyable without encountering another crew.

AI construction alone is not the retention loop. Players return to improve their home, finish shared projects, unlock equipment, and undertake new adventures together.

## Crew, home, and ownership

The crew shares a home island, harbor, workshop, storage, and ship. Each player also has a personal building area so individual expression does not require unanimous crew approval.

Expedition jobs are interchangeable activities, not permanent classes:

| Job | Activities |
| --- | --- |
| Captain | Steering, navigation decisions, route selection |
| Navigator | Reading charts, identifying weather and nearby discoveries |
| Engineer | Repairing damage and operating ship equipment |
| Explorer | Fishing, salvage, tools, and island encounters |

Ships remain usable when fewer than four friends are online. Players can switch jobs, and simple NPC helpers may cover selected tasks later.

Proposed permissions: owner, builder, visitor. Visitors cannot alter constructions or withdraw protected supplies. Shared actions need attribution, version history, and recoverable mistakes.

Before implementation, define crew leadership changes, membership removal, personal asset ownership, storage withdrawals, and what happens when a contributor leaves. A crew leader must not be able to erase another player's personal creations arbitrarily.

## Resources, gold, and AI

Separate the game economy from real AI billing:

- **Materials:** wood, stone, cloth, metal, and food. Used for construction, equipment, and repairs.
- **Gold:** earned treasure used for equipment, cosmetics, and services; exact sinks remain open.
- **Blueprints:** discoveries unlocking styles, mechanisms, or approved components.
- **AI request allowance:** an operational entitlement with understandable limits, separate from earned gold.

Example: a player requests a lookout tower with a spiral staircase and blue roof. The game presents a preview and material cost. The player changes its size or approves construction. Choosing between that tower and ship repairs creates a meaningful resource decision.

Do not equate farmable treasure directly with unlimited API tokens. Bots or exploits could turn game currency into unbounded provider spending. Define per-account limits, bounded retries, crew limits where useful, and a service-wide spending circuit breaker.

Failed generation must not consume expedition materials. Decide how failed requests affect the AI allowance. Manual editing and existing worlds remain available when that allowance is exhausted or AI is unavailable.

Start survival with forgiving rules: preparation, repairs, weather, and cargo management. Food could improve expedition readiness. Constant hunger and repetitive resource chores are not initial requirements.

## AI building and animated construction

AI produces a compact building plan using approved components and parameters. Game code validates and constructs it; the model does not execute arbitrary server code.

Proposed request pipeline:

1. Authenticate the player and check permissions and quota.
2. Check input for unsuitable content and personal information.
3. Send only the necessary scene summary to the configured provider.
4. Generate a structured plan for approved building operations.
5. Validate bounds, components, complexity, permissions, and material cost.
6. Show a preview with editable placement and parameters.
7. On confirmation, recheck the current world version and resources.
8. Save one authoritative construction job and reserve its material budget.
9. Animate builders and apply the approved result consistently for everyone.
10. Complete, cancel, or recover the job without duplicate spending or placement.

Exact material reservation, cancellation, and refund rules need a design decision. Record a unique job ID so retries and reconnections do not create duplicate builds.

AI should describe a wall, room, or bridge compactly; ordinary code fills in repetitive geometry. Schema-valid output still requires semantic checks. Existing constructions need targeted edits, manual tools, preview, confirmation, and undo.

NPC builders inspect sites, carry supplies, hammer, pause for missing materials, and celebrate completion. Thought bubbles follow job state, for example: “Roof next!”, “We need three more planks,” or “The captain requested a bigger window.” These do not require a model call on every animation tick.

Builder personality can come from outfits, animations, and recurring phrases. Unrestricted AI companion conversations are outside the initial scope.

## Boat construction and progression

The ship is a recognizable shared creation and a moving home. Begin with tested hull families such as a raft and sloop; introduce larger crew ships later.

Customization may include sails, colors, flags, figureheads, cabins, furniture, cargo storage, fishing equipment, salvage cranes, armor, repair stations, lookout platforms, and navigation instruments. Weapons belong to the later combat milestone.

AI requests such as “a fast fishing boat with a little kitchen” assemble approved modules. Performance follows explicit game rules rather than arbitrary generated geometry: cargo capacity, handling, speed, hull durability, equipment slots, and eventually weapon limits.

Larger cargo capacity or heavy armor should involve tradeoffs. Players cannot prompt their way to an invincible ship or unlimited cannons. Paid AI allowances must not bypass equipment unlocks or competitive limits.

Fully arbitrary buoyancy and ship physics are deferred. Save ship designs separately from temporary damage and cargo so a defeat does not erase creative work.

## Ocean discoveries

| Discovery | Gameplay and rewards |
| --- | --- |
| Shipwreck | Salvage supplies and recover charts |
| Uninhabited or ruined island | Explore and solve a bounded puzzle for treasure |
| Fishing grounds | Catch unusual fish and gather ingredients |
| Storm region | Navigate hazards for better salvage |
| Merchant harbor | Trade supplies and obtain missions |
| Wildlife sanctuary | Help creatures and earn decorations |
| Volcanic island | Participate in a scheduled cooperative event |
| Ancient workshop | Unlock a construction mechanism or blueprint |

Use authored encounter rules with variable layouts and rewards. AI may personalize descriptions or presentation, but reward fairness and puzzle solvability must be controlled by game logic.

Ordinary discovery islands are server-owned and cannot be claimed. Later claimable outposts and frontier islands are explicitly different destination types.

## Naval combat and stolen charts

Naval PvP is a later, opt-in feature. Crews knowingly enter contested ocean zones; cooperative waters remain available. Decide whether competitive play should target an older age group or a separate mode.

Proposed stolen-chart sequence:

1. Two eligible crews fight in a contested zone.
2. A defeated ship leaves capped salvage and may drop a chart.
3. The winning crew can use the chart for one time-limited raid opportunity.
4. Defenders receive an understandable warning and preparation period.
5. A harbor encounter occurs while the defending crew is participating, under agreed eligibility rules.
6. The chart expires after use or its time window, followed by a protection cooldown.

Suggested warning: “Our chart was stolen. Another crew can find our harbor. Get home and prepare!”

The chart should grant a controlled route to a raid session rather than permanently disclose reusable home coordinates. Its display can still use a compass, bearings, and a pirate map.

Permanent coordinates invite repeated harassment, chart sharing, and offline attacks. Owning land must not require staying online to defend it. Define chart expiry, defender availability, combat logout, repeated targeting, matchmaking, and disconnect behavior before implementing this mode.

After a naval defeat, the ship can return home damaged, with a capped cargo loss. Preserve its design and ensure players have a workable recovery path even if they run out of materials.

## Harbor raids versus flag capture

Use different loss rules for different places:

| Place | Proposed conflict | Stakes |
| --- | --- | --- |
| Personal home area | Protected building | No hostile destruction |
| Crew harbor | Optional raid session | Designated treasure and repairable defenses |
| Neutral outpost | Flag capture | Temporary control and benefits |
| Large frontier island | Later seasonal competition | Claims, bonuses, and fortifications |

For a harbor raid, attackers could steal a designated chest, damage gates, and disable defensive equipment. Houses and personal decorations remain protected. Defeat creates repairs and a story instead of deleting hours of creative work.

Consider a raid copy of the harbor with a controlled merge of allowed damage and rewards. The exact session and persistence approach needs prototyping. Avoid allowing live editing to invalidate an active encounter.

Permanent seizure of another child's home is not the recommended initial rule. Flag conquest better fits contested outposts. Stronger loss mechanics could be considered separately for an intentionally harsher mode.

Specify maximum losses, raid duration, victory conditions, defense budgets, protection cooldowns, and anti-collusion rules. Prevent repeatedly farming another account for charts, gold, or ranked rewards.

## Towns and frontier islands

Later, multiple crews may settle larger islands and create docks, workshops, farms, markets, and public structures. Use a fictional archipelago with its own creatures, cultures, and mysteries rather than reproducing historical colonial conquest.

Separate personal plots, crew facilities, and public infrastructure. Define leadership, contributions, public spending, claim limits, abandonment, and member departure. Town leaders cannot freely delete residents' homes.

Territorial seasons may reset contested claims or bonuses, but permanent creative homes and saved designs need clearly communicated preservation rules.

## Volcanoes and community events

Example event sequence:

1. Tremors begin and an observatory shows rising activity.
2. Players receive a visible schedule and explainable objectives.
3. Crews gather resources for barriers, evacuation boats, and public protection.
4. The community chooses which eligible public areas to defend.
5. The eruption changes designated landscape areas and exposes new caves.
6. Players repair, explore, and receive contribution-based rewards.

Protect personal creations and provide automatic evacuation or recovery. Events must not punish players simply for being offline. Begin with deterministic, scripted rules; an AI does not need authority to decide whose home is destroyed.

## Multiplayer and persistence direction

Selected engineering baseline, pending implementation verification: TypeScript browser client with Three.js, Node/Colyseus authoritative rooms, PostgreSQL account/ownership storage, and versioned world state. The [foundation specification](pirate-game-plan/foundation-spec.md) records exact versions and setup, and [contracts/storage](pirate-game-plan/contracts-and-storage.md) specifies adult identity, message bounds, resource transactions and restore.

- Home islands and ocean encounters are bounded sessions, connected through travel.
- Empty islands save and unload; they do not each require permanently running simulation.
- Four-player private sessions are the initial target.
- Larger ocean populations and cross-crew encounters require their own load tests and matchmaking design.
- Servers decide movement validity, inventory, rewards, land access, and construction acceptance.
- AI generation runs outside the simulation loop so slow requests do not freeze gameplay.
- Reconnect from acknowledged state; make accepted operations recoverable and idempotent.
- Cap world geometry, active physics, ship components, and network traffic.
- Load nearby world sections and send compact changes rather than entire scenes repeatedly.

Agent-office is a reference for browser presentation and modular organization, not a child-facing backend to expose unchanged. Its trusted-user shell and coding-agent access must not be part of this game. A separate project is the recommended implementation destination; asset and dependency licenses need review.

## Children’s safety and privacy before a pilot

Private multiplayer reduces risk but is not an exemption from child privacy obligations. Launch age range and jurisdictions determine required consent, age assurance, provider arrangements, and operational processes.

Proposed initial safeguards:

- Parent-managed accounts and approved invitations.
- Private sessions, revocable invitations, and explicit visitor permissions.
- Preset communication and emotes initially; public voice and stranger messaging deferred.
- No unrestricted uploads, external links, arbitrary scripts, or provider credentials in clients.
- Input checks, output checks, shared-creation reporting, blocking, and human escalation.
- Minimal personal data, defined retention, and parent-accessible deletion.
- A plan for manually constructed harmful content, not only unsafe prompts.
- No loot boxes, speculative land markets, or player cash trading in the MVP.

Before transmitting child prompts, verify the provider’s terms and data controls. OpenAI’s under-18 guidance requires zero data retention before processing personal data of children under 13 or the applicable digital-consent age; its controls require approval. Setting `store: false` alone is not equivalent. Redaction cannot guarantee that free-text input contains no personal data.

References to recheck before implementation:

- [OpenAI under-18 guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
- [FTC children’s privacy rule overview](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data)
- [EDPB lawful processing guidance](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en)
- [EU guidance on protection of minors](https://digital-strategy.ec.europa.eu/en/library/commission-publishes-guidelines-protection-minors)

## Staged implementation path

These are scope gates, not delivery commitments. Do not start every stage at once.

### Stage 0 — decisions and adult-tested prototype

- Verify the selected desktop/adult-prototype baseline, repository setup and independent-review prerequisites. Decide launch audience/geography and real AI provider before later pilot tasks.
- Prototype sailing, one hull, one island, manual building, and compact AI plans.
- Test component limits, targeted edits, construction previews, and persistence.
- Establish provider data handling and consent requirements before a children’s pilot.

Exit evidence: an adult tester can build, sail, collect a resource, return, and improve something without a developer repairing their session.

### Stage 1 — cooperative MVP

- One shared home island with personal areas.
- Four-player private sessions and crew permissions.
- One customizable boat and a small ocean.
- Fishing, wreck salvage, and several authored discovery encounters.
- Limited AI construction catalog with previews, edits, and undo.
- Animated NPC builders driven by construction jobs.
- Persistent materials, gold, blueprints, buildings, and ship designs.
- One cooperative hazard, such as a storm.
- Required parent controls, quotas, reporting, recovery, and deletion.

Exit evidence: consented pilot crews voluntarily undertake another expedition, understand permissions and material costs, and can recover from disconnects and mistakes.

### Stage 2 — opt-in naval combat

- Bounded contested zone and eligible crew matchmaking.
- Tested ship weapons, damage, repair, defeat, and recovery rules.
- Capped salvage, anti-farming rules, and disconnect behavior.
- Cooperative play remains available independently.

Exit evidence: both winners and losers want another session; losses do not erase creative progress or strand a crew.

### Stage 3 — stolen charts and harbor raids

- Expiring charts, warnings, preparation, availability, and cooldowns.
- Controlled harbor encounters with limited damage and treasure loss.
- Clear win conditions, anti-repeat-targeting, and recovery.

Exit evidence: raids create understandable tension without offline obligations or repeated harassment.

### Stage 4 — outposts, towns, and events

- Temporary flag control of designated outposts.
- Larger settlement islands with robust ownership and leadership rules.
- Scripted volcano and community events.
- Regional capacity and moderation expansion based on measured demand.

Defer open discovery feeds, public chat, unrestricted generated assets, arbitrary code execution, player trading economies, and large territorial wars until their gameplay and operational requirements are separately justified.

## Validation and success criteria

Measure behavior, not registrations alone:

- Time to first successful build and first completed expedition.
- Whether players can edit a build without adult assistance.
- Return visits and voluntary second expeditions.
- Time spent playing and editing beyond requesting AI generations.
- Whether four-player cooperation improves enjoyment.
- Successful build cost, retries, latency, and request volume per crew.
- Frame rate, network usage, server load, reconnect success, and save recovery.
- Parent understanding, consent completion, willingness to pay, and support load.
- Reports, griefing attempts, inappropriate creations, and response effectiveness.

Set numeric gates after the first prototype establishes realistic baselines. Family subscriptions may be a fit, but pricing, conversion, AI allowances, and moderation costs remain unvalidated.

## First-expedition specification — cooperative vertical slice

Planning approval: the user requested this specification on 2026-10-02. This authorizes refining the plan, not starting runtime implementation. The following are **provisional prototype defaults**; quantities, timings, dimensions, and rewards are tuning targets, not validated balance.

### Scope and experience

Target a 20–25 minute first adventure for one to four friends. Start on desktop browsers, with a third-person camera and a private crew session. A shared home island contains four protected personal plots. There are no stranger encounters, naval weapons, stolen charts, raids, territorial claims, or paid progression in this slice.

Use a stylized modular world. Players can place approved buildings on plots and a shared construction pad. Arbitrary terrain excavation, custom executable code, and arbitrary ship hull generation are deferred. Survival centers on ship readiness and a small weather hazard; there is no starvation timer.

For the prototype, one crew's home and bounded ocean belong to one authoritative session. This avoids cross-server travel before the expedition works. Destinations load by proximity; a broader shared ocean is a later architecture decision.

### Starting island and supplies

Suggested home footprint: approximately 96 × 96 world meters. Treat dimensions as adjustable after movement tests.

- A sheltered spawn area, recovery bell, and readable objective board.
- Four approximately 16 × 16 personal plots, clearly labeled by player.
- A dock with one damaged starter sloop and a boarding point.
- A shared storage chest and an approximately 8 × 8 construction pad.
- Six nearby driftwood bundles, each granting four wood once per crew.
- A workshop that previews the first ship upgrade.
- A visible departure lane and compass landmark to help players return.

Each player receives reusable interaction tools and a fishing rod. These are not lost on recovery. Starting consumable supplies belong to the crew, not to each joining player:

| Supply | Starting amount | Purpose |
| --- | --- | --- |
| Wood | 30 | First repair, shed, and later upgrades |
| Cloth | 4 | First sail upgrade |
| Metal | 0 | Acquired from the wreck |
| Fish | 0 | Optional trade objective |
| Gold | 0 | Cosmetic reward; no AI billing conversion |

Joining, reconnecting, or replacing a player never creates a second starter grant. Collected driftwood remains collected for that introductory adventure. Repeat expedition replenishment rules are outside the first-adventure economy.

### First-adventure beats

| Approximate time | Activity | Intended result |
| --- | --- | --- |
| 0–3 minutes | Meet at spawn, inspect supplies, repair the sloop | Crew understands shared resources and boarding |
| 3–7 minutes | Preview, edit, and construct a storage shed | Player experiences useful AI creation and builder animation |
| 7–10 minutes | Depart and sail to the wreck | All passengers have useful activities |
| 10–15 minutes | Salvage and fish or trade at the nearby cove | Crew earns metal, cloth, and a blueprint |
| 15–20 minutes | Optional beacon puzzle and a small squall | Exploration has an activity beyond collecting items |
| 20–25 minutes | Return, unload, upgrade, inspect the next chart | Clear accomplishment and a reason to sail again |

These are pacing targets, not forced timers. Players may skip the optional encounter, build manually, pause, or take longer. The next-adventure chart is a teaser until its destination is implemented; label it accordingly rather than sending players to an empty island.

### Controls and interaction

- WASD moves the character; mouse controls the third-person camera; Space jumps.
- E interacts with a nearby object, station, dock, or helm.
- Hold a mouse button to rotate the camera; aiming and modal behavior require a usability prototype.
- At the helm, W/S controls throttle and A/D steers; E releases the helm.
- A build panel supports describe, preview, rotate, place, confirm, cancel, and undo.
- Esc and a visible top-right close button dismiss panels and restore gameplay input without an extra click.
- A short preset-message wheel covers “Ready,” “Need help,” “Return home,” and “Found supplies.” Open text and voice chat are deferred.

Interaction hints must distinguish walking controls from helm controls. No action should require knowing a keyboard shortcut without an on-screen hint. Touch controls remain outside this prototype.

### Boat rules

The first sloop is approximately eight meters long and three meters wide, using one tested hull with visual customization. Starting hull condition is 60/100; spending six wood at the dock restores it to 100/100 and completes the departure objective.

Provisional cruise speed is six meters per second. Tune destination distances for roughly 45–90 seconds of sailing between nearby activities. Favor readable arcade steering; detailed wind simulation, wave forces, and arbitrary buoyancy are deferred.

Only one player occupies the helm. Passengers can move on the deck, use designated fishing or lookout points, and perform repairs. A repair consumes two wood for 20 hull points, capped at 100. Repair and station actions must validate range and ownership on the server.

Movement aboard uses a stable ship-relative reference so players move with the deck. Prototype turning, jumping, docking, and reconnecting on a moving ship before adding ship content. If this cannot be made reliable, explicitly revise the first slice to fixed passenger stations rather than shipping unreliable movement.

Docking is an assisted interaction inside a visible dock radius. Anchoring allows fishing and boarding at destinations. Boundary water turns the boat toward the playable area with a clear warning; it does not imply an infinite ocean.

### Three discovery encounters

All three destinations are server-owned and cannot be claimed. Rewards are shared crew rewards, granted once for the introductory adventure and persisted by encounter ID.

| Encounter | Interaction | Provisional reward |
| --- | --- | --- |
| Broken-Mast Wreck | Anchor, approach, open three marked salvage crates; use a shared progress indicator | Ten wood, four metal, five gold, first sail blueprint |
| Tidepool Cove | Catch fish through a short timing interaction; exchange two fish with a merchant once | Two cloth and three gold; fishing itself can continue within inventory limits |
| Old Beacon Islet | Find three nearby symbols and activate their matching levers; all clues remain visible | Two gold, decorative lantern unlock, next-expedition chart teaser |

Puzzle completion must work solo. Multiple players can cooperate, but no mechanism requires simultaneous attendance. Opening a crate at the same time cannot double its reward. An unsolved puzzle never blocks returning home.

The first sail upgrade costs ten wood, four cloth, and four metal. It adds a visible sail improvement and a provisional 10% cruise-speed increase. This is deterministic workshop crafting, not another AI request.

Economy sanity check: the initial 30 wood covers the six-wood repair and eight-wood shed before exploration. The wreck supplies all required metal; starting cloth already covers the upgrade. The cove and beacon are optional, so the upgrade does not depend on fishing success. Gathering driftwood and wreck salvage leave a repair buffer.

Gold has no competitive benefit in this slice. An optional eight-gold flag-color unlock gives treasure an understandable cosmetic use. Players can still complete the expedition without purchasing it.

### AI construction contract

First catalog: storage shed, lookout tower, small cabin, dock extension, fence, and decorative tree. Start with one bounded storage-shed tutorial: a six-by-four-meter shed with selectable roof color and door position, costing eight wood. Visual variants have the same introductory material cost; its storage interaction uses tested game code.

The initial model interprets requests into approved component plans and supported edits. Unsupported requests produce a friendly explanation and supported alternatives. No construction can exceed its plot, overlap the dock departure lane, trap a player, or change another player's objects without permission.

The tutorial asks for a shed, previews it, changes one parameter such as roof color, and confirms placement. Provide preset requests and a manual placement alternative so provider outages do not block the adventure.

For adult prototype testing, configure a provisional ten-request budget per crew adventure, including revisions. Do not silently reset it on reconnect. Budget replenishment, family entitlements, and underage free-text access remain separate launch decisions.

Construction takes approximately 20 seconds and uses two animated builders. After confirmation, the server atomically reserves materials and saves the job. Collision-affecting final geometry appears on completion; intermediate scaffolding is visual only. Builders and bubbles reflect server job progress rather than calling AI every frame.

Cancellation before completion returns reserved materials and removes scaffolding. Completed tutorial construction can be undone during the adventure if nobody has changed or used it and no dependent object exists; restore its materials. The wider undo/refund economy must be specified before general construction unlocks.

If world state changes after a preview, reject confirmation and refresh the preview instead of charging against stale state. Provider refusals, malformed plans, timeouts, and internal retries never charge materials or create partially accepted builds.

### Ownership and cooperative safeguards

- Each player can build on their personal plot. Shared-pad construction is available to crew builders.
- For this private cooperative slice, approved builders may spend shared materials, with a visible action log; owner can revoke permission. No transferable ownership or member-removal economy is implemented yet.
- No visitor may spend supplies, claim rewards, steer, or edit the world unless explicitly admitted as a crew member.
- Only the helm occupant can send boat-control commands. Disconnect releases the helm.
- Prevent conflicting placements and duplicate workshop purchases through server version checks.
- The introductory adventure has one vessel and no trading between crews.

### Failure, pause, and recovery

| Situation | Required behavior |
| --- | --- |
| Player falls into water | Swim toward the boat; offer return to deck after a short delay; accessible rescue stays available |
| Player disconnects | Save identity and resume on the ship or a safe dock; release occupied stations; no duplicate supplies |
| Everyone leaves | Save crew and world; pause the adventure and hazard; restore safely when someone returns |
| Boat reaches zero hull | Recover crew and ship at home; retain design and all tutorial cargo; restore 60 hull and offer a free recovery repair |
| No repair supplies remain | Tutorial recovery path provides the minimum repair; repeated use grants no sellable resource |
| Small squall occurs | Telegraph its path; offer a route around it; cap its scripted damage at 20 hull across the introductory encounter |
| AI is slow or unavailable | Keep movement and manual building available; show bounded waiting and a preset/manual fallback |
| Preview becomes invalid | Refresh without material spending; explain the changed placement or permission |
| Server restarts during construction | Recover the saved job, reservation, and progress exactly once; complete or cancel consistently |
| Two players collect the same reward | One shared grant appears for both; no duplication |

The cooperative tutorial intentionally has no cargo loss on sinking. Later expedition modes may add limited cargo losses after separate playtesting. Persist gold and rewards; recovery does not allow replay farming. Do not apply storm damage while the entire crew is offline.

### Implementation work packages and dependencies

These packages belong to a future game repository, not agent-office runtime. Technology candidates still require selection. Build this slice before designing all later systems in detail.

| Package | Deliverable | Depends on |
| --- | --- | --- |
| P0 | Device target, adult-test setup, provider/data boundary, component catalog and permission rules | Planning decisions |
| P1 | Camera, character movement, island, dock, third-person interaction hints | P0 |
| P2 | Private crew session, authoritative state, inventory, identity and restore | P0 |
| P3 | One sloop, helm, passengers, docking, fishing stations and rescue | P1, P2 |
| P4 | Manual components, collision-safe placement, previews, material transactions and jobs | P1, P2 |
| P5 | AI planner adapter, validation, quota, bounded retries and fallback | P4, provider decision from P0 |
| P6 | Wreck, cove, beacon, reward transactions and squall | P3, P4 |
| P7 | Builder animation, workshop upgrade, tutorial objectives and return-home flow | P4, P5, P6 |
| P8 | Reconnect, restart, concurrency, recovery, metrics and usability verification | P2–P7 |
| P9 | Parent flows, provider approval, reporting and consented children’s pilot | P8, jurisdiction/safety decisions |

Select persistence and network contracts before P2 implementation. Initial entities to specify: Crew, Member, Plot, Inventory, Vessel, BuildPlan, ConstructionJob, EncounterProgress, RewardGrant, and AdventureProgress. Each durable mutation needs an operation ID, actor authorization, validation, and a clear success or rejection result. API credentials never reach browsers.

### Acceptance criteria and verification

The slice is ready for an adult usability test only when:

1. One to four players can join a private session and complete the introductory adventure; solo completion never requires missing crew members.
2. Players repair, board, steer, dock, fish, salvage, return, and purchase the first upgrade without developer intervention.
3. A supported AI request produces a legal preview, supports a targeted change, and constructs exactly once at the displayed material cost. Manual fallback completes the same objective.
4. Passengers remain stable during steering and docking; falling overboard has a usable rescue path.
5. Concurrent collecting, repairs, build confirmation, and upgrades neither duplicate rewards nor produce negative inventory.
6. Reconnect and server restart preserve supplies, ship design, encounter grants, and construction reservations.
7. Invalid permissions, oversized plans, malformed output, and stale previews cannot mutate another plot or spend materials.
8. The first adventure can finish after a squall, sinking, exhausted AI allowance, or provider failure.
9. Prompts and sensitive account information do not appear in routine metrics; provider calls obey the approved data boundary.
10. Record frame rate, boat network behavior, build latency, provider cost, retries, expedition completion, and observed frustration on the chosen baseline device and network. Set release thresholds after measurements, rather than claiming an untested performance budget.

Use meaningful transaction and recovery tests for authoritative state, automated multi-client scenarios for concurrency, and headless-browser screenshots for visual milestones. Screenshots cannot verify ship feel: short adult usability sessions are needed for camera, passenger movement, and pacing. A children’s pilot additionally requires the P9 prerequisites.

## Open decisions for the next conversations

1. Exact age range and whether PvP is restricted to an older or separate mode.
2. Validate the desktop-browser prototype default; decide when tablets enter scope.
3. Validate third-person controls and passenger movement; choose any later alternative camera modes.
4. Final art direction and terrain-editing scope beyond modular prototype plots.
5. Validate a shared crew home with personal plots; define leadership and member departure.
6. Tune the starter sloop and select later hulls and component progression.
7. Decide later food and survival systems; the introductory adventure has no starvation.
8. Launch AI allowances, broader resource costs, refunds, and progression unlocks; tutorial numbers are provisional.
9. Validate 20–25 minute first-adventure pacing and 45–90 second nearby sailing legs.
10. PvP eligibility, matchmaking, chart drop conditions, and maximum losses.
11. Raid availability, combat logout rules, and harbor session persistence.
12. Town ownership, seasons, abandonment, and cancellation policies.
13. Child-data provider arrangement, launch jurisdiction, and moderation staffing.
14. Commercial model, final name, development budget, and team.

## Development workflow and documentation

The user requires documentation and planning before code: one implementation task per `DEV-` branch, mandatory independent review, merge requests into `stage`, then a reviewed promotion from `stage` to `PROD`.

The [development-plan folder](pirate-game-plan/README.md) provides the workflow, proposed easy-to-follow project structure, phases, serious testing, optimization standards, release operations, and an individual step-by-step file for DEV-001 through DEV-018. Each task records dependencies, scope, acceptance criteria, verification, and actual implementation/review/release evidence as work occurs.

Task branches use names such as `DEV-007-sailing`. Task PRs squash-merge into stage after required checks and an independent review. Release PRs preserve stage ancestry with a merge commit and deploy the same artifact verified on staging. The future game will use a separate repository; these rules do not replace agent-office's existing documentation PR workflow.

Use KISS and DRY through clear feature boundaries, typed/validated contracts, small composition files, and justified shared code. Avoid speculative abstractions and optimize measured bottlenecks. Planning artifacts do not claim protections, CI, infrastructure, or child-safe launch arrangements already exist.

Immediate architecture and setup are now specified in the [foundation baseline](pirate-game-plan/foundation-spec.md), with adult-session and persistence rules in [contracts/storage](pirate-game-plan/contracts-and-storage.md). DEV-001 has exact setup steps and acceptance criteria. Remaining immediate prerequisites are a named independent reviewer and verified private-repository protection entitlement; no paid plan, host or API is purchased automatically. A later coding instruction is still needed to begin implementation. Naval PvP, raids and towns remain later phases requiring their own approved task breakdowns.

## How to keep this document current

During this chat, incorporate new decisions here instead of creating competing plans. Record changed defaults, remaining alternatives, and their effects on scope, safety, multiplayer, and costs. Keep established direction distinct from proposals.

When implementation is ready, replace open questions with accepted rules and add the selected architecture, data models, event contracts, task dependencies, acceptance criteria, verification, hosting budgets, and rollout plan. Creating this document does not itself approve runtime implementation.

## Decision history

- **2026-10-02:** On the user's instruction to proceed with planning, selected a private separate-project default, pinned a registry-checked toolchain, chose minimal Colyseus packages/PostgreSQL, and specified adult identity, contracts and storage semantics. Expanded DEV-001 into a concrete setup sequence. It is technically specified, with independent-review and repository-protection prerequisites still pending; game code remains unstarted.
- **2026-10-02:** User required a dedicated documentation package before coding, one DEV-prefixed task branch per implementation, mandatory independent review, stage integration and PROD promotion. Added the development-plan folder, proposed architecture, six implementation phases, 18 individual planned task files, verification standards and release/recovery workflow. Infrastructure and runtime implementation remain unstarted.
- **2026-10-02:** User approved drafting the first-expedition specification. Added provisional desktop/third-person/private-crew defaults, a bounded cooperative adventure, starter economy, three encounters, construction transactions, recovery rules, dependency-ordered work packages, and measurable acceptance criteria. Runtime implementation and later competitive mechanics remain unapproved.
- **2026-10-02:** Shifted from a general AI sandbox to a four-friend pirate island and expedition game. Accepted this direction for continued planning. Proposed protected homes, opt-in naval conflict, temporary stolen charts, limited harbor raids, outpost flags, later towns, scripted environmental events, and animated builders.
