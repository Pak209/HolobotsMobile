# Genesis Squad — Starter Bundle, Referrals, and Battle Pass Plan

Status: Phase 1 (referrals + wildcard economy + blueprint cohesion) implemented — see §8. Phases 2–3 remain design.
Scope: the game's first monetization + growth systems, built on the existing
server-authoritative economy (21 callables after Phase 1) and the 3v3
Showdown mode

## 1. The product: Genesis Squad

One bundle, three ways to earn it — identical contents on every path:

> **Genesis Squad**: KUMA and SHADOW, minted at level 1 / Rookie rank,
> joining the ACE every account already starts with. Plus a small
> celebration pack (500 Holos + 50 SP) and a permanent "GENESIS" profile
> badge (cosmetic provenance).

Why the trio beats "1 starter + blueprint tickets":

- **Pay for width, never height.** Base-stat bots grant ACCESS (3v3 mode,
  three ability identities, roster variety); all power still comes from the
  same SP/EXP/blueprint progression as everyone else. Tickets compress the
  grind — that's height, and it starts the pay-to-win slide.
- **3v3 is the motivation.** "Own 3 Holobots" just became the entry ticket
  to the newest mode; the bundle is the obvious on-ramp.
- **Legible value.** A new player understands "two more Holobots"
  instantly; they can't price 40 blueprint tickets.
- KUMA (chain survives blocks) and SHADOW (guard grace) are utility bends,
  not meta-power picks — identity variety without balance pressure.

### The fairness triangle (all three must exist)

| Path | Currency | Status |
|---|---|---|
| **Grind** | time | Already live: blueprints mint KUMA/SHADOW today |
| **Pay** | money | New: one-time IAP, suggested **$4.99** |
| **Social** | friends | New: 3 qualified referrals |

Identical rewards on every path is the fairness invariant. If a player
already owns KUMA or SHADOW when claiming/purchasing, that bot converts to
its blueprint equivalent (20 blueprints per owned bot — §6.3) so no
path ever feels wasted — conversion computed server-side.

## 2. Referral system (the F2P path)

### Flow
1. Every account exposes a referral code (short slug derived from uid) and
   a share sheet ("Fight beside me in Holobots — code KUMA-7F2K").
2. A new player enters the code during onboarding (or within the first 7
   days) → `referredBy` is written once, server-side, immutable after set.
3. **Qualification — the anti-fraud core**: a referral counts only when the
   invited player completes their **first real sync workout** (already
   server-validated by `syncFitnessActivity` / watch pipeline). A physical
   act is expensive to bot, and a friend who worked out once is an
   activated player, not a signup ghost.
4. On the referrer's 3rd qualified referral, the Genesis Squad claim
   unlocks (explicit claim button → server grant).
5. The invited player gets a welcome bonus too (e.g., 200 Holos on
   qualifying) so codes are worth entering.

### Fairness verdict
Not unfair — this is the standard time/money/social triangle, and the
reward carries no stat advantage. The dangers are elsewhere:

| Risk | Mitigation |
|---|---|
| Self-referral farms | Workout qualification (physical act) + one `referredBy` per account, set once, new accounts only |
| Referral spam pressure | Squad needs exactly 3; extra referrals pay a flat +5 wildcards each (no escalating ladder), and each still costs a real workout |
| F2P path feeling worse than $5 | 3 friends is deliberately cheap; grind path also exists |
| Code squatting/typos | Codes are display-only aliases; server resolves to uid |

### Server shape (all new logic server-authoritative)
- `applyReferralCode(code)` — callable; validates: account age < 7 days,
  no existing `referredBy`, code ≠ self, referrer exists. Writes
  `referredBy` + increments referrer's `referrals.pending`.
- Qualification hook in the existing first-workout settlement: flips the
  referred player's flag and increments referrer's `referrals.qualified`
  (transactional, once per referred account).
- `claimGenesisSquad(source: 'referral')` — callable; validates
  `referrals.qualified >= 3` and `!genesisSquadClaimed`; mints KUMA +
  SHADOW (reusing mintHolobot internals / blueprint conversion for owned
  bots), grants the celebration pack, sets `genesisSquadClaimed:
  'referral'`.
- Firestore rules: `referredBy` and `referrals.*` and
  `genesisSquadClaimed` are server-only fields (client write denied) —
  extend `noPrivilegeEscalation`-style guards.

## 3. Genesis Squad IAP (the paid path)

- **Product**: one-time non-consumable `holobots.genesis_squad` at $4.99
  (tier to taste), surfaced in Marketplace as a "STARTER DEAL" card and as
  a contextual offer when a <3-bot player taps 3V3 SHOWDOWN.
- **Stack**: `react-native-iap` (bare workflow fits) → purchase →
  `redeemGenesisSquadPurchase(receipt)` callable → **App Store Server API
  verification server-side** → same grant path as the referral claim
  (`genesisSquadClaimed: 'purchase'`). Never trust the client receipt
  locally.
- Restore purchases handled via the same entitlement flag.
- **Human actions needed (Pak)**: App Store Connect product creation,
  banking/tax agreements, App Store Server API key for the functions
  config, sandbox testers. Apple review notes: pure IAP (no external
  payment links), no gambling mechanics in the bundle itself.

## 4. Battle Pass (season system — the bigger sibling)

Phase this AFTER the bundle ships; it's a system, not a product.

- **Season**: ~6 weeks, defined in a Firestore config doc (versioned like
  the move catalog).
- **Pass XP comes from being active, not paying**: sync workouts (the
  fitness hook — this is the pass that rewards actually working out),
  arena wins (1v1 and 3v3), quest/training claims. Server-side increments
  inside the existing reward callables — no new client-trust surface.
- **Free track**: Holos, SP, boosters, gacha tickets, parts.
- **Premium track** ($6.99/season, IAP): bigger amounts, exclusive
  cosmetic parts, a mid-season Holobot blueprint bundle, season-end
  exclusive badge. **No moves, ranks, or stat items that aren't earnable
  elsewhere** — width-not-height applies to the pass too.
- Claims via one `claimBattlePassReward(seasonId, tierIndex, track)`
  callable with idempotent claim ledger on the profile.

## 5. Delivery phases

| Phase | Scope | Est. | Blockers |
|---|---|---|---|
| **1 — Referrals** | Codes, applyReferralCode, workout qualification hook, claimGenesisSquad, rules guards, invite screen + share sheet, parity tests | 2–3 d | none (pure Firebase) |
| **2 — Starter IAP** | react-native-iap, receipt-verification callable, Marketplace STARTER DEAL card + 3v3 contextual offer, restore flow | 2–3 d | App Store Connect setup (Pak), Apple review |
| **3 — Battle Pass S1** | Season config, XP hooks in existing callables, claim callable, pass screen (free+premium tracks), premium IAP | 4–6 d | reward-ladder design sign-off |

Recommended order: 1 → 2 → 3. Referrals ship value immediately with zero
Apple dependency and start the growth loop while the IAP paperwork clears.

## 6. Decisions (locked 2026-07-10)

1. **Price: $4.99**, with a **$1.99 early-adopter tier for the first 10,000
   users**. Implementation note for Phase 2: two separate App Store products
   (`genesis_squad_499`, `genesis_squad_early_199`) plus a server-side global
   claim counter (`config/genesisEarlyAdopters` doc, transactional increment)
   that decides which product the client shows. Apple does not do dynamic
   pricing; two SKUs is the standard pattern.
2. **Referral count: 3** to claim the squad. **No referral cap** — every
   qualified referral past the third pays +5 Wildcard Blueprints, forever.
   Let them grind.
3. **Owned-bot conversion: 20 blueprints** per already-owned Genesis bot.
4. Battle pass parameters: still open (Phase 3).
5. **GENESIS badge: exclusive forever.**
6. **Wildcards unify the cohesion fixes**: the Referral Welcome bonus,
   Legendary gacha drops, and the weekly marketplace pack all pay
   `wildcardBlueprints` — a balance the player assigns 1:1 to ANY Holobot
   from its stats screen. The "Weekly Featured Blueprint" concept became the
   **Wildcard Blueprints ×5 pack** (300 Holos, one purchase per week).

## 7. Appendix: Blueprint economy review (the grind leg, audited)

### Current shape
| | Cost / Yield |
|---|---|
| Mint a Holobot | **5** blueprints (Common tier, starts Lv 1) |
| Rank ups (Champion→Legendary) | 10 / 20 / 40 / 80 — **155 cumulative** |
| Arena win | 5/10/15/20 by tier, keyed to the DEFEATED opponent |
| Gacha Blueprint Fragment | 1/2/3/5 by rarity, RANDOM Holobot (1-in-12) |
| Marketplace | dead price entry (300 Holos), item never sold |

Verdict: structurally sound. Acquisition (width) is cheap — one Rookie win
mints a bot; a new player is ~3 wins from a 3v3 team — while power (ranks)
is the long grind for everyone. Defeat-to-recruit is a keeper.

### Incoherence found
KUMA and SHADOW sit in the CHALLENGER (tier 2) opponent pool; Rookie farms
HARE/WAKE/GAMA. The grind leg therefore builds a different trio than the
Genesis bundle, and target-farming the actual Genesis bots requires a tier
climb with only ACE. The triangle's "same reward on every path" invariant
breaks quietly.

### Modifications (in priority order)
1. **Genesis rotation in Rookie tier**: weekend/rotating featured slot that
   swaps one Rookie pool opponent for KUMA or SHADOW (config-level change;
   the blueprint target follows the beaten opponent automatically). The
   grind leg can then literally farm the Genesis trio, restoring the
   invariant without touching tier difficulty.
2. **Wildcard fragments (the "blueprint ticket" idea, at the right layer)**:
   legendary-rarity gacha blueprint drops become wildcards the player
   assigns to a bot of choice on claim. Targeting stays scarce (legendary
   only); commons/rares stay random. Kills the worst of the 1-in-12
   lottery without making gacha a mint vending machine.
3. **Referral welcome bonus in blueprints**: the invited player's
   qualifying workout grants +5 blueprints to a bot of their choice —
   seeds their second mint and teaches the loop on day one.
4. **Resolve the dead marketplace entry**: either delete the price path or
   ship a "Featured Blueprint" marketplace item (300 Holos for 5 of a
   weekly-featured bot) as a Holos sink that doubles as targeting. Prefer
   shipping it — the economy wants more Holos sinks.
5. **Duplicate conversion at 20/bot** (not 40): one Rare rank step feels
   like real compensation without dwarfing the 5-cost mint.
6. Already chipped: legacy case-variant blueprint keys (ACE/ace) need the
   one-off data-hygiene migration before any of this launches.

## 8. Phase 1 implementation status (shipped in this PR)

All four §7 modifications plus the referral loop are implemented:

| Piece | Where |
|---|---|
| Wildcard economy fields | `wildcardBlueprints`, `lastWildcardPackAt` on the profile (same raw names both sides); mapped in `mobile/src/lib/profile.ts` |
| Legendary gacha → wildcards | `mobile/src/lib/gacha.ts` + `functions/src/lib/economy.ts` (`WILDCARD ×N · any Holobot` drop text) |
| Weekly Wildcard pack | "Wildcard Blueprints" marketplace item, 300 Holos, 7-day throttle via `lastWildcardPackAt`; cooldown surfaced on the BUY button |
| Rookie Genesis rotation | `getTierOpponentPool` rotates slot 3 through GAMA/KUMA/SHADOW weekly; settlement (client fallback AND server) accepts the union so week boundaries never void a win |
| Referral codes | uid-derived (first 6 chars, uppercased), self-verifying; published lazily to the profile when the Genesis tab opens |
| `applyReferralCode` callable | write-once `referredBy`, accounts < 7 days old only, no self-referral |
| Qualification hook | `syncFitnessActivity`: invitee's FIRST settled workout → invitee gets +5 wildcards +200 Holos; referrer gets qualified+1 (and +5 wildcards per referral past 3 — uncapped) |
| `claimGenesisSquad` callable | 3 qualified referrals → KUMA+SHADOW minted (or +20 blueprints each if owned), +500 Holos, +50 SP, permanent GENESIS badge |
| `assignWildcardBlueprints` callable | 1:1 conversion into any Holobot's blueprints; local fallback (own-doc only) |
| Firestore rules | referral/genesis fields frozen against client writes (`referralFieldsFrozen`); `referralCode` writable (short string); wildcard fields sanity-capped |
| UI | Marketplace **Genesis** tab (invite code + share sheet, qualified counter, claim button, code entry, wildcard balance); stats modal BLUEPRINTS tab wildcard assign (+1 / ALL) |
| Tests | `genesisParity.test.ts`, wildcard/gacha additions in `economyServerParity.test.ts`, `rules-tests/tests/referral-fields.test.ts` |

Referral cross-user writes are server-ONLY (no local fallback — rules block
them by design), so **the referral loop is inert until the functions deploy**.

### Deploy checklist (Pak)
1. `firebase deploy --only firestore:rules`
2. The scoped functions deploy from `functions/README.md` (now 21 functions —
   adds `applyReferralCode`, `claimGenesisSquad`, `assignWildcardBlueprints`,
   and updates `syncFitnessActivity`).

### Testing guide
1. **Wildcard pack**: Marketplace → Items → buy Wildcard Blueprints (300
   Holos). Balance +5. BUY flips to a day countdown for 7 days.
2. **Legendary gacha**: open elite packs until a legendary blueprint drops —
   it reads `WILDCARD ×5 · any Holobot` and raises the wildcard balance
   instead of a random bot's blueprints.
3. **Assigning**: Inventory → any Holobot → BLUEPRINTS tab → WILDCARDS row →
   +1 / ALL. Blueprint count rises 1:1, wildcard balance falls.
4. **Rookie rotation**: Arena Rookie tier's third opponent is GAMA, KUMA, or
   SHADOW depending on the week; beating the featured bot pays that bot's
   blueprints.
5. **Referral loop** (needs deploy + two accounts): Account A opens the
   Genesis tab (publishes code) and shares it. Fresh account B enters the
   code (Genesis tab → GOT AN INVITE CODE?), then completes a workout sync.
   B: +5 wildcards +200 Holos. A: qualified 1/3. After three such friends, A
   claims the squad; a fourth friend pays A +5 wildcards.
6. **Anti-fraud spot checks**: self-code rejected; second code rejected;
   code on a >7-day-old account rejected; claim with <3 qualified rejected;
   double claim rejected.
