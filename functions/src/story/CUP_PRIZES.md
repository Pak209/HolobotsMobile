# Cup prizes and Workshop part tiers (`cup-prize-1`)

Pak, 2026-11-08: "Prizes + part-tier unlock". Code: `lib/cupRewards.ts` (all constants), `story/tournamentResultStore.ts`
(the grant), `story/tournamentBracketStore.ts` (opt-in reply), `lib/vendors.ts` (catalog),
`economy/purchaseMarketplacePart.ts` (refusal). Tests: `scripts/test-cup-rewards.mjs`,
`scripts/test-cup-prizes-emulator.mjs`. Fixture: `docs/contracts/cup-prize-1.json`.

## Numbers (Pak 2026-11-08: "Bigger prizes"; each can still be tuned, each is one constant in `lib/cupRewards.ts`)

| Cup | Holos | Blueprints (of the bot that won) | Other | Opens Workshop tier |
|---|---|---|---|---|
| Starter | 750 | 15 | | 750 |
| Champion | 1500 | 25 | | 1500 |
| Elite (stored id `rare`) | 3000 | 30 | 1 Heavy Buddy Unit | none |
| Legends (**PROPOSED**, dormant) | 6000 | 40 | 2 Heavy Buddy Units | none |

Before any cup win the Workshop sells only the 300 tier. A part's tier is its price (`common` 300, `rare` 750, `epic` 1500).

## Elite Cup and the dormant Legends Cup (Pak, 2026-11-09)

The Rare Cup is now the **Elite Cup**. Only names and copy changed: the stored id stays `rare`, because match records, prize
receipts, `tournamentUnlockAcknowledged` and shipped clients all carry it.

**Legends Cup** is the fourth cup. **PROPOSED:** level gate 31 (the start of the next Holobot rank after the Elite Cup's 21) and
the prize row above. Legendary parts need it (4 cups won), so while it is dormant no legendary part counts or can be equipped.

It is **dormant** behind `STORY_CUPS.legendsLive` (`story/storyFlags.ts`, a code constant): the id is refused and
`tournamentsWon` stays capped at 3. A value of 4 would break shipped clients, so these must ship first:

- **Lite:** `lib/cityHub.ts` (rejects above 3 and needs `arenaArcBuilt === (won === 3)`; it would reset the pilot to no flags),
  `lib/tournamentFlow.ts` (`TOURNAMENTS`, `whole(tournamentsWon, 0, 3)`), `field/cityData.ts` comment range.
- **Unity:** `ArenaGatheringContract.cs` (won above 3 returns null), `TournamentBracketReplies.cs` (known ids and the flags
  reader), `ArenaMatchClient.cs` (known ids at issue and in replies), `ArenaCopyWiring.cs` (win and unlock lines).

`arenaArcBuilt` stays true from the third cup on (`tournamentsWon >= 3`).

## How it works

- The prize is paid in the transaction that raises `storyFlags.tournamentsWon` (first win of that cup only). A receipt
  goes to `cupPrizes/{uid}` (server-only). If a cup's receipt already exists, for example after an admin flag reset, the
  win still advances the story but pays nothing.
- There is no new story flag. `tournamentsWon` (0..3 today, 0..4 with Legends; cups are won in order) is the unlock, because Unity's bracket reply
  reader rejects unknown `storyFlags` keys.
- Pilots who won cups before this shipped get the part tiers at once (they derive from `tournamentsWon`) but no prize.
- Parts already owned stay owned and equippable, whatever the tier.

## Wire

**`cupPrize` is opt-in.** Unity's `TournamentBracketReplies` rejects unknown root keys, so replies are byte-identical unless
the request asks. Send `prizeSchema:'cup-prize-1'` on `tournamentBracketHost` `advance` / `resume`, or on `tournamentResultHost`.

```jsonc
"cupPrize": { "schemaVersion": "cup-prize-1", "cupId": "starter", "matchId": "am_…", "holobotId": "ace",
  "holos": 750, "blueprints": 15, "heavyBuddyUnits": 0, "unlocksPartPrice": 750, "ride": "skates", "alreadyPaid": false }
```

`ride` is the ride this cup awards: `skates` (Starter), `hoverboard` (Champion), null (Rare). It comes from `CUP_RIDES`, not from
the receipt, so every account gets it, including wins from before rides existed; `ridesUnlocked(tournamentsWon)` gives the full set.
Unity never sees the field: its client sends no `prizeSchema`, so the reply stays byte-identical for it.

`alreadyPaid` is true on a resume or replay of the win. On a resume of a cup won before prizes existed, `cupPrize` is null.

`vendorCatalogHost` `catalog{vendorId:'workshop'}` gains `partTier` (additive; other vendors are unchanged, schema stays `vendor-3`):

```jsonc
"partTier": { "unlockedMaxPrice": 300, "unlockedPrices": [300], "next": { "price": 750, "cupId": "starter", "cupName": "Starter Cup" } }
```

`next` is null when every tier is open. `listings` holds only the open tiers.

`purchaseMarketplacePart` checks the tier before Holos, on the server: a locked part is refused with `failed-precondition`,
`details.rejectionCode: 'part_locked'`, message `Win the Starter Cup to unlock this part.` Nothing is charged.
Malformed `storyFlags` refuses with `unavailable`; the Workshop catalog fails closed the same way.
