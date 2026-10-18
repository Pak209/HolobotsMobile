# Lite PvP fighters — host-snapshot level badges

Client half of lane `lite-pvp-fighters-1`. Base: mobile-holocity-lite c187921 (after #131/#132/#133).

The host half is the Contract-Change PR into main, [#136](https://github.com/Pak209/HolobotsMobile/pull/136) (`claude/lite-pvp-fighters-1-host`, 4c2d5d4). It adds callable `pvpRoomFighterHost` and is not deployed. Snapshots live in the **server-only** `pvpRoomSeats/{roomId}` doc: there is no client rule, so the default deny applies. Both seats reach clients only in the callable's replies. **No `firestore.rules` change.** Full contract: that PR's `Documentation/QA/2026-10-17-lite-pvp-fighters-1/CONTRACT.md`.

This closes the LIVE PVP cell held by lite-arena-levels-1 (#119/#121): PvP cards now badge their level **only** from host replies.

## What changed

- **Host calls.** `lib/pvpRoomFightersClient.ts`:
  - `seatHostFighters` sends `{operation:"seat", roomId, holobotId}` for each distinct lineup bot, one at a time.
  - `readHostFighters` sends `{operation:"read", roomId}`.
  - Neither sends a level, uid, role or tier, and neither throws.
  - A missing callable (`functions/not-found` without `details.rejectionCode`) becomes `not_deployed`. Host refusals (with a `rejectionCode`, including `unknown_room`) become `refused`. Outages become `offline`.
  - A reply that arrives after a session change is dropped.
- **Seat refusals.** A refusal of one lineup bot (e.g. a stored level above 99) does not stop the rest. `"ready"` means the City answered every call; only a missing callable, an outage or a session change is `"unavailable"`.
- **Hook.** `hooks/useRealtimeArena.ts`:
  - After each seat write (createRoom, joinRoom, matchmaking `created`, joinRoomById), it seats my lineup fire-and-forget and folds the replies into `hostView`.
  - The opponent's snapshot exists only once they have seated, so it re-reads at most 4 times (1.5 / 3 / 6 / 12 s). It stops at once if the host refuses, is offline or is missing.
  - Attempts are counted per (room, opponent uid, opponent bot). Stamina and heartbeat writes do not reset the timer, and a 3v3 switch back to a bot keeps its spent budget.
  - **The room never waits on or fails because of the host.**
- **Reader.** `lib/bots/pvpFighterLevel.ts`:
  - `mergePvpHostReply` folds only pvp-room-fighters-1 seat/read replies for this exact room.
  - `pvpFighterLevel(view, room, role, name)` requires:
    - the same room id;
    - the view's seat uid equals the uid now in that room seat;
    - an own-property key for the displayed bot;
    - an exact four-field `{holobotId, level, displayName, tier}` snapshot;
    - an integer tier 0–1000000 and an integer level 1–99.
  - `players.*.level` (client-authored), the local profile and any field on the room doc are never sources.
  - `pvpSeatBadge` prints `LV n` from the host, `LV …` while pending (my call out, or opponent reads left), and `LV —` otherwise. There is no local-level fallback.
- **DECISIONS #71.**
  - On screen the authority is "the City", never "host". This covers the lobby line ("The City sets your level in the room"), the badge screen-reader labels and the QA captions, all marked PLACEHOLDER until Lex.
  - The LV badge is a tab on the lower-left corner of each seat card's portrait.
- **UI.**
  - `components/arena/PvpSeatBadges.tsx` (new) shows YOU and RIVAL seat cards.
  - `PvpArenaModal.tsx` uses it in the room panel and under the live-battle top bar.
  - The lobby card's local `Lv ${selectedHolobot.level}` is **removed**; it now reads "Level is set by the host in the room".
  - `BattleArenaView.tsx` is untouched. Its HUD `HostLevelBadge` gets no PvP host props, so it stays blank in PvP.
- **QA.** Offline routes `PvpFightersKnownBad` → `PvpFightersPending` → `PvpFightersCity` (`qa/PvpFightersPreview.tsx`, `qa/pvpFightersFixtures.ts`). They are registered with a one-line spread in `HoloCityPreview.tsx`, after the Marketplace routes. They use recorded host replies only and make no host call.
- **Fixture.** `qa/fixtures/pvp-room-fighters-1.json` is **copied verbatim** from host commit 4c2d5d4, `functions/scripts/fixtures/pvp-room/room-fighters-1.json`. That file was recorded from a loopback demo emulator run of the real host. Pins:
  - sha256 `27f2c55082ffcbf31b0efb899671bdac160cd3c20c6e2c288ce471080cfa673c` (asserted by a test)
  - git blob `64463b19e97ab2dcd9144e9b399e5d446f4954a0`
- `types/battle-room.ts` is unchanged: the room doc carries nothing new, and `BATTLE_ROOM_RULES_VERSION` stays 3.

Untouched on purpose:

- `BattleArenaView.tsx`.
- `ArenaScreen.tsx`, `arenaMatchFlow.ts`, `arenaMatchClient.ts` and the other files of open #139 (lite-3v3-prep-1).
- `pvpMatchmaking.ts`, `pvpBattle.ts`.
- `firestore.rules`.

## Trust boundary

- **Unforgeable at the room level.** Snapshots are host-minted and stored where no client can read or write them. No seat can put a level on the other's badge, or on its own.
- **Still client-authored, out of scope.** The `battle_rooms` doc itself: `players.*` combat docs, levels and stats (C4/S7).
- **The level source is still owner-writable (S4).** The host mints from `users/{uid}.holobots`, which owners can edit under today's rules. This is the same source the #118 Arena snapshots and the desktop-account-3 badges read.
- **Follow-up:** protect `holobots` and move the attribute spends to a callable. The producer's host-economy-hardening-1 lane is doing the census and phased plan; no rules change yet.

## Checks

- **Known-bad first.**
  - The fixture's client-written room carries local levels ACE 99 / KUMA 50. With no City reply, the reader returns `undefined` and every badge is `LV …` or `LV —`, never a digit.
  - A host-looking field forged onto the room doc is ignored.
  - The source guard (no `.level` and no `Lv ${` in `PvpArenaModal.tsx` / `PvpSeatBadges.tsx`) failed against the original modal before the change.
- New vitest: **62 tests**.
  - `pvpFighterLevel.test.ts` (43): fixture pin, known-bad, accept cases, 33-row refusal table, merge rules, presenter states, bounded re-read pacing, #71 copy and corner tab, source guard.
  - `pvpRoomFightersClient.test.ts` (7): exact seat/read bodies, the **not-deployed path** (resolves, `LV —`, room unaffected), per-bot refusals, refusal-vs-outage table, session drop, empty inputs.
  - `pvpFightersPreviewRoutes.test.ts` (12): routes, deep links, cells, #71 copy.
- Full `npx vitest run`: **78 files passed, 1 skipped; 749 tests passed, 4 skipped, 0 failed** (687 existing + 62 new). `npx tsc --noEmit`: green.
- **Adversarial self-review** (read-only workflow: 4 lens critics plus 6 skeptics). It produced 8 candidate findings.
  - Confirmed: this README was stale, and the opponent re-read budget reset on a 3v3 switch. Both are fixed.
  - Refuted: the own-roster LV in the shared picker, which matches the repo's accepted own-roster pattern (lite-arena-levels-1).
  - Hardened anyway on the host: seat-swap tampering, now that storage is uid-keyed.
  - Not verified, but fixed: per-bot seat refusals.
- These ran in a sparse scratch worktree with symlinked `node_modules`. No installs, no network, no real account.

## Simulator witness

**PASSED, one bounded attempt.**

- Simulator: iPhone 17 Pro / iOS 26.5, `70B47994-793B-44B3-BCF6-2CBE9519EF36`, already booted.
- App: the cached `fun.holobots.mobile.w64`, launched once with `simctl launch`. No build, no install, no account.
- Metro: offline from this branch's tree (`node_modules` symlinked from the lite checkout):
  - Command: `CI=1 EXPO_OFFLINE=1 EXPO_PUBLIC_HOLOCITY_PREVIEW=1 EXPO_PUBLIC_HOLOCITY_PREVIEW_SCREEN=PvpFightersKnownBad expo start --offline --port 8081 --clear`.
  - Result: `iOS Bundled 8753ms index.js (1624 modules)`. No redbox.

Cells, known-bad first:

1. `PvpFightersKnownBad`: **LV — / LV —**. The room's local 99 / 50 never shows.
2. `holobotsw64://qa/PvpFightersPending`: **LV 21 / LV …**.
3. `holobotsw64://qa/PvpFightersCity`: **LV 21 / LV 12**.

Every LV tab sits on the portrait's lower-left corner, and on-screen copy says City. Cleanup: app terminated, Metro stopped, port 8081 clear, simulator left booted as found.

Evidence is in `~/HolobotsVault/QA/2026-10-17-lite-pvp-fighters-1/`: GATE_SHEET.png (1356×1025), inventory.json, the three cells and metro.log. This proves the presentation of recorded City replies, not a live two-account room.

## HELD

- **Deploy** of #136's function: the producer's. There are no rules to deploy. Until then, every PvP badge shows `LV …` then `LV —`, and rooms play exactly as before.
- **Live two-account witness** (create → join → both badges from the City): needs the deploy and two real accounts.

## Pak calls (from the host contract)

- `tier` for PvP is the host constant `0`, meaning "unranked room". Confirm this, or name a host-owned tier source.
- Protecting `users/{uid}.holobots` (S4) is a policy decision: the web app's attribute spends need a migration first.
