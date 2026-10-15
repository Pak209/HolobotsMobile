# Arena gathering / tournament contract — DECISIONS #59

Host lane `arena-gathering-host-1`. No deploy; Pak merges and separately says deploy. Unity mirrors these additive contracts in its own lane. No prices, rewards, XP curves, city 40% healing, Arena match format or HoloZones unlock implementation changes.

## Account story flags

`users/{uid}.storyFlags`, also returned as `storyFlags` on every `desktop-account-1`, `desktop-account-2`, and `desktop-account-3` reply:

```json
{"arenaGatheringSeen":false,"tournamentsWon":0,"arenaArcBuilt":false,"holoZonesArcBuilt":false}
```

`arenaGatheringSeen`, `arenaArcBuilt`, `holoZonesArcBuilt` are booleans; `tournamentsWon` is an integer 0–3. Missing fields default lazily; desktop reads and gathering calls persist defaults. Invalid stored values fail `unavailable`, never reset progression. `arenaArcBuilt` must agree with `tournamentsWon === 3`. Firestore client creation, nested modification, replacement and deletion are denied; unchanged full-profile merges remain allowed. Deploy rules with/before these functions when Pak authorizes release.

## Gathering

Authenticated callable `arenaGatheringHost`:

```json
{"schemaVersion":"arena-gathering-1"}
```

Reply:

```text
{ schemaVersion: "arena-gathering-1",
  roster: [ { citizenId, pilotName, holobotId, rank: "Rookie", ringColor } × 8 ],
  storyFlags: { arenaGatheringSeen: true, tournamentsWon, arenaArcBuilt, holoZonesArcBuilt } }
```

Exactly 8 distinct citizens from the 15 exact CV1 scene-instance IDs. Names are human-readable forms of the existing citizen labels, not new character lore. A SHA-256 seed derived from schema, authenticated UID and citizen ID provides stable per-account selection/order/bot assignment without client seeds. The 12 lowercase Holobot IDs are frozen for this schema; bot duplicates are allowed. Palette hex RGB strings mirror Unity `SlotAccentPalette`: `#2FE6FF`, `#7CFF4F`, `#B07CFF`, `#FF7A1A`, `#FF3D8B`, `#FFD21A`. Six colours wrap over eight rows; duplicate bots never share a colour. Changing the frozen table/algorithm requires a new roster version or migration. First call sets seen; repeats/concurrent calls return the same roster and do not reset other flags. No economic grants.

Refusals: `unauthenticated`; `invalid_request` (wrong schema, extra fields, malformed input); `unavailable` (missing/corrupt account).

## Citizen rivals

Use existing `rivalBattleHost`:

```json
{"schemaVersion":"rival-battle-3","operation":"issue","storySchema":"arena-gathering-1","rivalId":"<citizenId from this account's roster>"}
```

Only those 8 citizens qualify, after gathering. Reply remains `rival-battle-3`; `encounter.opponentPilot` is `{pilotId: citizenId, displayName: pilotName, tier: "Rookie"}`, and `opponentSquad` contains the assigned Holobot. Existing tier-scaled stats, command rules and player snapshots are retained. Roster rank is the requested Rookie presentation label; existing rival difficulty progression is unchanged. Ring colour is read from the gathering roster by citizen ID.

Settle with the normal existing rival request (do not repeat `storySchema`/`rivalId` on status/settle). Existing refusal/replay semantics apply. Per-citizen cooldown is **300,000 ms / 5 minutes** after first settlement; a duplicate settlement does not move it. Existing **100 Holos win / 25 loss**, anti-farm minimum **20,000 ms**, daily Buddy Unit and Holobot XP rules are unchanged; no new economy numbers. Non-roster/before-gathering citizen selection, wrong wire version, or bad gathering operation returns `invalid_request`. Existing `rival_cooldown` includes `retryAfterMs`.

## Tournament admission and result

Tournament IDs in required sequence: `starter`, `champion`, `rare`. Thresholds **2 / 11 / 21** come from `HOLOBOT_RANK_TIERS` in `progression.ts`. Interpretation: participating Holobot's numeric level at match admission, not the unrelated account `syncRank` or a client-supplied rank. There is no numeric Pilot Rank field in main; this interpretation was surfaced to Pak during the lane.

Issue through existing `arenaMatchHost` schema `arena-match-1`, with an additive optional `tournamentId`:

```json
{"schemaVersion":"arena-match-1","operation":"issue","requestId":"unique_request_123","tierId":"rookie","paymentMethod":"pass","holobotId":"ace","opponentName":"HARE","tournamentId":"starter"}
```

Existing paid admission/tier rules apply; this lane adds no tournament fee or tier remapping. Server checks the next tournament and admission level before debit, stores `match.tournament = {schemaVersion:"arena-tournament-1", tournamentId, requiredLevel}`, and includes the tag in the request replay identity. Existing `start`/`settle` flow is unchanged. Ordinary practice matches remain untagged and do not qualify. Full tournament brackets and 3v3 presentation are outside this flag lane.

After a tagged match settles as a win, call `tournamentResultHost`:

```json
{"schemaVersion":"arena-tournament-1","tournamentId":"starter","matchId":"am_<32 lowercase hex characters>"}
```

Reply:

```text
{ schemaVersion: "arena-tournament-1", tournamentId, matchId,
  storyFlags: { arenaGatheringSeen, tournamentsWon: 1|2|3,
                arenaArcBuilt: tournamentsWon === 3, holoZonesArcBuilt } }
```

The host reads and validates that authenticated account's durable admission and settlement receipt. No request `didWin`, level, UID, win count or gate fields are accepted. It atomically increments the count once in sequence; concurrent duplicates/repeats refuse `already_won` without writes. Third win flips only `arenaArcBuilt`. `holoZonesArcBuilt` remains false for this arc; a TODO reserves its future setter, and any value owned by a later lane is preserved. Result processing grants no extra rewards or XP.

Refusals: `unauthenticated`, `invalid_request`, `unavailable`, `unknown_match` (including foreign ownership), `invalid_match` (untagged/wrong tournament), `win_required` (not a settled win), `rank_too_low`, `tournament_locked` (out of order), `already_won`. Callable details carry `{rejectionCode}`. `invalid_request` maps to `invalid-argument`, `unknown_match` to `not-found`, `unavailable` to `unavailable`, remaining tournament refusals to `failed-precondition`. Admission retains existing Arena refusals plus rank/order/repeat checks.

## Trust boundary and rollback

No new client outcome authority: requires the existing host receipt and cannot mint credit from arbitrary IDs. The existing Arena host still settles client-observed CPU combat, and owned Holobot fields retain the legacy owner-writable progression boundary. This lane does not claim anti-cheat proof or a new server combat simulation. Rollback can remove endpoint exposure while leaving account flags/data and their rules protection intact; do not erase progress or unfreeze story flags as part of rollback.
