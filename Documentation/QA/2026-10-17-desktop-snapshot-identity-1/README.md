# desktop-snapshot-identity-1

Adds `username`, `pilotPortraitId`, `pilotColourwayId`, `syncPoints`, and `zones` to desktop-account-1/2/3. No version bump: additive reply fields follow storyFlags/pilotRank; the existing inventory/combat fields retain their versions and values. Read projection only, no new persistence or economy.

`username` copies a nonblank stored string verbatim, otherwise null (never UID/email fallback). `syncPoints` copies a stored nonnegative safe integer, including 0; absent/malformed values are null, not a fabricated zero. Pilot portrait and colourway IDs are always null: the host has no authoritative ID catalog. Wardrobe preset/colors and profile lookalikes are not usable portrait identifiers. This PR does not deliver usable pilot portrait art.

## Destination contract

Pinned Unity census: db265127c, Dashboard/dashboard-preview.json and Scripts/PortalTravel.cs. Four rows preserve dashboard order: holocity, neonforest, tide_hollow, sky_reach. Card IDs equal those catalog IDs. Names are HoloCity, Neon Forest, Tide Hollow, Sky Reach.

`zoneId` is the stable destination identity; there is no separate stable portal-ID field in PortalTravel. Routing uses sceneName: HoloCity_Main / HoloZone_NeonForest. Future destinations remain NOT YET AVAILABLE / false / null scene; no invented scene or portal IDs. Neon Forest availability comes from the existing HOLOZONE_ZONE_TIERS catalog. HoloCity is the existing town destination. Availability is not permission to issue a run: all host run, KO, energy and cooldown gates still apply, and story flags do not unlock draft zones.

`Schemas/desktop-account-dashboard-fields.json` validates this projection on all three account versions; other inventory/combat fields are outside that schema. Fable owns the Unity DTO/dashboard mirror; no Unity files changed. No deploy, real account access, editor, app/Player build, dependency download or credits.

## Verification

- 5/5 focused units; all versions retain old fields after additive projection removal; invalid/missing SYNC and username, zero, spoofed appearance/catalog fields, source immutability.
- 3/3 real callable emulator tests (demo-desktop-identity, loopback only), including request overrides ignored, stored values preserved and all three versions validated with Ajv. Fixtures are checked against the schema; the before control is rejected. First emulator pass was 4.586 seconds; final schema-inclusive run recorded in the vault. No failed attempts.
- `tsc --noEmit` and `npm run check:shared` green; cached TypeScript transpiles tests in memory, no emitted build.
- Existing KUMA emulator expected-record assertion was missing the already-shipped battlefieldMovement field; it now excludes that additive field alongside battleStats/displayStats when checking the original record. Runtime movement unchanged.

## Evidence inventory

Vault: `/Users/pak/HolobotsVault/QA/2026-10-17-desktop-snapshot-identity-1/`.

`GATE_SHEET.png`: 1440 × 900, three inventoried cells, known-bad first. Cell 1: old reply lacks five dashboard fields (synthetic pre-change projection control, not a production account). Cell 2: new throwaway reply fields and four routing rows. Cell 3: unit/emulator/noEmit/shared results and explicit nullable-art/no-deploy holds. Text-only contract evidence, not an in-engine visual witness.

`known-bad-before.json` and `desktop-account-3.json` are deterministic unit fixtures; emulator tests additionally schema-validate actual callable replies. `unit.log`, `emulator.log`, `inventory.json` preserve measurements. No production account captured.

## Amendment 2026-10-17 — HoloZones story gate (host-economy-hardening-1)

Neon Forest availability now also requires the account's host-owned `storyFlags.holoZonesArcBuilt` (critic review top #1). `desktop-account-3.json`'s pilot has `holoZonesArcBuilt: false`, so its `neonforest` row is now `NOT YET AVAILABLE` / `isOpen: false` / `sceneName: null` (3 lines changed; everything else byte-identical). `desktop-account-3_holozones-arc-built.json` is the same reply with the flag true and the row open (`HoloZone_NeonForest`). Both are checked against the builder (`test-desktop-account.mjs`) and the schema (`test-desktop-account-emulator.mjs`). The Unity mirror `Assets/Holobots/Shared/Editor/Tests/Fixtures/SnapshotIdentity/desktop-account-3.json` needs the matching sync (its zone asserts in `SnapshotIdentityMirrorTests` read the open row; the catalog-route test wants the arc-built fixture).
