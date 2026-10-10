# HoloCity progression — wire shapes, XP table, deploy notes

Pak, DECISIONS #53 (HolobotsUnity `Documentation/DECISIONS.md`, 2026-10-06): HoloCity
(Unity) mirrors the mobile level progression. **XP, levels, attribute points and boosts are
computed and stored here**; Unity presents them and sends intents. Branches
`claude/holocity-progression` (PR #59, merged + deployed) and `claude/holocity-progression-2`
(DECISIONS #53 amendments 1 + 2, 2026-10-06: rival ladder rescale, `holoZoneHost`, `desktop-account-3`).

| Piece | Where |
|---|---|
| One battle XP table (arena, rival, beast) | `functions/src/lib/battleSettlement.ts` ⇄ `mobile/src/lib/battleSettlement.ts` (**byte-identical**, `npm run check:shared`) |
| Boost math `applyAttributeBoost` | `mobile/src/lib/progression.ts` ⇄ `functions/src/lib/progression.ts` |
| Real battle stats `getPlayerBattleStats` | `functions/src/lib/progressionEconomy.ts` (= stat lines of `mobile/src/config/arenaConfig.ts` `buildPlayerFighter`, no parts) |
| XP award to fielded bots `awardBattleExperienceRaw` | `functions/src/lib/battleProgression.ts` (server-only) |
| `boostHolobotAttribute` callable | `functions/src/progression/boostHolobotAttribute.ts` |
| Rival wire `rival-battle-3` | `functions/src/lib/rivalLadder.ts`, `functions/src/rival/rivalBattleStore.ts` |
| Rival ladder rescale (WOLF at level 1 + 4t) | `functions/src/lib/rivalTierStats.ts` ⇄ `mobile/src/lib/rivalTierStats.ts` (**byte-identical**, `check:shared`) |
| Beast runs `holoZoneHost` | `functions/src/lib/holoZoneRuns.ts` (rules + zone → tier table), `functions/src/holozone/` (store + callable) |
| Account snapshot `desktop-account-3` | `functions/src/desktop/desktopAccountReply.ts` (pure builder), `desktopAccountSnapshot.ts` (callable) |
| Display-scale stats `getHolobotDisplayStats` | `mobile/src/lib/progression.ts` ⇄ `functions/src/lib/progression.ts` (moved from `mobile/src/config/holobots.ts`, which re-exports it) |
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
unbounded), or a HoloZone tier (section 5). `kind` never changes the numbers. Arena keeps its holos /
blueprints / sync-point payout; rival and beast grant **EXP only**. The arena numbers are
unchanged (`battleSettlementParity.test.ts` compares a verbatim copy of the pre-extraction
formula on 18,496 inputs, client and server; a one-off control against the real `main` build
matched as well).

Rival battles (no combos / perfect defenses are reported on rival settle, so performance = 1).
Opponents (section 4): **rival-battle-3** = WOLF's battle stats at level `1 + 4t` (HP / ATK / DEF /
SPD / INT); **rival-battle-1 / -2** = the #43 baseline × `statScale` at the table level (HP / ATK / DEF;
no speed / intelligence on the wire):

| rival tier | label | rivals | win XP | loss XP | v3 opponent (each rival) | v1 / v2 opponent (#43) |
|---|---|---|---|---|---|---|
| 0 | rookie | 1 | 95 | 28 | L1 · 175 / 50 / 50 / 50 / 40 | L5 · 228 / 42 / 14 |
| 1 | rookie | 1 | 137 | 41 | L5 · 210 / 60 / 60 / 60 / 48 | L8 · 257 / 47 / 16 |
| 2 | challenger | 2 | 180 | 54 | L9 · 244 / 70 / 70 / 70 / 56 | L11 · 285 / 52 / 18 |
| 3 | challenger | 2 | 223 | 66 | L13 · 280 / 80 / 80 / 80 / 64 | L14 · 314 / 57 / 20 |
| 4 | elite | 3 | 266 | 79 | L17 · 315 / 90 / 90 / 90 / 72 | L18 · 342 / 62 / 22 |
| 5 | elite | 3 | 308 | 92 | L21 · 350 / 100 / 100 / 100 / 80 | L22 · 371 / 68 / 23 |
| 6 | elite | 3 | 351 | 105 | L25 · 385 / 110 / 110 / 110 / 88 | L26 · 399 / 73 / 25 |
| 7 | legend | 3 | 394 | 118 | L29 · 420 / 120 / 120 / 120 / 96 | L30 · 428 / 78 / 27 |
| 8 | legend | 3 | 436 | 130 | L33 · 455 / 130 / 130 / 130 / 104 | L35 · 462 / 84 / 29 |
| 9 | legend | 3 | 479 | 143 | L37 · 489 / 140 / 140 / 140 / 112 | L40 · 499 / 91 / 32 |

EXP Booster doubles both XP columns.

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
order included). Rulings are identical in every version. Since amendment 1 a v3 issue also
fields the **rescaled opponents** (WOLF at level 1 + 4t, end of this section); v1 / v2 keep the #43 ones.

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
move kits. The stored battle record keeps the #43 lineup format and gains `playerSquadIds`.

### The rival ladder rescale (DECISIONS #53 amendment 1, Pak 2026-10-06 ~14:07)

Rivals sit on the same curve as the player's Holobots:

```
level = min(99, 1 + 4 × tier)                                  tier 0 = a fresh L1 WOLF, tier 9 = L37, L99 from tier 25
stats = getHolobotBattleStats("WOLF", level, {})               no boosts, no sync, no parts
opponent.level / maxHealth / attack / defense / speed / intelligence = level / maxHP / attack / defense / speed / intelligence
```

Every rival in a lineup gets the same numbers; `holobotId` stays the drawn roster id (display only).
`maxStamina` / `staminaRegen` / `deployment` / `moves` stay the `RIVAL_BASELINE` constants. The tier
table's **labels, rival counts** and the Buddy Unit tiers are unchanged (#43 / #44); `statScale` and the
table levels **retire** for rival-battle-3. Pure math: the byte-identical pair `lib/rivalTierStats.ts`
(`rivalTierBattleStats(tier)`), parity test `mobile/src/lib/__tests__/rivalLadderScaleParity.test.ts`.

**Served to `rival-battle-3` requests only.** The scale is chosen per request
(`rivalLineupScaleFor(schemaVersion)`): a `rival-battle-2` / `-1` / unversioned issue keeps the #43
baseline × `statScale`, so the shipped Unity build is untouched until it flips to v3. Proof (one-off,
2026-10-06): the branch build vs the `origin/main` build (490ba4b) on 648 issue inputs × status /
issue / settle / duplicate-settle in every version — **181,926 compared outputs, 0 mismatches**
(`JSON.stringify`, key order included); every v3 issue differs from main **only** in the opponents'
six stat fields; known-bad controls (a key-order-only change, a one-value change, the v3 scale fed to a
v2 projection) are all flagged. Settle is unchanged in every version.

The battle record names its scale: `lineupScale: "wolf-level-1-plus-4t"` (rival-battle-3 issue) or
`"baseline-statscale"` (v1 / v2 issue); a record without the field (issued before this change) is the
baseline. The stored lineup keeps the #43 combatant format (no `speed` / `intelligence`; they follow
from the tier and the scale).

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

## 5. `holoZoneHost` — beast runs (DECISIONS #53-1 + amendment 1)

The beast counterpart of `rivalBattleHost`: the server issues the run id, owns the zone tier and the EXP,
and settles **once per run id** for the Holobots the client says it fielded. Auth required.
`schemaVersion: "holozone-run-1"` on every reply (optional on requests; any other value is
`invalid_request`).

### Requests and replies

**status** `{ "schemaVersion": "holozone-run-1", "operation": "status" }` →
`{ "schemaVersion": "holozone-run-1", "run": <run> | null }` — the open run (issued, unsettled, not
superseded, not past `expiresAtMs`), or `null`.

**issue** `{ "operation": "issue", "zoneId": "neonforest" }` →

```json
{ "schemaVersion": "holozone-run-1", "runId": "0b9f3c1e-1d2a-4c3b-9a8f-1234567890ab", "zoneId": "neonforest", "tier": 0,
  "squad": ["ace", "kuma"], "issuedAtMs": 1791309600000, "expiresAtMs": 1791316800000 }
```

- `runId` = `crypto.randomUUID()` (lowercase v4). `squad` = the travel squad at issue (slot order; `[]`
  when empty). `expiresAtMs` = issue + 2 h (`HOLOZONE_RUN_TTL_MS`).
- `zoneId` (`^[a-z][a-z0-9_]{0,63}$`) must be in the zone → tier table, else `unknown_zone`.
- **At most one open run**: an issue supersedes an open run (it can no longer settle → `run_closed`).
  Settle before leaving a zone.

**settle** `{ "operation": "settle", "runId": "…", "kills": 3, "bossDefeated": false, "fielded": ["ace", "kuma"] }`

- `kills`: integer ≥ 0. `bossDefeated`: boolean. `fielded`: 0–3 distinct ids, **each in the run's
  `squad`** (the squad at issue), else `invalid_request` (nothing written). All three are required.

```json
{
  "schemaVersion": "holozone-run-1", "runId": "0b9f3c1e-…", "alreadyProcessed": false,
  "settlement": {
    "kind": "beast", "zoneId": "neonforest", "tier": 0, "kills": 3, "bossDefeated": false, "fielded": ["ace", "kuma"],
    "didWin": true, "combosCompleted": 3, "perfectDefenses": 0,
    "tableExp": 123, "expPerHolobot": 123, "expWithheld": false, "settledAtMs": 1791309620000
  },
  "progression": [
    { "holobotId": "ace",  "expGained": 123, "levelBefore": 4, "levelAfter": 4, "attributePoints": 1, "experience": 1823, "nextLevelExp": 2500, "rank": "Starter" },
    { "holobotId": "kuma", "expGained": 123, "levelBefore": 1, "levelAfter": 2, "attributePoints": 1, "experience": 473,  "nextLevelExp": 900,  "rank": "Starter" }
  ]
}
```

`progression[]` is the rival-battle-3 row shape (values after the award; `levelAfter > levelBefore` =
level-up cue). `tableExp` = the one table's EXP for the result (before the EXP Booster);
`expPerHolobot` = what each fielded bot received (Booster applied; 0 when withheld or nothing fielded).
A duplicate settle (any body) returns the stored ruling with `alreadyProcessed: true` and writes nothing,
also after expiry.

### Mappings onto the one battle table (Pak's ruling)

```
didWin          = kills >= 1 || bossDefeated
combosCompleted = min(kills, 25)                  (MAX_PERFORMANCE_EVENTS)
perfectDefenses = bossDefeated ? 5 : 0
tier            = the zone's tier at issue
exp             = computeBattleSettlement({kind: "beast", tier, didWin, combosCompleted, perfectDefenses}).exp
```

So `kills = 0 && !bossDefeated` is a **loss** (30 %: 28 EXP at tier 0); tier 0 with 3 kills = 123, a boss
with 0 kills = 118, 25+ kills + boss = 356 (the cap). Every fielded Holobot gets the full amount via
`awardBattleExperienceRaw` (EXP Booster ×2). **EXP only** — no items, Holos, Sync Points or Buddy Units
(Buddy Units / shards stay on their existing paths).

**Anti-farm:** a run settled **< 20 s** after issue (`HOLOZONE_MIN_XP_MS`) settles (no retry) but earns
**0** (`expWithheld: true`, rows `expGained: 0`) — win or loss. Runs are server-issued, one open at a time,
once per id.

### Zone → tier table (server data, `HOLOZONE_ZONE_TIERS` in `lib/holoZoneRuns.ts`)

| zoneId | tier |
|---|---|
| `neonforest` | 0 |

Phase 2 zones are added there (lowercase stable id → tier) when they ship; an unlisted zone cannot be issued.

### Errors (`HttpsError`, `details.rejectionCode`)

| rejectionCode | HttpsError code | when |
|---|---|---|
| `invalid_request` | `invalid-argument` | malformed request; `fielded` not a subset of the run's squad |
| `unknown_zone` | `invalid-argument` | `zoneId` not in the table |
| `unknown_run` | `not-found` | no such run on the caller's doc (incl. another pilot's run id, or one pushed out of the last 10) |
| `run_expired` | `failed-precondition` | unsettled and past `expiresAtMs` |
| `run_closed` | `failed-precondition` | superseded by a later issue |
| `unavailable` | `unavailable` | no profile, malformed stored data or travel squad, a fielded Holobot no longer on the profile |

(`unauthenticated` without auth.)

### Storage

`holoZoneRuns/{uid}` = `{ schemaVersion: "holozone-runs-1", runs: [ … ] }`, the last 10 runs (newest last),
each the run view + `closedAtMs`, `settlement`, `progression`. **Not** a field on `users/{uid}` (as first
sketched): that doc is client-writable outside `protectedFieldsUntouched`, so a forged run there would farm
XP unless the rules changed *and* were deployed. `holoZoneRuns/{uid}` is server-only — denied by the default
rule; an explicit `allow read, write: if false` block was added to `firestore.rules` (the repo convention;
no behaviour change, deploying the rules is optional). `deleteUserData` (account deletion) removes it.
settle writes `users/{uid}.holobots` and the ruling in one transaction.

## 5a. `holoZoneHost` — `holozone-run-2`: the zone population by zone and tier (DECISIONS #54, plan §P1 item 2)

Additive over `holozone-run-1`, negotiated like `rival-battle-3`: a request carrying `schemaVersion: "holozone-run-2"`
gets v2 replies; `holozone-run-1` / no version get **exactly** the deployed v1 shapes (byte-identical, key order
included; one-off control against the `main` build d5ad1de: 476 compared v1 outputs — issue / status / settle /
duplicate-settle replies and the stored docs — **0 mismatches**; a one-value change and a key-order change are both
flagged). Rulings are identical in both versions. The stored record (`holoZoneRuns/{uid}`) never changes: the
population is derived from the run's zone and tier at read time.

**What the host now serves** (`lib/holoZonePopulation.ts`, server data, Pak tunes): the beast roster, how many bodies
each beast fields at zone entry, and the respawn rule — instead of Unity's StreamingAssets sample. Unity places the
bodies and plays the returns; the settle still rules on the counted kills (clamped to 25) and the boss flag.

**issue** (v2) → the v1 reply plus `population`:

```json
{ "schemaVersion": "holozone-run-2", "runId": "0b9f3c1e-…", "zoneId": "neonforest", "tier": 0, "squad": ["ace", "kuma"],
  "issuedAtMs": 1791309600000, "expiresAtMs": 1791316800000,
  "population": {
    "zoneId": "neonforest", "tier": 0,
    "beasts": [ { "beastId": "scrapling", "count": 3, "respawn": { "kind": "timer", "delaySeconds": 8, "maxRespawns": 22 } } ],
    "boss": { "bossId": "root_nexus", "count": 1, "respawn": { "kind": "none" } },
    "spawnCount": 3, "maxKillsCredited": 25 } }
```

**status** (v2) → `{ "schemaVersion": "holozone-run-2", "run": <run> | null, "population": <population> | null }` — the open
run's population, `null` when no run is open. **settle** (v2) → the v1 settle reply under `"holozone-run-2"` (nothing
added).

- `beasts[].beastId` / `boss.bossId`: lowercase stable ids (`^[a-z][a-z0-9_]{0,63}$`) — the ids Unity's
  `BeastSnapshot.beastId` already carries (`scrapling`, `nullstalker`, `cacheback`, `wyrm`); `root_nexus` names the Root
  Nexus. **Beast stats are not served** (health / attack / break threshold stay on Unity's encounter payload until Pak
  schedules them).
- `count`: bodies fielded at zone entry (≥ 1). `respawn`: `{kind: "timer", delaySeconds, maxRespawns}` (seconds after
  a defeat before a body returns; returns in all for the entry over the run, every body together) or `{kind: "none"}`.
- `spawnCount` = Σ `beasts[].count` (the boss not included). `maxKillsCredited` = 25 (`MAX_PERFORMANCE_EVENTS`): the
  settle credits at most that many kills; the roster never promises more.
- A zone in the tier table with no population row for its tier still issues (`population: null`); the unit test pins
  that every listed zone is covered.

**Producer defaults (2026-10-10; Pak tunes):**

| zoneId | tier | beasts | boss |
|---|---|---|---|
| `neonforest` | 0 | `scrapling` × 3, returns 8 s after a defeat, 22 returns in all (3 + 22 = the 25 credited kills) | `root_nexus` × 1, never returns |

Unity's local fallback (HolobotsUnity `4fefbdfc6`, `LocalScraplingPopulation`: one placed body, 8 s, up to 24 returns)
is the same rule on the one body the scene places today; the host population replaces it once Unity flips its request
to `holozone-run-2` and installs bodies for `count`.

## 6. `desktopAccountSnapshot` — `desktop-account-3` (DECISIONS #53 amendments 1 + 2)

Request `{ "schemaVersion": "desktop-account-3" }`. Same top-level shape as v2 (`schemaVersion, uid,
holobots, blueprints, travelSquad, blueprintTiers, buddyUnits{light, medium, heavy}`), but every holobot is:

- **normalised** with the mobile defaults (server `normalizeUserHolobot` + `boostedAttributes: {}`):
  `level` (≥ 1), `experience` (0), `nextLevelExp` (`100 × (level + 1)²`), `attributePoints` (= level when
  missing), `rank` (by level), `boostedAttributes` ({}); every other stored key kept. Entries that are not
  named objects are dropped. A read view: nothing is written back.
- `battleStats: {attack, defense, maxHP, speed, intelligence}` = `getPlayerBattleStats` — the **combat
  scale**: `getHolobotBattleStats` + the sync modifiers (section 2), the same numbers as the rival-battle-3
  `playerCombatants` and `arenaConfig.buildPlayerFighter`; **equipped parts are not included**.
- `displayStats: {attack, defense, hp, speed, special}` = `getHolobotDisplayStats` — the **mobile display
  scale** (TrainingScreen): `floor(base × (1 + 0.05 × (level − 1))) + boost`, no ×10, no sync, no parts; HP is
  the battle formula. The HoloCity STATS page shows these (amendment 2).

```json
{ "name": "ACE", "level": 4, "experience": 1700, "nextLevelExp": 2500, "rank": "Starter", "attributePoints": 1,
  "boostedAttributes": { "attack": 3, "health": 20 }, "syncStats": { "power": 10, "guard": 20, "tempo": 5, "focus": 30, "bond": 0 },
  "battleStats":  { "attack": 96, "defense": 71, "maxHP": 192, "speed": 80, "intelligence": 60 },
  "displayStats": { "attack": 12, "defense": 6, "hp": 192, "special": 5, "speed": 8 } }
```

`getHolobotDisplayStats` moved from `mobile/src/config/holobots.ts` into the progression lib pair
(`config/holobots.ts` re-exports it, so the app and the server share one formula; parity test
`desktopAccountParity.test.ts` pins client = server = the pre-move formula). `desktop-account-1` / `-2` (and
no version) are unchanged: one-off proof against the `origin/main` callable on the emulator, 384 calls (96
profiles × 4 request forms), replies and the post-call user doc byte-identical.

Optional mobile follow-up (not changed here): `HolobotStatsModal.tsx` (lines 140, 160–163) shows the
**unleveled** base + boost via `getHolobotBaseProfile`, so that modal does not scale with level; parity with
TrainingScreen would use `getHolobotDisplayStats`.

## 7. Deploy notes (Pak)

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

**Progression 2 (branch `claude/holocity-progression-2`, DECISIONS #53 amendments 1 + 2):**

1. Merge the PR; `cd functions && npm run build` (`check:shared`: 3 byte-identical files now).
2. `firebase deploy --project holobots-24046 --only functions:rivalBattleHost,functions:holoZoneHost,functions:desktopAccountSnapshot,functions:deleteUserAccountV2`
   — `holoZoneHost` is new; `deleteUserAccountV2` now also deletes `holoZoneRuns/{uid}` (drop it from the list
   and those docs merely survive an account deletion until it is deployed).
3. Order: none required — every change is additive behind a request version or a new callable. Unity flips its
   rival request to `rival-battle-3` (and starts calling `holoZoneHost` / `desktop-account-3`) only after this
   deploy.
4. `firestore.rules`: one explicit deny block for `holoZoneRuns/{uid}/**` (same effect as the default deny;
   deploying the rules is optional). `firestore.indexes.json`: unchanged. No TTL policy (one bounded doc per pilot).

**Zone population (branch `claude/vigilant-maxwell-tfbtqx-zone-population`, DECISIONS #54 plan §P1 item 2):**

1. Merge the PR; `cd functions && npm run build` (`check:shared` unchanged: 3 byte-identical files).
2. `firebase deploy --project holobots-24046 --only functions:holoZoneHost` — no new function, no rules or index change,
   no stored-record change. Additive behind the request version: the shipped Unity build (v1) is untouched until Unity
   flips its request to `holozone-run-2` and reads `population`.

**Zone health (branch `claude/vigilant-maxwell-tfbtqx-current-health`, section 9):** `firebase deploy --project
holobots-24046 --only functions:holoZoneHost` — the same function; behind the `healthSchema` request flag on the zone
requests, which the shipped Unity zone client does not send yet.

## 8. Tests

`mobile`: `npm test` — `battleSettlementParity`, `attributeBoostParity`, `playerCombatantParity`
(vs the real `buildPlayerFighter`), `boostHolobotAttributeClient`, plus the existing
`progressionParity`, `progressionServerParity`, `arenaServerParity`, `mintingServerParity`.
`functions`: `npm test` (adds `test-attribute-boost`, `test-rival-progression`,
`test-battle-progression`) and `npm run test:emulator` (adds `test-attribute-boost-emulator`,
`test-rival-progression-emulator`; local demo project only).

Progression 2 adds: `mobile` `rivalLadderScaleParity`, `desktopAccountParity`; `functions` `test-holozone-runs`,
`test-desktop-account` (+ the rescale case in `test-rival-progression`); emulator `test-holozone-emulator`,
`test-desktop-account-emulator` (+ `holoZoneRuns/{uid}` in `test-delete-user-data-emulator`); `rules-tests`
`holozone-runs`. Run the emulator suite serially (`node --test --test-concurrency=1 …`): parallel runs hit
emulator transaction-contention flakes in the existing parallel-settle tests.

Zone population adds: `functions` `test-holozone-population` (the table's data rules + coverage, the producer defaults,
v1 byte-identity against pinned strings, v2 shapes, the known-bad rows) and a `holozone-run-2` case in
`test-holozone-emulator` (both versions through the store and the callable; the stored run unchanged).

## 9. Host-owned current health on the zone — `rival-health-1` for `holoZoneHost` (DECISIONS #53 amendment 4, #54 amendment 2)

Pak (2026-10-08): each Holobot carries its host-confirmed remaining health across battles and zone returns; at zero it
needs host-approved recovery. **The rival half is deployed** (2026-10-10, `lib/rivalHealth.ts`, `rival/rivalBattleStore.ts`;
`Documentation/QA/2026-10-10-items-health/`): a `rival-battle-3` request carrying `healthSchema: "rival-health-1"` gets
`currentHealth` on every player combatant on issue, the issue writes the ledger, and `settle{health[]}` writes the
reports; the Emergency Patch (`desktopItemsHost`, `lib/repairItems.ts`) repairs from the same ledger between battles.
This section is the **zone half**: the same flag, the same ledger, the same rules on `holoZoneHost`, so health carries
town → zone → town without a second store.

**The one ledger:** `users/{uid}.holobotVitals = { [holobotId]: { currentHealth, maxHealth } }` — a protected field
(`protectedFieldsUntouched`; never on create), written only by the two hosts' issue / settle and the repair item. Rules
(`lib/rivalHealth.ts`, unchanged by this section): `issueVitals` serves a bot never seen at full health, clamps a stored
value to the combatant's current `maxHealth` (a level-up raises the max and the current carries), and applies the host's
recovery at zero (40 % of max — Pak's amount call pending); `settleVitals` keeps `min(current, reported)` and refuses a
report above what was issued, a bot the issue did not carry, or a non-finite value (`invalid_request`, nothing written).

### issue + flag → `playerCombatants[]` with `currentHealth`

`{ "schemaVersion": "holozone-run-1" | "holozone-run-2", "operation": "issue", "zoneId": "neonforest", "healthSchema": "rival-health-1" }` →
the v1 / v2 reply plus `playerCombatants[]` — the travel squad in slot order, each the rival-battle-3 player shape
(`lib/rivalLadder.ts` `buildPlayerCombatants`: real stats, `commandRules`, progression fields) plus `currentHealth` from
`issueVitals`. The issue **writes the ledger** (`holobotVitals`, exactly what the rival issue writes) and the run record
keeps what it issued (`healthSchema`, `issuedVitals` — the rival record's field names). Without the flag the reply, the
record and the user doc are exactly as before.

```json
{ "schemaVersion": "holozone-run-1", "runId": "0b9f3c1e-…", "zoneId": "neonforest", "tier": 0, "squad": ["ace", "kuma"],
  "issuedAtMs": 1791309580000, "expiresAtMs": 1791316780000,
  "playerCombatants": [ { "holobotId": "ace", "level": 4, "maxHealth": 192, "currentHealth": 30, "attack": 96, "…": "…" }, { "holobotId": "kuma", "level": 1, "maxHealth": 200, "currentHealth": 200, "…": "…" } ] }
```

### settle + flag + `health: [{ holobotId, currentHealth }]` → written with the ruling

`{ "operation": "settle", "runId": "…", "kills": 3, "bossDefeated": false, "fielded": ["ace", "kuma"], "healthSchema": "rival-health-1", "health": [ { "holobotId": "ace", "currentHealth": 12 } ] }`

- `health` needs the flag (else `invalid_request`); 0–3 distinct rows, `holobotId` + `currentHealth` only, finite ≥ 0.
- The run must have been issued with the flag (`healthSchema` on the record), each row must name a bot it issued, and
  no row may exceed what it issued — else `invalid_request` and **nothing is written** (XP included).
- `settleVitals` lands in `users/{uid}.holobotVitals` in the same transaction as the XP (`holobots`) and the ruling.
- **Nothing health-related goes on the settle reply or the settlement** (the rival host's rule); a duplicate settle
  replays the ruling and writes nothing. A flagged settle with no `health` rules as before and touches no ledger.
- The repair item already refuses while a zone run is open (`between_battles_only`, `desktopItemsHost`); unchanged.

### Deploy (Pak)

`firebase deploy --project holobots-24046 --only functions:holoZoneHost` — no new function, no rules change (the ledger
field is already protected), no index change, no deletion change (the ledger lives on `users/{uid}`). Everything is
behind the request flag; the shipped Unity zone client sends no flag yet (its files are byte-pinned), so the deployed
behaviour is unchanged until Unity flips.

### Tests

`functions` `test-holozone-health` (requests, the flagged issue = the rival issue's ledger write, the record, clamping and
the 40 % recovery through `issueVitals` itself, settle reports at or below the bound with inflated / foreign /
unflagged-run refusals writing nothing, replays, carry rival → zone → rival through the one ledger, no-flag byte pins);
`test-holozone-health-emulator` (through the store and the callable on the Firestore emulator: the user doc's ledger,
parallel settles, refusals writing nothing, a tampered ledger failing closed, the rival host's values served by the zone
and back, the repair item refused while the run is open).
