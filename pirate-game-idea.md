# Pirate game idea — living concept and implementation plan

Last updated: 2026-10-02 (Europe/Vilnius).

Status: concept direction accepted; mechanics below are proposed defaults unless marked as decided. This document will evolve during the conversation into a concrete implementation plan. It does not authorize starting game implementation or changing agent-office's runtime.

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

Proposed technical direction, pending prototyping: TypeScript browser client with Three.js, authoritative room servers, durable account and ownership storage, and world snapshots plus operation history. Evaluate room frameworks such as Colyseus before choosing infrastructure.

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

- Choose launch audience, devices, geography, account model, provider, and repository.
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

## Open decisions for the next conversations

1. Exact age range and whether PvP is restricted to an older or separate mode.
2. First supported devices: desktop only, tablets, or both.
3. View and controls: first person, third person, or switchable.
4. Art direction and how much terrain is editable.
5. Shared crew home versus separate connected personal islands.
6. Initial hull, sailing complexity, and boat component catalog.
7. What food and survival contribute without repetitive chores.
8. AI allowances, resource costs, refunds, and progression unlocks.
9. Expedition duration and how long travel should take.
10. PvP eligibility, matchmaking, chart drop conditions, and maximum losses.
11. Raid availability, combat logout rules, and harbor session persistence.
12. Town ownership, seasons, abandonment, and cancellation policies.
13. Child-data provider arrangement, launch jurisdiction, and moderation staffing.
14. Commercial model, final name, development budget, and team.

## How to keep this document current

During this chat, incorporate new decisions here instead of creating competing plans. Record changed defaults, remaining alternatives, and their effects on scope, safety, multiplayer, and costs. Keep established direction distinct from proposals.

When implementation is ready, replace open questions with accepted rules and add the selected architecture, data models, event contracts, task dependencies, acceptance criteria, verification, hosting budgets, and rollout plan. Creating this document does not itself approve runtime implementation.

## Decision history

- **2026-10-02:** Shifted from a general AI sandbox to a four-friend pirate island and expedition game. Accepted this direction for continued planning. Proposed protected homes, opt-in naval conflict, temporary stolen charts, limited harbor raids, outpost flags, later towns, scripted environmental events, and animated builders.
