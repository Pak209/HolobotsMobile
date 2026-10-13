# Step 5 — Workshop crafting
Known-bad.log first: callable absent on baseline. Candidate emulator.log 2/2 passes complete recipes, concurrent replay, insufficient fragments/lower stock, malformed stock, spoofed recipe and receipt collision. build.log: shared mirrors and TypeScript pass.

Host fixes 3 blueprint_fragment + 1 Patch -> 1 Kit, 5 fragments + 1 Kit -> 1 Full. No Holos cost. Lower stock, fragments, output and receipt are atomic. Full never drops; crafting is the explicit approved exception to vendor-only sourcing. Requests accept only output itemId and requestId, not amounts/recipes. Default-denied top-level workshopCrafts receipts cannot be written by clients.

Depends on PR #71 stock helper; target main, merge #71 first. No deploy, Pak account or production call; city 40% issue unchanged. Workshop location is a presentation context, not a server-verified proximity rule. This adds no movement/simulation authority claim.
