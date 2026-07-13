# App Store Submission Pack

Everything below is ready to paste into App Store Connect. Items marked
🖐 need your hands (Apple account owner actions); everything else is done
or provided here. RevenueCat/IAP is deliberately out of scope — this pack
submits the free app; a later IAP release adds its own review items (see
the last section).

## 0. State of play

- Bundle: `fun.holobots.mobile` (+ `fun.holobots.mobile.watchapp`), builds
  already uploading to App Store Connect. ✅
- Account deletion in-app (`deleteUserAccountV2` via Settings) — Apple
  REQUIRES this for apps with account creation. ✅
- All permission purpose strings present (HealthKit ×2, Motion, Location
  when-in-use). ✅
- `ITSAppUsesNonExemptEncryption = false` added to Info.plist (HTTPS-only
  exemption) — the export-compliance question disappears from every future
  build upload. ✅ (this PR)
- In-app Privacy Policy + Terms exist; hosted copies generated at
  `web-hosting/privacy.html` + `terms.html` — 🖐 upload to
  `https://holobots.fun/privacy` and `/terms` (any static hosting works;
  the URLs just have to resolve publicly).

## 1. Version hygiene (before the next build)

Pick ONE public version and make everything agree. Recommended: **1.0.0**.

- Xcode target `HolobotsMobile`: MARKETING_VERSION `1.0.0`, build number
  = next integer above your last TestFlight upload.
- Watch app target: same MARKETING_VERSION (Apple requires watch/phone
  version match).
- `mobile/app.json` `version`: `1.0.0` (cosmetic for bare workflow, but
  stop the drift).

## 2. App Information

| Field | Value |
|---|---|
| Name | **Holobots** (if taken, fallback: "Holobots: Sync & Battle") |
| Subtitle (30 chars) | `Train IRL. Battle Holobots.` (27) |
| Primary category | Games → Role Playing |
| Secondary category | Health & Fitness |
| Content rights | Does not contain third-party content |
| Age rating | See §5 |
| Privacy Policy URL | `https://holobots.fun/privacy` 🖐 host first |
| Support URL | `https://holobots.fun` |
| Copyright | `© 2026 <your legal name/entity>` 🖐 |

## 3. Store listing copy (paste-ready)

**Promotional text** (170 max, editable without review):

> Season one is live: recruit friends for the Genesis Squad, hunt the
> 0.1% Legendary Blueprint, and take your squad into 3v3 Showdown.

**Description**:

> Your workouts power your robots. Holobots turns real steps, distance,
> and workout sessions into Sync Points, EXP, and gear for a squad of
> collectible battle robots — then throws you into a real-time arena to
> prove it.
>
> TRAIN IN THE REAL WORLD
> • 5-minute Sync workouts convert steps and distance into rewards
> • Apple Watch companion tracks workouts from your wrist
> • Daily energy, quests, and training courses keep the loop going
>
> BUILD YOUR SQUAD
> • Collect Holobots by earning blueprints from arena victories
> • Rank them from Common to Legendary and spend attribute points
> • Equip parts with real stat boosts — head, torso, arms, legs, core
> • Unlock and upgrade each bot's move kit in the Move Lab
>
> FIGHT FOR REAL
> • Real-time arena combat: strikes, combos, defense traps, guard
>   stacks, and one rule-bending ability per Holobot
> • Charge the special meter for technical finishers and signatures
> • 3v3 Showdown: rotate a three-bot squad, Pokémon-style
> • Live PvP: quick match or share a room code with a friend
>
> EARN EVERYTHING
> • Gacha packs, booster packs, and a marketplace — all earnable in-game
> • Invite friends: three qualified recruits unlock the Genesis Squad
>   and the permanent GENESIS badge
> • Somewhere in the gacha pool hides the Legendary Blueprint…
>
> Holobots reads activity data only with your permission, and only to
> power in-game rewards.

**Keywords** (100 chars, no spaces after commas):

```
robot,battle,rpg,fitness,gacha,pvp,collect,mecha,steps,workout,arena,pet,anime
```
(97 chars)

**What's New** (first release): `Holobots 1.0 — train in the real world,
battle in the arena. Welcome, pilots.`

## 4. Screenshots 🖐

Required: one set at **6.9" (1320×2868)** or 6.7" (1290×2796) — iPhone
Pro Max simulator screenshots are fine. Optional but free polish: Apple
Watch set (410×502 for Series 10).

Suggested shots in order (first two matter most):

1. Dashboard — ACE with hologram, rank tag, part frames ("Your squad,
   powered by your workouts")
2. Arena battle — move cards + crib sheet ("Real-time tactical combat")
3. 3v3 Showdown mid-battle with squad dock ("Rotate a three-bot squad")
4. Fitness sync screen mid-workout ("5-minute workouts, real rewards")
5. Gacha reveal (ideally a legendary/wildcard pull)
6. Marketplace Genesis tab ("Recruit friends, claim the Genesis Squad")
7. Watch app workout screen (if doing the watch set)

No caption overlays needed for v1 — clean screenshots review faster.

## 5. Age rating questionnaire

Answer these; everything else "None":

| Question | Answer |
|---|---|
| Cartoon or Fantasy Violence | **Infrequent/Mild** (robot arena battles) |
| Simulated Gambling | **None** — gacha uses earned soft currency only; revisit when tickets become purchasable |
| Unrestricted Web Access | **None** (WebView is allowlisted to holobots.fun) |
| Everything else (realistic violence, mature themes, etc.) | None |

Expected rating: **9+**.

## 6. App Privacy (the "nutrition label") 🖐 answers below

Data types to declare — all **Linked to identity**, none **Used for
tracking** (no ad SDKs, no cross-app identifiers):

| Data type | Collected? | Purpose |
|---|---|---|
| Contact Info → Email Address | Yes (Firebase Auth) | App Functionality |
| Health & Fitness → Fitness | Yes (steps, distance, workout sessions via HealthKit/pedometer) | App Functionality |
| Identifiers → User ID | Yes (Firebase uid) | App Functionality |
| User Content → Other (username, game profile) | Yes | App Functionality |
| Location | **No** — coordinates are used on-device to compute distance during workouts; only the derived distance is uploaded |
| Purchases, Browsing, Diagnostics, Contacts, etc. | No |

(If you later add Crashlytics/analytics, add Diagnostics.)

## 7. App Review Information 🖐

- **Demo account**: create a fresh account, then from your dev account
  refer it + play it briefly so the reviewer sees content: a couple of
  Holobots, some Holos/tickets, an arena win. Provide its email +
  password in the review notes fields.
- **Notes for reviewer** (paste):

> Holobots is a fitness RPG. Health/motion data: the iPhone app reads
> step counts via CoreMotion during an active workout session the user
> starts manually; the Apple Watch companion uses HealthKit workout
> sessions. Activity data is used solely to compute in-game rewards.
> Location (when-in-use) measures distance during a user-started workout
> and is never uploaded — only derived distance is synced.
>
> Account deletion is available in-app: Pilot Stats (top-right icon on
> the home screen) → Settings → Delete Account.
>
> All game currencies are earned through play; there are no purchases in
> this version. The referral system grants in-game robots for inviting
> friends — codes are entered manually at signup.
>
> A demo account with progress is provided above. PvP requires two
> accounts; the demo account can also use Quick Match against the
> provided second account if needed: <second account creds>.

- **Attachment tip**: if the reviewer needs the watch flow, note that
  the watch app requires a paired Apple Watch and the phone app signed in.

## 8. Pre-submission QA (one pass on a clean device)

- [ ] Fresh install → signup with a NEW email → starter deck + ACE appear
- [ ] Signup with an EXISTING email → clean error, routed to Sign In (no spinner)
- [ ] Complete one Sync workout → rewards collect (no hang)
- [ ] Arena 1v1 + 3v3 round each; results modal pays out
- [ ] Marketplace buy (Arena Pass) works; gacha pull works
- [ ] Delete Account works end-to-end
- [ ] Airplane mode: economy actions show "needs a connection" errors, no crashes
- [ ] `config/appDistribution.inviteUrl` set so SHARE INVITE carries the TestFlight/App Store link

## 9. Known review-risk notes (why we're OK)

- **HealthKit**: entitlements on both targets + purpose strings + policy
  hosted → compliant. Watch-only HealthKit usage is explained in notes.
- **Account creation** → deletion requirement met in-app.
- **Loot boxes**: odds disclosure only applies to randomized items
  obtainable via purchase. Not applicable until IAP ships — when Holos
  or tickets become purchasable, add a rates screen to the gacha UI.
- **Minimum functionality / placeholder content**: none.
- **Web content**: WebView is origin-allowlisted with a native auth
  bridge; no unrestricted browsing.

## 10. When RevenueCat/IAP lands (next release, not this one)

- App Store Connect: Paid Apps agreement + banking/tax 🖐 (start early —
  it gates everything and can take days)
- Create IAP products (`genesis_squad_499`, `genesis_squad_early_199`),
  attach to the version, provide IAP review screenshot
- Add In-App Purchase capability to the Xcode target
- Update the privacy label: add Purchases
- Add gacha odds disclosure if randomized items become purchasable
- Restore Purchases button (RevenueCat handles the flow; UI must expose it)
