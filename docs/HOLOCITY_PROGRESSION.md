# HoloCity progression — wire shapes, XP table, deploy notes

Pak, DECISIONS #53 (HolobotsUnity `Documentation/DECISIONS.md`, 2026-10-06): HoloCity
(Unity) mirrors the mobile level progression. **XP, levels, attribute points and boosts are
computed and stored here**; Unity presents them and sends intents. Branch
`claude/holocity-progression`.

| Piece | Where |
|---|---|
| One battle XP table (arena, rival, beast) | `functions/src/lib/battleSettlement.ts` ⇄ `mobile/src/lib/battleSettlement.ts` (**byte-identical**, `npm run check:shared`) |
| Boost math `applyAttributeBoost` | `mobile/src/lib/progression.ts` ⇄ `functions/src/lib/progression.ts` |
| Real battle stats `getPlayerBattleStats` | `functions/src/lib/progressionEconomy.ts` (= stat lines of `mobile/src/config/arenaConfig.ts` `buildPlayerFighter`, no parts) |
| XP award to fielded bots `awardBattleExperienceRaw` | `functions/src/lib/battleProgression.ts` (server-only) |
| `boostHolobotAttribute` callable | `functions/src/progression/boostHolobotAttribute.ts` |
| Rival wire `rival-battle-3` | `functions/src/lib/rivalLadder.ts`, `functions/src/rival/rivalBattleStore.ts` |
| Mobile client | `mobile/src/lib/progressionClient.ts` `boostHolobotAttributeAuthoritative`; `InventoryScreen.handleUpgradeStat` |

## 1. The battle XP table (DECISIONS #53-1)

```
tierMultiplier = 1 + tier × 0.45
base exp       = floor(95 × tierMultiplier)
win            = floor(base exp × (1 + 0.05 × perfectDefenses + 0.1 × combos))   counts clamped 0..25
loss           = floor(base exp × 0.3)                                            no performance bonus
EXP Booster    = × 2 while users/{uid}.expBoosterActiveUntil is in the future
level curve    = nextLevelExp(level) = floor(100 × (level + 1)²); +1 attribute point per level (applyHolobotExperience)
```

`tier` = arena tier index (rookie 0 … legend 3), rival ladder tier (`floor(rivalWins / 10)`,
unbounded), or a HoloZone tier. `kind` never changes the numbers. Arena keeps its holos /
blueprints / sync-point payout; rival and beast grant **EXP only**. The arena numbers are
unchanged (`battleSettlementParity.test.ts` compares a verbatim copy of the pre-extraction
formula on 18,496 inputs, client and server; a one-off control against the real `main` build
matched as well).

Rival battles (no combos / perfect defenses are reported on rival settle, so performance = 1):

| rival tier | win XP | loss XP | with EXP Booster (win / loss) | ladder row | opponent speed / intelligence |
|---|---|---|---|---|---|
| 0 | 95 | 28 | 190 / 56 | rookie L5 ×0.8 | 40 / 32 |
| 1 | 137 | 41 | 274 / 82 | rookie L8 ×0.9 | 45 / 36 |
| 2 | 180 | 54 | 360 / 108 | challenger L11 ×1 | 50 / 40 |
| 3 | 223 | 66 | 446 / 132 | challenger L14 ×1.1 | 55 / 44 |
| 4 | 266 | 79 | 532 / 158 | elite L18 ×1.2 | 60 / 48 |
| 5 | 308 | 92 | 616 / 184 | elite L22 ×1.3 | 65 / 52 |
| 6 | 351 | 105 | 702 / 210 | elite L26 ×1.4 | 70 / 56 |
| 7 | 394 | 118 | 788 / 236 | legend L30 ×1.5 | 75 / 60 |
| 8 | 436 | 130 | 872 / 260 | legend L35 ×1.62 | 81 / 65 |
| 9 | 479 | 143 | 958 / 286 | legend L40 ×1.75 | 88 / 70 |

Every **fielded** Holobot gets the full amount (bench: none). The XP uses the tier the battle was
**issued** at.

## 2. SPECIAL is tied to SYNC (DECISIONS #53-2)

`intelligence` (SPECIAL) = `floor(base.intelligence × 10 × (1 + 0.05 × (level − 1))) + boostedAttributes.special`,
then `× (1 + focus × 0.002)` where `focus` is a SYNC stat (mobile fitness progression,
`upgradeSyncStat`, capped at 50 → ×1.10). **Attribute points cannot buy SPECIAL**: the callable
refuses `attribute: "special"`. (Mobile training courses `special` / `balanced` still add flat
`boostedAttributes.special` — an existing mobile mechanic, not attribute points.)

The other sync multipliers, applied exactly as the arena does: `power` → attack ×(1 + 0.002·power),
`guard` → defense ×(1 + 0.0015·guard), `tempo` → speed ×(1 + 0.002·tempo). Each result is floored;
non-positive results fall back to 150 HP / 50 (arena `clampPositive`). Equipped parts are **not**
included (the arena adds them as flat boosts afterwards; no server mirror of part stats yet).

## 3. `boostHolobotAttribute` callable

Request:

```json
{ "holobotName": "ACE", "attribute": "health", "requestId": "boost_lx2k9a_4f7q1c2d" }
```

- `attribute`: `attack` | `defense` | `speed` | `health` (`special` is accepted only to be refused).
- `requestId`: `^[a-zA-Z0-9_-]{1,128}$`, one per user intent. `holobotName` matched case-insensitively, ≤ 64 chars.
- Auth required. One attribute point → +1 attack / defense / speed, or +10 HP.

Reply (`applied: true`; `holobot` is the stored record after the write, every extra key kept):

```json
{
  "applied": true,
  "holobot": {
    "name": "ACE", "level": 4, "experience": 1700, "nextLevelExp": 2500, "rank": "Starter",
    "attributePoints": 0,
    "boostedAttributes": { "attack": 3, "health": 30 }
  }
}
```

Refusals write nothing and reply `applied: false` with the current holobot and a `reason`:

| reason | when |
|---|---|
| `already_processed` | the `requestId` was already applied (idempotent replay; nothing spent again) |
| `attribute_not_boostable` | `attribute: "special"` (tied to SYNC) |
| `no_attribute_points` | `attributePoints < 1` |

Errors (`HttpsError`, `details.rejectionCode`): `unauthenticated`; `invalid-argument` /
`invalid_request` (malformed request or an attribute outside the five); `failed-precondition` /
`not_owned`; `not-found` / `unavailable` (no profile).

Idempotency ledger: `users/{uid}.attributeBoostRequestIds` keeps the last 20 applied ids
(the `lastArenaBattleId` pattern). Concurrent duplicates spend exactly one point (emulator test).

## 4. `rivalBattleHost` — `rival-battle-3` (additive)

Negotiated like v2: a request carrying `schemaVersion: "rival-battle-3"` gets v3 replies;
`rival-battle-2` / no version get **exactly** the previous shapes (the v3 fields are stripped;
a one-off control against the `main` build matched 432 compared outputs byte-for-byte, JSON key
order included). Rulings are identical in every version.

### issue → adds `playerCombatants[]`, and `speed` / `intelligence` on every opponent

`playerCombatants` = the player's travel squad (slot order, `[]` when empty or unreadable), each
built from the stored Holobot with the real stats (section 2):

```json
{
  "holobotId": "ace", "level": 4,
  "maxHealth": 192, "attack": 96, "defense": 71, "speed": 80, "intelligence": 60,
  "maxStamina": 110, "staminaRegen": 16,
  "deployment": { "deployCost": 14, "drainPerSecond": 1.6, "rechargePerSecond": 4 },
  "moves": [
    { "moveId": "gap_closer", "staminaCost": 22, "damageScale": 1.35, "breakPower": 14, "chargeable": true },
    { "moveId": "break_heavy", "staminaCost": 38, "damageScale": 1.55, "breakPower": 42, "chargeable": true },
    { "moveId": "intercept", "staminaCost": 18, "damageScale": 0.45, "breakPower": 6, "chargeable": false }
  ],
  "experience": 1700, "nextLevelExp": 2500, "attributePoints": 1,
  "boostedAttributes": { "attack": 3, "defense": 0, "speed": 0, "special": 0, "health": 20 },
  "rank": "Starter"
}
```

(ACE L4, boosts +3 atk / +20 HP, sync power 10 / guard 20 / tempo 5 / focus 30.)
`maxStamina` / `staminaRegen` / `deployment` / `moves` are the `RIVAL_BASELINE` constants so every
required combatant field is present; they are **not** stat-derived — Unity keeps its own player
move kits. Opponents keep the ladder scaling and add `speed` / `intelligence` =
`round(50 / 40 × statScale)` (WOLF's level-1 battle stats; producer default, Pak tunes). The
stored battle record keeps the #43 lineup format and gains `playerSquadIds`.

### settle → accepts `fielded`, adds `progression[]`

Request: `{ "schemaVersion": "rival-battle-3", "operation": "settle", "battleId": "rb_…", "didWin": true, "fielded": ["ace", "kuma"] }`

- `fielded` (optional): 0–3 distinct lowercase Holobot ids that took part. Each must be in the
  travel squad at issue or the current one, else `invalid_request` (nothing written). Absent →
  no XP (the shipped v2 build). Accepted on any version; only v3 replies show `progression`.
- Every fielded bot gets the section-1 EXP (kind `rival`, the issued tier, EXP Booster) via
  `applyHolobotExperience`, **once per battleId** (stored on the settlement; duplicates replay it).
- A loss settled sooner than 20 s (`RIVAL_MIN_XP_MS`) after issue still settles but earns 0 XP
  (closes issue → instant-loss farming; wins are already `too_fast`-gated). Producer default.
- `rivalWins`, tiers, Buddy Units and the daily reward are ruled exactly as before.

Reply addition (values are after the award):

```json
"progression": [
  { "holobotId": "ace",  "expGained": 137, "levelBefore": 4, "levelAfter": 4, "attributePoints": 1, "experience": 1837, "nextLevelExp": 2500, "rank": "Starter" },
  { "holobotId": "kuma", "expGained": 137, "levelBefore": 1, "levelAfter": 2, "attributePoints": 1, "experience": 487,  "nextLevelExp": 900,  "rank": "Starter" }
]
```

`levelAfter > levelBefore` is the level-up cue; `attributePoints` is the bot's new total.

## 5. Beast encounters — math ready, no claim operation exists yet

There is no beast-fight settle path: `wildEncounterHost` is the Holobot capture flow, Unity's
`EncounterResultReporter` only writes a local file, and `claimHoloZoneRun(runId)` is a design sketch
(HolobotsUnity `Documentation/NEON_FOREST.md`, "discussion sketch, not a contract"). A claim keyed by
client-invented run ids would be an XP farm. What is ready: `computeBattleSettlement({kind: "beast", tier})`
and `awardBattleExperienceRaw` (tested with `kind: "beast"`). Needed before wiring: server-issued runs
(an `issue` that stores `runId`, `zoneId`, zone tier, the squad, issue time) and a zone → tier table.

## 6. Deploy notes (Pak)

1. Merge the PR. `cd functions && npm run build` (runs `check:shared`, now 2 byte-identical files).
2. Deploy the changed functions (explicit list — see `functions/README.md`):
   `firebase deploy --project holobots-24046 --only functions:boostHolobotAttribute,functions:rivalBattleHost`
   `boostHolobotAttribute` is new. `settleArenaBattle` / `chargeArenaEntry` share the refactored
   arena module with identical behaviour; redeploying them is optional.
3. **Order:** deploy the functions before shipping a mobile build with this InventoryScreen
   (it calls the callable; without it a boost fails with "needs a connection").
4. `firestore.rules`: **unchanged** (the callable writes with the Admin SDK). `firestore.indexes.json`:
   unchanged. New field `users/{uid}.attributeBoostRequestIds` (string[] ≤ 20).
5. Known gap: `holobots` stays client-writable under the current rules (on purpose — equips and
   other client writes use it), so a modified client can still write boosts directly. Freezing it
   needs those writes moved server-side first; not in this change.

## 7. Tests

`mobile`: `npm test` — `battleSettlementParity`, `attributeBoostParity`, `playerCombatantParity`
(vs the real `buildPlayerFighter`), `boostHolobotAttributeClient`, plus the existing
`progressionParity`, `progressionServerParity`, `arenaServerParity`, `mintingServerParity`.
`functions`: `npm test` (adds `test-attribute-boost`, `test-rival-progression`,
`test-battle-progression`) and `npm run test:emulator` (adds `test-attribute-boost-emulator`,
`test-rival-progression-emulator`; local demo project only).
