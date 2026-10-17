# Economy tuning review — 2026-10-17

The authoritative review table is [tuning.csv](tuning.csv): 523 individually identified rows, exact immutable source links, current expressions and evaluated values, classification, call-path provenance, and one proposed interval per row. This is a source census, **not verification of deployed configuration**. No production environment, account, editor, purchase or deployment was accessed.

## Known-bad calibration first

“Rival cooldown starts at issue” is false. E001 pins the first-settlement clock write; E002 pins the issue-time gate. Its five-minute duration is checked when issuing, against the last settled encounter. Replays do not move the timestamp. The overview's first cell deliberately records the incorrect claim, followed by the correction.

## Scope and interpretation

The inventory covers the requested 3v3 drain, deployment/recharge, command SYNC and stamina, rival cooldown/rewards, zone energy/kits/extraction, plus the related host policy tables for arena entry/rewards, packs and rarity, marketplace, healing/crafting/grants, buddy units, progression/XP, training/quests, move upgrades, minting and boosters. Numeric nested table entries are separate rows; shared prices are recorded once at their policy definition rather than duplicated for every listing. Validation/retention bounds and historical baselines remain visible with separate classifications. This does not claim to inventory every numeric literal in the entire repository.

`HOST_MAIN_PATH` means the source module has a static import path from the exported functions entry point. It does not prove every symbol is active in every mode, or that this revision/configuration is deployed. `HOST_LEGACY_WIRE_BASELINE` distinguishes older ladder baselines from v3 tier stats. `HOST_SERVED_PRESENTATION` is the optional practice command profile, not authority over combat outcomes. `GATED_PROPOSAL` is expedition configuration requiring explicit environment selection; absence disables availability. `FLAG_OFF_DEFAULT` records source defaults with no assertion about production overrides. `CLIENT_PRESENTATION_DEFAULT` is Unity source/resource data, not host policy. Gate/validation/grant rows retain their narrower labels.

Every row has one review interval. Equal endpoints mean **hold the current value**, not a recommendation to retune it. Wider intervals are proposals for Pak's review, not approved settings or an applied preset. Related derived intervals (pool, recharge rate and recharge duration) must not be independently combined: choose a coherent pair and derive the third. Table expressions retain source units; millisecond cooldowns are not seconds.

## Priority review

- E003–E006: 1 / 1.25 / 1.5 fielded drain and 90 / 6 = 15-second recharge are Unity presentation defaults. Battle-area drain also multiplies the pool, so 90 is not a guaranteed combat duration.
- Optional host practice profile: strike/combo SYNC 10/14, blocked multiplier 0.5, guard 6; proposed 8–12 / 12–16 / 0.4–0.6 / 5–7. Settlement authority is unchanged.
- Rival rewards 100/25; proposed 80–120 / 20–30. Rival cooldown 300000 ms; proposed 240000–360000 ms. Zone cooldown 180000 ms; proposed 120000–240000 ms.
- Healing prices 100/250/600; proposed 80–120 / 200–300 / 500–700. Heal fractions 25%/50%/100% and crafting fragment counts 3/5 remain fixed holds. Workshop free full heal and open-run refusals remain unchanged.
- Gated expedition defaults: sector/fight energy 5/10 (proposed 4–6 / 8–12), capacity 100 (80–120), energy pack 50 at 100 (40–60 at 80–120), extraction charge 100 (80–120). Band thresholds 1/11/21, UTC rollover, protected slot and channel rules remain holds. Defaults are not asserted live.

## Evidence and validation

Pinned host main: `f50d0285057617d8dab3b53badfb5075bf0d7a7c`.
Pinned Unity main: `694b75b8f94f39f148ee449140f5b6dc5b28dbe6`.
[sources.json](sources.json) contains SHA-256 and line counts for all 24 referenced files. [validation.json](validation.json) records 523 unique row IDs, 523 exact source-line matches at their pinned commits, and 523 populated single intervals. Consumer paths are static provenance, not runtime traces. No executable files changed; no emulator or native tests were needed for this documentation-only change.

Vault overview: `/Users/pak/HolobotsVault/QA/2026-10-17-economy-tuning-sheet-1/GATE_SHEET.png` (1600 × 1100). Every cell is inventoried in adjacent `inventory.json`; the CSV remains the readable full census. The sheet summarizes source analysis and is not a gameplay screenshot.

All existing holds remain: no authority fixes, resolver flip, economy application, deployment or new editor validation. Production configuration and gameplay balance measurements remain unverified.

## Row classifications

- `CLIENT_PRESENTATION_DEFAULT; not host authority`: 9 rows.
- `FLAG_OFF_DEFAULT; HOLOZONE_BEAST_STATS_ENABLED=false`: 14 rows.
- `GATED_PROPOSAL`: 1 rows.
- `GATED_PROPOSAL; HOLOCITY_ZONE_EXPEDITION_CONFIG unset disables`: 19 rows.
- `HOST_LEGACY_WIRE_BASELINE; v3 uses rivalTierStats`: 57 rows.
- `HOST_MAIN_ADMISSION`: 1 rows.
- `HOST_MAIN_GATE`: 2 rows.
- `HOST_MAIN_GRANT`: 3 rows.
- `HOST_MAIN_PATH; deployment unverified`: 378 rows.
- `HOST_MAIN_REWARD`: 1 rows.
- `HOST_SERVED_PRESENTATION`: 2 rows.
- `HOST_SERVED_PRESENTATION; not settlement authority`: 25 rows.
- `HOST_VALIDATION_OR_RETENTION_BOUND; hold, not pacing knob`: 10 rows.
- `SERVER_FLAG; deployed env unverified`: 1 rows.
