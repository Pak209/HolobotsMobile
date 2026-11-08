# Cup prizes and Workshop part tiers (`cup-prize-1`)

Pak, 2026-11-08: "Prizes + part-tier unlock". Code: `lib/cupRewards.ts` (all constants), `story/tournamentResultStore.ts`
(the grant), `story/tournamentBracketStore.ts` (opt-in reply), `lib/vendors.ts` (catalog),
`economy/purchaseMarketplacePart.ts` (refusal). Tests: `scripts/test-cup-rewards.mjs`,
`scripts/test-cup-prizes-emulator.mjs`. Fixture: `docs/contracts/cup-prize-1.json`.

## PROPOSED numbers (Pak can change them; each is one constant in `lib/cupRewards.ts`)

| Cup | Holos | Blueprints (of the bot that won) | Other | Opens Workshop tier |
|---|---|---|---|---|
| Starter | 500 | 10 | | 750 |
| Champion | 1000 | 15 | | 1500 |
| Rare | 2000 | 20 | 1 Heavy Buddy Unit | none |

Before any cup win the Workshop sells only the 300 tier. A part's tier is its price (`common` 300, `rare` 750, `epic` 1500).

## How it works

- The prize is paid in the transaction that raises `storyFlags.tournamentsWon` (first win of that cup only). A receipt
  goes to `cupPrizes/{uid}` (server-only). If a cup's receipt already exists, for example after an admin flag reset, the
  win still advances the story but pays nothing.
- There is no new story flag. `tournamentsWon` (0..3, cups are won in order) is the unlock, because Unity's bracket reply
  reader rejects unknown `storyFlags` keys.
- Pilots who won cups before this shipped get the part tiers at once (they derive from `tournamentsWon`) but no prize.
- Parts already owned stay owned and equippable, whatever the tier.

## Wire

**`cupPrize` is opt-in.** Unity's `TournamentBracketReplies` rejects unknown root keys, so replies are byte-identical unless
the request asks. Send `prizeSchema:'cup-prize-1'` on `tournamentBracketHost` `advance` / `resume`, or on `tournamentResultHost`.

```jsonc
"cupPrize": { "schemaVersion": "cup-prize-1", "cupId": "starter", "matchId": "am_…", "holobotId": "ace",
  "holos": 500, "blueprints": 10, "heavyBuddyUnits": 0, "unlocksPartPrice": 750, "alreadyPaid": false }
```

`alreadyPaid` is true on a resume or replay of the win. On a resume of a cup won before prizes existed, `cupPrize` is null.

`vendorCatalogHost` `catalog{vendorId:'workshop'}` gains `partTier` (additive; other vendors are unchanged, schema stays `vendor-3`):

```jsonc
"partTier": { "unlockedMaxPrice": 300, "unlockedPrices": [300], "next": { "price": 750, "cupId": "starter", "cupName": "Starter Cup" } }
```

`next` is null when every tier is open. `listings` holds only the open tiers.

`purchaseMarketplacePart` checks the tier before Holos, on the server: a locked part is refused with `failed-precondition`,
`details.rejectionCode: 'part_locked'`, message `Win the Starter Cup to unlock this part.` Nothing is charged.
Malformed `storyFlags` refuses with `unavailable`; the Workshop catalog fails closed the same way.
