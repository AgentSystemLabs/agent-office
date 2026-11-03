@AGENTS.md
# Executive World handoff

Read `EXECUTIVE_WORLD_MIGRATION.md` first for current scope, decisions, tests, and safety limits. The main Agent Office route now registers Executive World as the default map scaffold, while `/executive.html` remains a standalone visual fallback. Both experiences expose First Person, Director Third Person, and Bird’s-eye Overview; the standalone preview preserves its original bird’s-eye campus scene and Town Hall walker. Keep all activity simulated; do not connect live workers, market feeds, external services, or autonomous actions without a separately approved security and execution design.

The standalone camera integration is in `src/client/executive/preview.ts` with pure mode helpers in `src/client/executive/camera-mode.ts`; it reuses the shared collision primitives while keeping the original orthographic overview renderer authoritative.

Standalone First Person also uses the shared `Hands` and `FirstPersonBody` primitives for visible body/hand animation and the integrated look sensitivities; do not remove those layers when changing the Town Hall preview.

Building entry: `src/client/executive/building-entry.ts` owns data-driven doors, interior bounds, spawns, exits, and metadata. `placeholder-interior.ts` supplies reusable district-colored structural interiors; Town Hall remains the finished interior. Keep overview rendering authoritative and label placeholders as unfinished.

Doors: `building-kit.ts` creates one visible front door per building; `building-entry.ts` owns independent closed/open animation state. Preserve door clearance and do not replace the existing entry transition with global collision bypasses.

Town Hall visual language: `building-kit.ts` includes the approved glass-and-metal façade, ceremonial entrance, roof slab, rounded boardroom wings, and upper operations deck. Preserve its existing footprint, entry, and selection behavior when refining the headquarters.

Door thresholds: façade and interior walls must leave an explicit doorway gap, with a closed-door collider inserted separately. Exterior and interior movement may cross only while the active door is opening/open; scene changes are triggered by threshold crossing, not the initial `E` press.

Threshold metadata is authoritative: use `doorwayWidth`, `exteriorThreshold`, `interiorThreshold`, `entryDirection`, and `clearanceRadius` from `BuildingEntryDefinition`; do not reintroduce hard-coded `z` thresholds or compare local interior coordinates to exterior world coordinates.

Town Hall render architecture: `buildCivicCore()` exposes the canonical `townGroup`. Standalone Town Hall first-person renders that same group in world coordinates, hiding only roof/occluding layers and unrelated campus roots while inside, then restoring them on exit. `town-interior.ts` now provides collision/spawn helpers only; its legacy scene factory is empty compatibility code and must not become a second decorative Town Hall model.

Town Hall interior visibility must hide geometry only. Keep global `THREE.Light` objects active while inside. The canonical `front-door` stores shared doorway dimensions in `userData`; validate world scale before changing parent transforms or doorway geometry.

Agent Office integration: `src/shared/executive-floor-map.ts` is the authoritative Executive World → Agent Office location bridge. Null floor IDs are deliberate until a real floor/project is approved and connected; display `Planned / Not Connected` rather than silently failing. `src/client/world/executive/index.ts` annotates campus pickables with these records while using the existing `World` lifecycle. The `src/client/features/executive-campus/` feature owns the selectable district/building boundary and routes only verified connected entries through Agent Office's existing `floor.go` travel flow; it does not create a second movement or camera system.
