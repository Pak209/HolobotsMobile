# Genesis Squad — Starter Bundle, Referrals, and Battle Pass Plan

Status: design proposal, no implementation
Scope: the game's first monetization + growth systems, built on the existing
server-authoritative economy (18 callables) and the 3v3 Showdown mode

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
its blueprint equivalent (e.g., 40 blueprints toward the next rank) so no
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
| Referral spam pressure | Cap at exactly 3 needed; no infinite referral ladder in v1 |
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

## 6. Open decisions for Pak

1. Bundle price point ($4.99 suggested) and celebration pack contents.
2. Referral count (3 suggested) and invited-player welcome bonus size.
3. Owned-bot conversion rate (suggested: 20 blueprints per already-owned
   Genesis bot — one full Rare rank step; 40 would be Elite-tier money and
   overshoots the mint cost of 5 by 8x).
4. Battle pass season length and premium price.
5. Whether the GENESIS badge is bundle-exclusive forever (scarcity) or
   earnable later (kindness). Suggested: exclusive to year one.

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
