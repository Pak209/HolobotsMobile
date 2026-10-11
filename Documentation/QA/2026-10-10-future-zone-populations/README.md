# Future zone populations — draft only, tuning unstarted

Tide Hollow and Sky Reach are locked names in the mock dashboard. Neither has an approved population or playable scene. What it means for Pak: this draft lists the missing calls without enabling either zone or inventing rewards.

| Row | Source | Missing before activation |
|---|---|---|
| Tide Hollow | locked mock dashboard card | tier, beast ids/counts, return rule, boss, scene |
| Sky Reach | locked mock dashboard card | tier, beast ids/counts, return rule, boss, scene |
| Neon Forest | approved existing host table | unchanged |

The playable-first plan only names Neon Forest. The backend tier and population tables contain that one zone. Both future cards have empty scene names; the source explicitly labels its data as mock. There is no authoritative source for the requested extra populations, so every tuning field is null and each row stays unapproved.

Six same-class controls insert plausible copied tuning; the draft checker refuses each. Runtime table hashes stay identical and future zones stay outside the whitelist. This is a documentation draft, not a new payload contract or runtime table.

Recommendation: **LOCKED** until their zone plans are approved. No credentials, emulator, downloads, Unity assets, deployment or new art. Actual population authoring is NOT STARTED because no zone-specific tuning exists.

Locations: `Documentation/DRAFTS/2026-10-10-future-zone-populations.json`; `python3 Documentation/QA/2026-10-10-future-zone-populations/verify.py`.

## 2026-10-11 producer defaults recorded as inert data (chair lane)

Recorded 2026-10-11 01:55 UTC (`date -u`). The producer lane supplied defaults for the two locked zones. They are now data, so the "tuning unstarted" status above is superseded: the rows carry numbers for Pak to tune. Both zones stay **LOCKED**. Nothing is approved and nothing is served.

| zoneId | tier | beasts (count; return rule) | boss | spawnCount | ceiling |
|---|---|---|---|---|---|
| `tide_hollow` | 1 | `cacheback` 3 (timer 8 s, 14 returns); `nullstalker` 2 (timer 12 s, 6 returns) | `null` (none named) | 5 | 5 + 20 = 25 |
| `sky_reach` | 2 | `nullstalker` 3 (timer 8 s, 12 returns); `wyrm` 2 (timer 15 s, 8 returns) | `null` (none named) | 5 | 5 + 20 = 25 |

The producer ceiling rule is the Neon Forest one (3 + 22): `spawnCount` + Σ timer `maxRespawns` = `MAX_PERFORMANCE_EVENTS` = 25. Beast ids are the four Unity `BeastSnapshot` ids, and `root_nexus` stays the Neon Forest's boss.

The rows live in two places. `functions/src/lib/holoZonePopulationDrafts.ts` holds `HOLOZONE_POPULATION_DRAFTS` (the live table's types) and `draftZonePopulation`, which derives the holozone-run-2 `population` through `populationFromRow`, the live builder extracted from `holoZonePopulation` with no change to its behaviour. The draft JSON is now `draftVersion` 2, with `state: "PRODUCER_DEFAULT"`, `approved: false`, `runtimeEnabled: false`, `maxKillsCredited: 25` and no row-level `respawn` key, because in the run-2 shape the return rule sits on each beast.

Why it stays inert: neither zone is in `HOLOZONE_ZONE_TIERS` or `HOLOZONE_POPULATION_TABLE`, and no runtime module imports the drafts (only the test does). An issue for either zone is still `unknown_zone`, and no reply changes.

How a zone goes live: a separate scoped PR adds its tier row and its population row together, moving the row out of the drafts with Pak's tuning. It needs proof: the coverage test, pinned v1 / v2 replies and the zone's playable scene.

| Gate | Result | Known-bad control |
|---|---|---|
| Shape (`validHoloZonePopulationRow`) | 2/2 rows valid; only Unity beast ids; boss `null` | `"Bad Id"` and count 0 rejected; well-formed `kraken` / `root_nexus` caught by the Unity-id check |
| Ceiling | 2/2 rows 5 + 20 = 25; live Neon Forest 3 + 22 = 25 | `maxRespawns` 15 (26) and 13 (24) fail |
| Inert | no tier or live row; lookups `null`; issue `unknown_zone` (live zone issues with the same inputs); coverage = `[neonforest 0 covered]`; forged / stored draft-zone replies have `population: null` | zone injected into a copied tier table or copied live table is flagged; a copied half flip shows as uncovered |
| Live bytes | v1 4/4 match `test-holozone-population.mjs` (verbatim); v2 4/4 match the 0ef98cc build | `tide_hollow` flipped live in copied tables and 22→21 in a copy both give different v2 bytes; an edited pin is not found |
| JSON ↔ TS | 2/2 zone/tier rows deep-equal | 8 in-memory JSON edits each caught |
| No runtime import (TypeScript import scanner, `functions/src`) | 0 importers among the 80 other files (81 scanned) | 6 import forms injected into `holoZoneWire.ts` text each caught; a comment or string is not flagged |
| Whole test vs broken copies (one-off, scratch) | unbroken copy 7/7 | 8 broken artifacts (draft value, tier row, live row, src import, wire leak, key order, JSON value, v1 pin) each fail the intended test |
| `verify.py` | PASS | 30 draft controls refused (24 PRODUCER_DEFAULT/doc + 6 NEEDS_TUNING); 8 tamper controls; disabling each of 10 rules fires its own control |
| Runtime pins | `holoZoneRuns.ts`, `holoZoneWire.ts`, `holoZoneStore.ts` unchanged; **`holoZonePopulation.ts` re-pinned** (63d45fec… → 8a5b8580…, `populationFromRow` extracted); both table literals keep their 0ef98cc hashes | a changed table with its file hash re-pinned fails the literal pin; an injected tier row fails the file pin |
| Old vs new build (one-off) | 969 population / reply / stored-doc outputs, 0 mismatches (only new export: `populationFromRow`) | baseline with 22→21: 65 mismatches; key order swapped: 64 |
| Build / suite | tsc 0, `check:shared` 3 in sync; `npm test` 131/131 (124 + 7) | — |

No credentials, emulator, deploy, downloads or Unity edits were used. No deploy is needed, since nothing new is served.
