# Lite PvP fighters — seat-snapshot level badges

Client half of lane `lite-pvp-fighters-1`. Base: mobile-holocity-lite c187921 (after #131/#132/#133).

The host half is the Contract-Change PR into main, [#136](https://github.com/Pak209/HolobotsMobile/pull/136) (`claude/lite-pvp-fighters-1-host`). It adds callable `pvpRoomFighterHost` and is not deployed. Snapshots live in the **server-only** `pvpRoomSeats/{roomId}` doc: there is no client rule, so the default deny applies. Both seats reach clients only in the callable's replies. **No `firestore.rules` change.** Full contract: that PR's `Documentation/QA/2026-10-17-lite-pvp-fighters-1/CONTRACT.md`.

**Scope:**

- **Closed:** room-level forgery. PvP cards badge their level only from the seat snapshot the host minted, never from the client-written room doc or the local profile.
- **Open (S4):** the host mints ownership and level from the owner-writable `users/{uid}.holobots`. So the copy here makes no claim that the City vouches for the level, and the LIVE PvP cell is not fully closed until S4 is.

## What changed

- **Host calls.** `lib/pvpRoomFightersClient.ts`:
  - `seatHostFighters` sends `{operation:"seat", roomId, holobotId}` for each distinct lineup bot, one at a time.
  - `readHostFighters` sends `{operation:"read", roomId}`.
  - Neither sends a level, uid, role or tier, and neither throws.
  - A missing callable (`functions/not-found` without `details.rejectionCode`) becomes `not_deployed`. Host refusals (with a `rejectionCode`) become `refused`. Outages become `offline`.
  - A refusal of one lineup bot does not stop the rest.
  - A reply that arrives after a session change is dropped.
- **State.** `lib/pvpHostSeatState.ts` is a pure reducer used by the hook:
  - Late answers for a room I left are dropped.
  - Replies are never folded after a session change, even ones received before it.
  - Opponent re-reads are counted per (room, opponent uid, opponent bot): at most 4 (1.5/3/6/12 s), kept across 3v3 switches.
  - Any refused, offline or missing-host read stops ALL opponent reads for the room. A read names only the room, so a 3v3 rotation would get the same answer.
  - `pvpSeatHolobotNames` builds `joinRoomById`'s seat names and never throws on a malformed room.
- **Hook.** `hooks/useRealtimeArena.ts`:
  - After each seat write (createRoom, joinRoom, matchmaking `created`, joinRoomById), it seats my lineup fire-and-forget.
  - The read timer is keyed on stable values only, so stamina and heartbeat writes do not reset it.
  - **The room never waits on or fails because of the host.**
- **Reader.** `lib/bots/pvpFighterLevel.ts`:
  - `mergePvpHostReply` folds only pvp-room-fighters-1 seat/read replies for this exact room.
  - `pvpFighterLevel(view, room, role, name)` requires:
    - the same room id;
    - the view's seat uid equals the uid now in that room seat;
    - an own-property key for the displayed bot;
    - an exact four-field snapshot;
    - an integer tier 0–1000000 and an integer level 1–99.
  - `players.*.level`, the local profile and any field on the room doc are never sources.
- **Badge.** `pvpSeatBadge` prints `LV n` (screen reader: "Level n") or `LV …` ("Level pending") while a snapshot may still land. Otherwise it renders **no tab at all**: never a bare `—` (lite critic L22, the rule #142 applies to Home). The copy is neutral, with no "host" (DECISIONS #71) and no "from the City" claim (S4). It is PLACEHOLDER until Lex.
- **UI.**
  - `components/arena/PvpSeatBadges.tsx` shows YOU and RIVAL seat cards. Each has a portrait with the LV tab in its lower-left corner (DECISIONS #71 item 10).
  - `PvpArenaModal.tsx` uses the cards in the room panel and under the live-battle top bar.
  - The lobby card's local `Lv ${selectedHolobot.level}` is **removed**; it now reads just "Tap to change Holobot".
  - `BattleArenaView.tsx` is untouched.
- **QA.** Offline routes `PvpFightersKnownBad` → `PvpFightersPending` → `PvpFightersSeated` (`qa/PvpFightersPreview.tsx`, `qa/pvpFightersFixtures.ts`), registered with a one-line spread in `HoloCityPreview.tsx`. They use recorded replies only and make no network call.
- **Fixture.** `qa/fixtures/pvp-room-fighters-1.json` is **copied verbatim** from host commit 4c2d5d4. Host 3f56a22 left it byte-identical. Pins:
  - sha256 `27f2c55082ffcbf31b0efb899671bdac160cd3c20c6e2c288ce471080cfa673c` (asserted by a test)
  - git blob `64463b19e97ab2dcd9144e9b399e5d446f4954a0`
- `types/battle-room.ts` is unchanged, and `BATTLE_ROOM_RULES_VERSION` stays 3.

## Trust boundary

- **Clients cannot forge the stored seat itself.** It is minted by the host into a doc no client can read or write.
- **Not authoritative yet.** Ownership AND level come from the owner-writable profile (S4). An owner can add a bot or raise a level and the host will mint it.
- **Gate (producer decision, pending Pak's override):** the #136 deploy AND any City-labelled PvP badge are gated on `holobots` / `inventory` protection from the host-economy-hardening plan (S4 phases 1–5; #143 census).
- **Until the gate clears:** badges stay neutral ("LV n", no City claim), and no tab is shown when absent. **The City label returns once S4 closes.**
- The `battle_rooms` doc itself stays client-authored (C4/S7).

## Checks

- **Known-bad first.**
  - The fixture's client-written room carries local levels ACE 99 / KUMA 50. With no seat reply, the reader returns `undefined` and the card shows no tab.
  - A host-looking field forged onto the room doc is ignored.
  - The source guard (no `.level` and no `Lv ${` in the modal or the seat cards) failed against the original modal before the change.
- New vitest: **72 tests**.
  - `pvpFighterLevel.test.ts` (44): fixture pin, known-bad, accept cases, 33-row refusal table, merge, presenter (no tab when absent), pacing, a player-visible-string scan with a control showing it is not vacuous, no bare dash, corner tab, source guard.
  - `pvpHostSeatState.test.ts` (8): at most 4 reads per (room, uid, bot), a 3v3 switch back keeps the budget, stop on the snapshot, no reads after refused/offline/missing host, late answers dropped, session change never folded, refused bot still counts as answered, never-throw names.
  - `pvpRoomFightersClient.test.ts` (7): exact bodies, the not-deployed path (resolves, no tab, room unaffected), per-bot refusals, refusal-vs-outage table, session drop, empty inputs.
  - `pvpFightersPreviewRoutes.test.ts` (13).
- Full `npx vitest run`: **79 files passed, 1 skipped; 759 tests passed, 4 skipped, 0 failed** (687 existing + 72 new). `npx tsc --noEmit`: green.
- These ran in a sparse scratch worktree with symlinked `node_modules`. No installs, no network, no real account, and no fetch into `origin/*`. Tips were checked with `gh api`.
- **Reviews.**
  - Round 1, a read-only critic workflow: the README was stale and the read budget reset per switch. Both fixed.
  - Round 2, the coordinator: copy overclaim, the `LV —` absent state, the untested hook loop, and three LOWs. All fixed here.
  - Round 2, a read-only critic workflow (4 critics plus 6 skeptics). It confirmed three LOWs, all fixed: reads now stop per room, not per bot; the room-guard test is now non-vacuous; the string scan covers JSX text next to `{…}` and any "City" mention.

## Simulator witness

**PASSED at 0ef7903, one bounded attempt (this lane's only one).** iPhone 17 Pro / iOS 26.5, the cached `fun.holobots.mobile.w64` app, offline Metro (`iOS Bundled 8753ms`, no redbox). Cells, known-bad first: LV — / LV —, then LV 21 / LV …, then LV 21 / LV 12. Each tab sat on the portrait's lower-left corner. Evidence: `~/HolobotsVault/QA/2026-10-17-lite-pvp-fighters-1/GATE_SHEET.png`.

**Changed since, and covered by tests only.** No second witness was run, per the one-per-lane rule:

- The known-bad cell now shows **no tab** instead of `LV —`.
- The third route is renamed `PvpFightersSeated`.
- The captions and banner are neutral.

## HELD

- **Deploy** of #136's function: the producer's, gated on S4 phases 1–5 (see Trust boundary). There are no rules to deploy. Until then, PvP cards briefly show `LV …`, then no tab, and rooms play exactly as before.
- **Live two-account witness** (create → join → both badges): needs the deploy and two real accounts.

## Merge notes

`HoloCityPreview.tsx` gets one import plus one spread line here. Open #139 and #142 also edit that file. Resolve the conflict by keeping every import and spread, with this lane's first.

## Pak calls (from the host contract)

- PvP `tier` is the host constant `0`, meaning "unranked room". It is pinned in the schema so it cannot be read as the #118 Arena tier 0. Confirm this, or name a host-owned tier source.
- S4: protecting `users/{uid}.holobots` is a policy decision, because the web app's attribute spends need a migration first.
