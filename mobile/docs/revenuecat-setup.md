# RevenueCat Setup — Manual Checklist

**Status 2026-07-20: steps 1–9 are ALL done.** The purchases layer is LIVE
behind the kill switch: `config/monetization.iapEnabled` is `true`, the SDK
key is committed, and the Season 1 store UI ships in the Marketplace
("Season 1" tab, PR #50) — it renders only while the flag resolves true, so
setting the flag to `false` in Firestore hides all of it instantly with no
app update. The ONLY remaining step is outside this checklist and gated on
Apple: when the next app version after 1.0 is created, add the 3 IAPs to
that submission (tracked in PakOS Actions Needed: "Submit the 3 IAPs with
the next app version").

State of play:

- App Store Connect (app `6762533312`, bundle `fun.holobots.mobile`) has
  3 products, all "Prepare for Submission" with complete metadata and
  review screenshots: `genesis_squad_499` ($4.99 non-consumable),
  `genesis_squad_early_199` ($1.99 non-consumable),
  `battle_pass_monthly` ($1.99/month auto-renewable). App version 1.0 is
  in review WITHOUT them (intended — ASC requires first IAPs to ride with
  a NEW version, and Season 1 pricing starts on the early-adopter SKU).
- Paid Apps agreement, banking, and tax: Active.
- Server fulfillment ships in this repo: the `revenuecatWebhook` Cloud
  Function grants the Genesis Squad (same builder as the referral path,
  source `"purchase"`) and stamps `battlePassActiveUntil` — clients never
  write economy fields.
- Client store UI: `mobile/src/components/SeasonStoreSection.tsx` sells
  the RevenueCat `default` offering with live `priceString` prices;
  owned/active states read the server-written `genesisSquadClaimed` /
  `battlePassActiveUntil` fields.

## 1. RevenueCat account + project

- [x] Create a RevenueCat account at revenuecat.com (free tier is fine).
      (Account already existed — same one as the Nomi project.)
- [x] Create a project (e.g. **Holobots**) and add an **App Store** app
      with bundle id `fun.holobots.mobile`. (Project id `8b538ad1`, done
      2026-07-19.)

## 2. Connect App Store Connect

- [x] In App Store Connect → Users and Access → Integrations → **In-App
      Purchase**, generate an **In-App Purchase key** (RevenueCat also asks
      for an App Store Connect API key with **Admin** role for product
      import). Download the `.p8` files.
- [x] In RevenueCat → your app → App Store Connect credentials, upload the
      key(s) per their prompts. (Reused the team-level keys already in the
      RevenueCat account from Nomi Recall — IAP key `KLM975ULS7`, ASC API
      key `55XZ8SBC8U`; Holobots and Nomi are on the same Apple team, and
      RevenueCat shows "Valid credentials".)

## 3. Import products

- [x] RevenueCat → Products → import (or add manually) all three:
      `genesis_squad_499`, `genesis_squad_early_199`, `battle_pass_monthly`.

## 4. Entitlements

- [x] Create entitlement **`genesis_squad`** → attach BOTH
      `genesis_squad_499` and `genesis_squad_early_199`.
- [x] Create entitlement **`battle_pass`** → attach `battle_pass_monthly`.

(These ids are hardcoded in `mobile/src/lib/monetization.ts` and
`functions/src/lib/monetization.ts` — parity-tested; don't rename one side.)

## 5. Offering

- [x] Create a **default** Offering containing the packages you want the
      store UI to show (Genesis Squad at the current price point + the
      battle pass). The client reads it via `getOfferings()`.
      (Created with `$rc_monthly` → `battle_pass_monthly` and
      `$rc_lifetime` → `genesis_squad_early_199`. To switch Genesis to the
      $4.99 price later, swap the lifetime package's product in the
      dashboard — no app update needed.)

## 6. Client SDK key

- [x] RevenueCat → Project settings → API keys → copy the **Public app
      specific API key** for the App Store app (starts with `appl_`).
- [x] Paste it into `REVENUECAT_IOS_API_KEY` in
      `mobile/src/config/revenuecat.ts`. Public SDK keys are safe to
      commit; this alone does NOT enable purchases (the remote flag is
      still off).

## 7. Webhook (server fulfillment)

- [x] Pick a long random value for the shared webhook secret, e.g.
      `openssl rand -hex 32`.
- [x] Set it as a Firebase secret:
      `firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH` (version 1,
      2026-07-19).
- [x] Deploy the function using the scoped command in `functions/README.md`
      (never a bare `firebase deploy --only functions`). (Deployed
      `--only functions:revenuecatWebhook`, gen2, us-central1.)
- [x] RevenueCat → Project settings → Integrations → **Webhooks**: set the
      URL to the deployed function URL, e.g.
      `https://us-central1-holobots-24046.cloudfunctions.net/revenuecatWebhook`
      (copy the exact URL from the deploy output / Firebase console), and
      set the **Authorization header value** to the SAME secret value.
      (Webhook "Holobots server fulfillment", both environments, all
      apps/events.)
- [x] Optional sanity check: RevenueCat's "send test event" should get a
      200; Cloud Functions logs show `revenuecatWebhook: event settled`
      or a logged skip. (Verified 2026-07-19: dashboard shows Response
      200; logs show the TEST event settling as a logged
      "no user doc for app_user_id" skip. Note: the very first test after
      deploy showed "wasn't possible to connect" — that was cold-start
      latency, not a config error; re-send succeeded.)

## 8. iOS project

- [x] Run `pod install` in `mobile/ios` (the `react-native-purchases` npm
      package is already in package.json; the pod is not installed yet).
      (Done 2026-07-19 — RNPurchases 10.4.3 / PurchasesHybridCommon
      18.21.0 in Podfile.lock.)
- [x] Xcode → target **HolobotsMobile** → Signing & Capabilities → add
      **In-App Purchase**. (Added directly in project.pbxproj as
      `SystemCapabilities { com.apple.InAppPurchase = enabled }` on the
      app target — the same record Xcode writes; IAP needs no
      entitlements-file entry.)

## 9. Season 1 launch (the actual switch — do LAST)

- [x] Firebase console → Firestore → create doc `config/monetization` with
      field `iapEnabled` (boolean) = `true`. This is the kill switch; the
      generic `config/{document}` rule already gives signed-in clients
      read-only access. To pull IAP back out, set it to `false`.
      (Created 2026-07-20. Safe because builds without the SDK key no-op
      regardless of the flag.)
- [x] Provide the IAP review screenshot on each of the 3 product pages.
      (Uploaded 2026-07-20 — a simulator capture of the Season 1 store,
      resized to 1284×2778; ASC rejects the iPhone 17 Pro simulator's
      native 1206×2622. All 3 products now show "Prepare for Submission"
      with no metadata warnings. NOTE: ASC's old "attach IAPs to a
      version" picker is gone — IAPs are added during the SUBMISSION flow
      of a new app version, which is the one remaining step above.)
- [x] Update the privacy nutrition label: add **Purchases** (App
      Functionality, linked to identity). (Published 2026-07-20; the
      website policy also gained a Purchase Information section naming
      Apple + RevenueCat — holobots-fun PR #9.)
- [x] Verify the Restore Purchases row appears (Pilot Stats → Settings)
      and completes. (Verified on simulator 2026-07-20. Gotcha: the
      monetization config is cached once per app session — an app
      launched before the flag flip must be fully restarted to see it.)

## Compliance notes

- **Gacha odds disclosure**: only required if randomized items (gacha
  tickets/packs, Holos that buy packs) become PURCHASABLE. The current
  products are fixed-content, so it does not apply — if that changes, add
  a drop-rates screen to the gacha UI and update the age-rating
  questionnaire's "Simulated Gambling" answer.
- **Privacy label**: "Purchases" must be declared from the first version
  that ships live IAP (step 9), not before. (Declared 2026-07-20 — one
  version early on purpose: build 37 already initializes the RevenueCat
  SDK, so purchase-infrastructure data collection is real from 1.0.)
- Apple requires the **Restore Purchases** button whenever IAP is live —
  it ships in this code, gated behind the same `iapEnabled` flag.
- **Battle Pass subscription disclosure**: the store card carries the
  Apple-required auto-renew terms plus working Terms of Use / Privacy
  Policy links (holobots.fun/terms, holobots.fun/privacy) — keep those
  pages alive.
