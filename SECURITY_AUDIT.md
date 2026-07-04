# Holobots — Production-Readiness Security Audit

**Scope:** `HolobotsMobile/mobile` (Expo / React Native app) and its backend
(`../functions` Firebase Cloud Functions, `../firebase.json`, Firestore).
**Perspective:** Senior application-security engineer preparing for public launch.
**Date:** 2026-07-03
**Auditor:** Automated deep audit (Claude) + implemented fixes on branch `security-hardening`.

---

## 1. Executive Security Summary

Holobots is an Expo/React Native fitness-battle game backed by Firebase Auth,
Firestore, and two Cloud Functions. The client is well-structured and the native
configuration is mostly sound (ATS enabled, no cleartext in release, scoped
permission strings, biometric unlock, signing secrets gitignored).

**However, the application is not production-ready.** The single dominant issue
is architectural: **the entire game economy is client-authoritative.** The mobile
client computes battle outcomes, gacha pulls, quest/training results, marketplace
purchases, fitness→currency conversion, holobot minting, and the leaderboard
score **on-device using client-side `Math.random()`**, then writes the results
**directly to Firestore** — and until this audit there were **no Firestore
security rules in version control** at all. Any authenticated user (or a trivially
modified client / raw SDK call) can set `holosTokens`, `syncPoints`,
`gachaTickets`, holobot levels, and `leaderboardScore` to arbitrary values.

This is a **Critical, launch-blocking** class of vulnerability. It cannot be fully
remediated with client patches; it requires moving value-granting logic to
server-authoritative Cloud Functions. This audit implements the foundational
controls and the highest-confidence hardening now (see §14), and documents the
server-side redesign required before launch (see §16).

**Verdict: Do not launch with a competitive leaderboard, PvP, or any monetized /
tokenized economy until server authority is in place.** Launch readiness: **34/100**
(see §17).

---

## 2. Attack Surface Inventory

| Surface | Component | Trust boundary |
|---|---|---|
| Authentication | Firebase Email/Password (`src/config/firebase.ts`, `AuthContext.tsx`) | Client ↔ Firebase Identity Toolkit |
| Direct DB writes | `users/{uid}` + `fitness_daily` via `src/lib/profile.ts`, `src/lib/fitnessSync.ts` | **Client writes trusted data directly** |
| Cloud Functions | `deleteUserAccountV2`, `syncWatchWorkoutRewards` (`functions/index.js`) | Client → callable functions |
| Web bridge | `WebSectionScreen.tsx` + `webAuthBridge.ts` mints a Firebase custom token into a WebView | Native → WebView / web origin |
| PvP realtime | `battle_rooms`, `battle_pool_entries` via `useRealtimeArena.ts` | Peer ↔ peer over Firestore |
| Leaderboard | `LeaderboardScreen.tsx` reads top-N of `users` collection | Cross-user read of full profile docs |
| Apple Watch bridge | `useWatchBridge.ts` + native `WatchBridgeModule` | Watch → phone → function |
| Sensors / Health | `expo-location`, `expo-sensors`, HealthKit | Device sensors (spoofable) |
| Deep links | scheme `holobotsmobile://` (unverified) | Any app can register the scheme |
| Native config | AndroidManifest, Info.plist, Gradle signing | Device / build pipeline |
| Dependencies | npm (mobile) + firebase-admin/functions (backend) | Supply chain |

---

## 3. Threat Model (STRIDE)

| STRIDE | Threat | Applies here |
|---|---|---|
| **S**poofing | Deep-link scheme hijack (unverified `holobotsmobile://`); custom-token leak via WebView | M3 (native), C-WebView |
| **T**ampering | Client sets currency/stats/leaderboard directly; client decides battle/gacha/quest outcomes; fabricates steps | **C1–C5, H1–H7 — the core risk** |
| **R**epudiation | No server-side audit log of economy changes; idempotency keyed on client-chosen IDs | H1, general |
| **I**nformation disclosure | Leaderboard exposes full user docs to any authed user; local session storage extractable via backup | Privacy §8, M1 |
| **D**enial of service | Unbounded `workouts[]` array to function; `Math.random`/interval loops; npm DoS CVEs | H1(partial), §10 |
| **E**levation of privilege | `isDevAccount` settable by client (no rules); PvP player writes opponent HP/winner | M1, C4 |

Primary adversary: an authenticated player using a modified client or the raw
Firebase SDK with their own valid token — **no credential theft required.**

---

## 4. Risk-Ranked Vulnerabilities

### CRITICAL

- **C0 — No Firestore security rules in version control.** `firebase.json` did not
  reference any rules file; none existed in the repo. The entire data model was
  governed only by whatever is set in the console (unknown/unauditable, quite
  possibly permissive given the client writes directly). *Fixed (baseline rules
  added, §14); full lockdown pending server redesign.*
- **C1 — Currency & inventory directly client-settable.** `src/lib/profile.ts:249`
  `updateUserProfile` writes `holosTokens`, `syncPoints`, `gachaTickets`,
  `battle_cards`, `inventory`, `holobots`, `leaderboardScore` verbatim. A raw
  `updateDoc({holosTokens: 1e9})` succeeds. *Mitigated by rules sanity-caps;
  requires server authority to fully fix.*
- **C2 — Battle win/loss & payout decided client-side.** `ArenaScreen.tsx` trusts
  `battleResult.rewards` and `didWin` from the in-memory combat store; entry fee is
  skippable. *Requires server-authoritative battle resolution.*
- **C3 — Fitness→currency is client-authoritative.** `src/lib/fitnessSync.ts` is a
  **client-side Firestore transaction** trusting `syncPointsAwarded`/`holosAwarded`;
  steps/distance come from spoofable device sensors. *Requires server computation +
  plausibility checks.*
- **C4 — PvP: client writes opponent HP, damage, and winner.**
  `useRealtimeArena.ts:376` lets a player set `players.{opponent}.health = 0` and
  `winner`. *Requires authoritative match server; rules now scope room writes to
  participants but cannot validate individual moves.*
- **C5 — Leaderboard score directly writable.** `leaderboardScore` is an accepted
  update field; `updateProfile({leaderboardScore: 9999999})` → rank #1. *Requires
  server-computed score.*

### HIGH

- **H1 — `syncWatchWorkoutRewards` trusted client reward amounts.** The one server
  path accepted `syncPointsEarned/holosEarned/expEarned` unbounded. **✅ Fixed** —
  rewards are now clamped server-side to activity + absolute per-session ceilings.
- **H2 — Daily-mission claims** grant rewards with no server completion check
  (`DailyMissionsModal.tsx`, `dailyMissions.ts`).
- **H3 — Energy/passes/tickets** refilled and balances set client-side
  (`TrainingScreen.tsx`).
- **H4 — Marketplace** price checks, debits, and drops are client-side with client
  RNG (`MarketplaceScreen.tsx`).
- **H5 — Gacha** uses client `Math.random()` and writes outcomes client-side
  (`GachaScreen.tsx`).
- **H6 — Quests/Training** use client RNG, client timestamps (backdatable
  cooldowns), and client reward grants (`progressionSystems.ts`).
- **H7 — Holobot minting / rank-up / stat upgrades** recomputed and written client
  side (`InventoryScreen.tsx`).

### MEDIUM

- **M1 — `android:allowBackup="true"`** — session storage extractable via backup.
  **✅ Fixed** (`false`).
- **M2 — Release build not obfuscated** (`enableProguardInReleaseBuilds=false`).
- **M3 — Deep link uses unverified custom scheme** (no App Links / Universal Links).
- **M4 — Excess Android permissions** (`SYSTEM_ALERT_WINDOW`, legacy storage).
- **M5 — Signing key + plaintext passwords co-located in project tree**
  (`android/keystore.properties` holds cleartext store/key passwords next to
  `holobots-upload-key.jks`). Gitignored (good) but should live outside the tree /
  in a secret store; `.pem` cert was not ignored. **✅ Partially fixed** (gitignore
  now covers `*.pem`/`*.p12`/`keystore.properties`; relocation + rotation is manual).
- **M6 — Leaderboard exposes full user documents** to every authenticated user
  (privacy; §8).
- **M7 — WebView injected a session token with no origin restriction.** **✅ Fixed**
  (trusted-host allowlist + navigation confinement).

### LOW

- **L1 — Firebase web API key hardcoded** (`firebase.ts:32`). Expected for Firebase
  web keys, but apply Google Cloud API-key restrictions + App Check.
- **L2 — Weak password minimum (6).** **✅ Fixed** → 8.
- **L3 — No brute-force lockout** beyond Firebase defaults; consider App Check /
  reCAPTCHA and Identity Platform password policies.
- **L4 — Dependency CVEs** concentrated in dev/build tooling (§10).

---

## 5. OWASP Top 10 (2021) Coverage

| # | Category | Status | Notes |
|---|---|---|---|
| A01 | Broken Access Control | ❌ **Critical** | No rules (now baseline); client-authoritative writes; PvP opponent-field writes. |
| A02 | Cryptographic Failures | ⚠️ | Firebase TLS OK; local session in AsyncStorage now not backed up; consider SecureStore for tokens. |
| A03 | Injection | ✅ Low | No SQL; WebView injection now origin-gated; no `eval`/`dangerouslySetInnerHTML`. |
| A04 | Insecure Design | ❌ **Critical** | Economy designed as client-authoritative — the root cause. |
| A05 | Security Misconfiguration | ⚠️ → improving | Rules added; `allowBackup` fixed; ProGuard/App Check pending. |
| A06 | Vulnerable Components | ⚠️ | 21 npm advisories, mostly dev tooling (§10). |
| A07 | Identity/Auth Failures | ⚠️ | Email/pw only; weak min pw (fixed); no App Check/MFA; no lockout. |
| A08 | Software/Data Integrity | ❌ | Client-supplied rewards; idempotency keyed on client IDs. H1 fixed. |
| A09 | Logging/Monitoring | ❌ | No server-side audit trail of economy mutations. |
| A10 | SSRF | ✅ N/A | No server-side fetch of user URLs. |

---

## 6. Authentication & Authorization Audit

- **AuthN:** Firebase Email/Password. Biometric (Face ID) is a **local unlock gate
  only** (`AuthContext.unlockWithFaceId`) — it does not re-authenticate to Firebase,
  which is acceptable for a "remember session" UX. Session persisted in AsyncStorage
  via `getReactNativePersistence`.
- **Signup recovery path** (`AuthContext.tsx:401`) re-attempts sign-in on
  `email-already-in-use` — logic is careful and signs out on mismatch. OK.
- **AuthZ:** This is the failure. Authorization is enforced **only** by (previously
  absent) Firestore rules. `deleteUserAccountV2` is `invoker:"public"` but verifies
  the supplied `idToken` server-side — acceptable. `syncWatchWorkoutRewards` requires
  `request.auth.uid` — good.
- **Gaps:** No App Check (any client with the public config can call functions / hit
  Identity Toolkit); no MFA; no server-side role model (`isDevAccount` was
  client-settable — now blocked by rules).

---

## 7. API & Backend Security Review

- Backend = two Firebase callables. `syncWatchWorkoutRewards` **✅ hardened**: input
  validation, `MAX_WORKOUTS_PER_CALL` cap, and server-side reward clamping.
- **`createWebviewBridgeToken` is referenced by the client but not defined in
  `functions/index.js`.** Either it is deployed out-of-band or the repo is out of
  sync with production. **Action required:** confirm the deployed function set
  matches the repo; an undocumented token-minting function is an audit blind spot.
- No rate limiting on callables beyond Firebase defaults; add App Check.
- Idempotency for workouts is keyed on the client-chosen `workoutId` — a client can
  still replay distinct IDs up to the daily cap (now bounded in value by clamping).

---

## 8. Database, Storage & User-Data Privacy Review

- **Firestore:** baseline rules now scope `users/{uid}` writes to the owner and deny
  everything by default. **Residual privacy issue (M6):** the leaderboard reads the
  full top-N `users` documents, so any authenticated user can read every field of
  other players' profiles. **Recommended:** a dedicated `/leaderboard/{uid}`
  projection containing only `{username, score, rank}`, written by a Cloud Function,
  with `users/{uid}` read restricted to the owner.
- **No Firebase Storage rules** file exists; if Storage is used in production it is
  ungoverned. Add `storage.rules` (default-deny) before launch.
- **Local storage:** auth prefs + session in AsyncStorage (unencrypted). Now excluded
  from Android backup. Consider `expo-secure-store` for anything token-like.
- **PII:** email lives in Firebase Auth (not Firestore) — good. `username` is
  user-supplied; validate/moderate to prevent impersonation/abuse.
- **Account deletion:** `deleteUserAccountV2` does `recursiveDelete` + `auth.deleteUser`
  — solid GDPR/CCPA deletion. Good.

---

## 9. Infrastructure, Deployment & Secrets Management

- **Signing (Android):** `build.gradle` correctly loads release signing from
  `keystore.properties` (not hardcoded). Debug keystore uses the standard public
  `android` password — fine. **M5:** the release keystore **and cleartext passwords**
  sit inside the project tree. They are gitignored, but should move to a CI secret
  store / `~/.gradle/gradle.properties` / env vars, and be confirmed never committed.
  If any doubt, rotate the upload key via Play App Signing.
- **iOS:** automatic signing, team ID only in pbxproj (not sensitive); ATS enabled;
  no arbitrary loads.
- **Secrets in code:** only the Firebase web config (public by design). Apply Google
  Cloud **API key restrictions** (package + SHA-1 / bundle ID) and **App Check**.
- **CI/CD:** none found in-repo (no `eas.json`, no workflow files). Establish a
  pipeline that injects signing secrets at build time and runs `npm audit` + tests.

---

## 10. Dependency & Supply-Chain Audit

- `npm audit` (mobile): **21 advisories (2 critical, 4 high, 14 moderate, 1 low)**.
  The critical/high ones (`ws`, and transitive dev deps) live under
  `@react-native/dev-middleware`, `metro`, `react-devtools-core` — **development /
  bundler tooling that does not ship in the release binary.** Still worth
  `npm audit fix`.
- **Actions:** run `npm audit fix`; pin/refresh `firebase` (11.x) and Expo SDK 53
  patch releases; enable Dependabot/`npm audit` in CI; generate an SBOM.
- Backend `functions` deps (`firebase-admin` 13, `firebase-functions` 6) are current.

---

## 11. Abuse, Cheating, Botting & Fraud Analysis

This is the app's largest exposure and follows directly from client authority:

- **Infinite currency/items:** raw `updateDoc` on own profile (C1) or forged battle/
  gacha/quest/marketplace rewards (C2, H4–H7).
- **Fitness fraud:** fabricate steps/distance → free `holosTokens`/`syncPoints` (C3).
  The `syncWatchWorkoutRewards` path is now clamped (H1) but the client-side
  `syncFitnessActivity` transaction is not — **both** conversion paths must move
  server-side.
- **Leaderboard manipulation:** set `leaderboardScore` directly (C5).
- **PvP cheating:** instant-win by writing opponent HP/winner; inflated matchmaking
  stats (C4).
- **Predictable RNG:** all `Math.random()` on-device (gacha rarity, drop tables,
  quest success, crits) is manipulable/observable. Move RNG server-side.
- **Bot/replay:** no App Check → automated clients can call callables and write
  Firestore at scale. Add App Check + server-side rate limiting.

If `holosTokens` is ever bridged to an on-chain / cashable asset, every item above
becomes **direct financial fraud**. (No smart contracts or Web3 wallet code were
found in this repo; treat tokenization as a future gate that must not ship before
server authority.)

---

## 12. Mobile Application Security Review

- **Client-side storage:** AsyncStorage (unencrypted) for auth prefs/session; now
  excluded from Android backup (M1 fixed). Move token-grade data to SecureStore.
- **API keys:** only public Firebase config in the bundle (L1) — restrict at the
  Cloud console.
- **Certificates/keys:** upload keystore + passwords in tree (M5) — gitignore
  tightened; relocation manual.
- **Permissions:** iOS strings are specific and appropriate. Android requests
  `SYSTEM_ALERT_WINDOW` + legacy storage (M4) — remove unless a feature needs them
  (overlay perm is a tapjacking vector and draws Play review).
- **Deep links:** unverified custom scheme (M3) — adopt App Links / Universal Links
  and treat all deep-link payloads as untrusted.
- **WebView:** minted a Firebase custom token with no origin restriction (M7) —
  **fixed** with a trusted-host allowlist and navigation confinement.
- **Release hardening:** enable ProGuard/R8 (M2). Reverse-engineering an
  unobfuscated bundle makes the client-authority abuse even easier to discover.
- **Transport:** ATS on, no cleartext in release. Good. Consider certificate pinning
  for the Firebase endpoints if threat model warrants.

---

## 13. Hardening Checklist (prioritized by impact)

**P0 — launch blockers (server redesign):**
1. Move ALL economy writes to Cloud Functions: battle payouts, gacha, quests/training,
   marketplace, minting, mission claims, fitness conversion, leaderboard score.
2. After (1), tighten Firestore rules so economy fields are `allow write: if false`
   for clients.
3. Server-side RNG for every randomized outcome.
4. Server-authoritative PvP move validation; only the server writes health/winner.
5. Add Firebase **App Check** to all callables + Firestore.

**P1 — high:**
6. Add `storage.rules` (default-deny) if Storage is used.
7. `/leaderboard` public projection; restrict `users` reads to owner.
8. Confirm deployed function set matches repo (`createWebviewBridgeToken`).
9. Server-side rate limiting / abuse monitoring + economy audit log.

**P2 — medium:**
10. Relocate signing key/passwords out of tree; rotate if ever committed.
11. Enable ProGuard/R8; enable resource shrinking.
12. App Links / Universal Links; drop unverified custom-scheme trust.
13. Remove excess Android permissions.
14. Restrict Firebase API key in Google Cloud console.

**P3 — low / done:** password policy (✅), allowBackup (✅), gitignore secrets (✅),
`npm audit fix`, SecureStore for tokens, MFA option.

---

## 14. Implemented Fixes (this branch)

All changes are on `security-hardening`, verified with `npm run typecheck` and
`npm test` (17 passing), committed incrementally:

1. **Firestore security rules (new, version-controlled).** `firestore.rules` +
   `firestore.indexes.json` wired into `firebase.json`. Auth required everywhere;
   `users/{uid}` writes scoped to owner; `isDevAccount` escalation blocked; economy
   fields sanity-capped (`0 ≤ n ≤ 1e8`); PvP room/pool writes scoped to participants;
   default-deny fallthrough. *(Closes C0; mitigates C1/C5/M1-escalation.)*
2. **Server-side reward clamping (H1).** `functions/index.js` no longer trusts
   client reward amounts; `clampWorkoutReward` limits payout to what the reported
   (also-clamped) steps/distance/time justify, with absolute per-session ceilings,
   plus per-call array cap and payload validation. Canonical spec + tests in
   `mobile/src/lib/security/workoutRewardLimits.ts`.
3. **WebView token confinement (M7).** `isAllowedBridgeOrigin` https allowlist;
   token is only minted/injected for trusted hosts; navigation confined via
   `onShouldStartLoadWithRequest` + `originWhitelist`, window-open disabled.
   (`bridgeOrigin.ts`, `webAuthBridge.ts`, `WebSectionScreen.tsx`.)
4. **Native/config hardening.** `.gitignore` excludes signing keys/certs/service
   files; `android:allowBackup="false"` (M1); signup password min 6→8 (L2).

---

## 15. Regression Tests

New tests (`mobile/src/lib/security/__tests__/`, run via `npm test`):

- `workoutRewardLimits.test.ts` (5) — honest rewards pass; the `1e6` fabrication is
  clamped to activity (regression for H1); absolute ceilings hold; negative/NaN/
  Infinity/non-numeric rejected; under-reporting allowed but over-reporting isn't.
- `webAuthBridge.test.ts` (4) — trusted host + subdomains over https allowed; non-https
  rejected; look-alike/third-party hosts rejected (token-exfiltration guard);
  malformed input rejected.

The canonical reward limits are duplicated in `functions/index.js` (CommonJS) and the
tested TS module; a comment in each points to the other. **Firestore rules tests are
not yet automated** — they require the Firebase emulator + `@firebase/rules-unit-testing`
(needs network/emulator, unavailable in this environment). Add an emulator-based rules
test suite in CI (see §16).

---

## 16. Remaining Risks Requiring Manual Review

- **Server-authority redesign (C1–C5, H2–H7)** — the core work. Not safely
  patchable client-side; needs Cloud Functions + rule lockdown. **Launch blocker.**
- **Client-side `syncFitnessActivity` transaction (C3)** left intact to preserve
  functionality — must be replaced by a server callable mirroring the H1 clamping.
- **`createWebviewBridgeToken`** — verify the deployed backend vs repo; audit the
  actual token scope/lifetime.
- **Firestore/Storage rules validation** — deploy the new rules to a staging project
  and run emulator-based tests before production; confirm they don't regress the
  leaderboard query. Add `storage.rules`.
- **Signing key relocation/rotation (M5)** and **App Check enrollment**.
- **The new `firestore.rules` reflect the client's current write shape**; they were
  authored from code, not from the live deployment. Diff against the console ruleset
  before deploying so nothing in production breaks.
- Confirm the trusted WebView host (`ALLOWED_BRIDGE_HOSTS = ["holobots.fun"]`) is
  the correct production domain.

---

## 17. Production Launch Readiness Score

### **34 / 100 — Not ready for public launch.**

**Justification.** The native app, auth flows, transport security, account deletion,
and (post-fix) config hygiene are in good shape, and the foundational access-control
gap (no Firestore rules) is now closed with a baseline. That earns a meaningful base.

But the defining characteristic of the product — a competitive, currency-driven
fitness game with leaderboards and PvP — is built on a **client-authoritative economy
with no server validation of value.** Any player can mint currency, forge wins, top
the leaderboard, and (via still-client-side paths) fake fitness activity. For a game
whose entire value proposition is fair progression and ranking, this is a fatal,
launch-blocking defect that the implemented fixes only partially contain. The score
cannot rise above the ~30s until economy logic is server-authoritative.

**Path to launch-ready (target ≥ 85):** complete P0 items §13 (server authority for
all economy writes, rules lockdown, server RNG, PvP validation, App Check). With
those done and rules emulator-tested, this becomes a fundamentally sound Firebase
game. The client and native layers are already close.

---

*Fixes implemented on branch `security-hardening` (5 commits). Run `npm test` and
`npm run typecheck` in `mobile/` to reproduce verification.*
