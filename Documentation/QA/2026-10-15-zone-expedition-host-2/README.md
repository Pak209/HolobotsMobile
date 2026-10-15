# Zone expedition tuning — W17

Proposed review defaults, kept as data in `functions/src/config/zoneExpedition.ts`. No deploy, production account, editor or guardian/cosmetic work. Production activation remains held.

## Tuning table

| Setting | Proposed default | Status/basis |
|---|---:|---|
| Energy capacity | 100 | Proposed |
| Initial energy | 0 | Existing W13 no-free-grant rule |
| Energy per sector crossing | 5 | Proposed; retreat remains possible at zero |
| Energy per fight | 10 | Proposed; entered fights still finish at zero |
| Vendor energy refill | 50 energy for 100 Holos | Proposed; caps at capacity |
| Extraction charge | 100 Holos | Proposed; one carried maximum |
| Band levels | 1 / 11 / 21 | Requested fixed danger, no player scaling |
| Ordinary cache fragment stack | 1 | Proposed; existing Workshop stock |
| Rare discovery fragment stack | 1 | Same configured cache quantity |
| Bulky salvage stack | 1 | Proposed; no sell/service reward |
| Rare discovery chance | 1000 basis points (10%) | Proposed; private per-run roll |
| Emergency Patch | 100 Holos / 25% max HP | Existing catalog, not repriced |
| Repair Kit | 250 Holos / 50% max HP | Existing catalog; only carried healing item |
| Full Restore | 600 Holos / 100% max HP | Existing catalog, not repriced |
| Extraction channel | 8000 ms | Existing #61 rule |
| Daily layout rollover | 00:00:00 UTC | Existing #61 rule; issued layout stays pinned |
| Protected slot | One existing haul stack | Only protected stack survives wipe |

A direct three-fight route costs 30 energy for six forward crossings plus 30 for fights; returning to the nearest gate costs another 5, so the modeled total is 65. This is arithmetic for review, not measured native pacing or an economy approval. Side routes/retreats add crossings. No timed energy refill, free stock grant or real-time run timer is added.

## Configuration and activation

`loadZoneExpeditionDefaults()` returns an independent copy of `ZONE_EXPEDITION_DEFAULTS`, version `zone-config-proposed-1`. The defaults and nested data tables are frozen. Healing rows derive from `HEALING_ITEMS`, keeping the existing prices/fractions authoritative.

Runtime `configuredExpedition()` still returns null when `HOLOCITY_ZONE_EXPEDITION_CONFIG` is absent, empty, malformed or names an unknown selector. Only a separately authorized server configuration selecting `defaults-v1` loads this proposed table. Existing complete JSON configuration remains supported and validated. No environment value has been written outside the demo test process. Issued runs pin their configuration; later changes never rewrite a run's costs or fixed opponents.

Reviewable JSON equivalent (do not activate without the separate approval):

```json
{
  "version": "zone-config-proposed-1",
  "energyCapacity": 100,
  "energyPackUnits": 50,
  "energyPackPrice": 100,
  "sectorEnergyCost": 5,
  "fightEnergyCost": 10,
  "extractionChargePrice": 100,
  "bandLevels": [1, 11, 21],
  "cacheFragments": 1,
  "bulkySalvageUnits": 1,
  "rareBlueprintChanceBasisPoints": 1000
}
```

`ZONE_EXPEDITION_RULES` also records UTC rollover, 8000-ms extraction, one carried charge, the protected-stack rules and carried-kit-only safe-room healing. These are existing lifecycle rules, not newly configurable loopholes. Banked items/owned Holobots/permanent upgrades never become wipe collateral. Emergency extraction keeps small blueprint haul and abandons bulky salvage even if bulky haul was selected as protected; the protected slot applies to wipe.

## Mid-fight escape: refusal only

The current resolver completes a fight atomically in one host transaction. There is no persisted live `fightOpen` phase, and this PR adds none. The existing conservative unresolved-host-encounter gate remains: in a non-safe sector that the host has not cleared, `emergency_start` returns `encounter_pending` **before** consuming a charge or creating a receipt. An explicit host-resolved win clears that encounter and permits the channel. No live escape simulation, combat timer mapping, guardian behavior or cosmetics are added.

## Verification

Known-bad first: the compiled W13 host returns null for the new `defaults-v1` selector; an assertion requiring defaults fails. New tests require defaults to load and remain disabled without explicit selection.

Initial build/shared green; full unit suite 177 passed / 1 existing optional historical-baseline skip, including eight new tests. New cases cover exact defaults, healing parity, immutable copy behavior, activation failure/selection, JSON overrides, UTC midnight boundary, protected stack behavior, and no charge spend on unresolved-fight refusal. Final integration/rebase and demo evidence will be appended after W16's parent update.

HELD: approval/activation of proposed tuning, deployment, native pacing, live fight/escape lifecycle, and all W13 guardian/cosmetic holds. No production configuration or accounts touched.
