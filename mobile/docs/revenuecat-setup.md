# RevenueCat Setup — Manual Checklist

The code side of IAP is done and DORMANT: nothing initializes, renders, or
prompts until `config/monetization.iapEnabled` is `true` AND the public SDK
key is pasted in. Everything below is dashboard/console work only you can
do. Steps 1–8 are safe to do any time (the app stays inert); step 9 is the
Season 1 switch.

State of play (already true):

- App Store Connect (app `6762533312`, bundle `fun.holobots.mobile`) has
  3 DRAFT products: `genesis_squad_499` ($4.99 non-consumable),
  `genesis_squad_early_199` ($1.99 non-consumable),
  `battle_pass_monthly` ($1.99/month auto-renewable).
- Paid Apps agreement, banking, and tax: Active.
- Server fulfillment ships in this repo: the `revenuecatWebhook` Cloud
  Function grants the Genesis Squad (same builder as the referral path,
  source `"purchase"`) and stamps `battlePassActiveUntil` — clients never
  write economy fields.

## 1. RevenueCat account + project

- [ ] Create a RevenueCat account at revenuecat.com (free tier is fine).
- [ ] Create a project (e.g. **Holobots**) and add an **App Store** app
      with bundle id `fun.holobots.mobile`.

## 2. Connect App Store Connect

- [ ] In App Store Connect → Users and Access → Integrations → **In-App
      Purchase**, generate an **In-App Purchase key** (RevenueCat also asks
      for an App Store Connect API key with **Admin** role for product
      import). Download the `.p8` files.
- [ ] In RevenueCat → your app → App Store Connect credentials, upload the
      key(s) per their prompts.

## 3. Import products

- [ ] RevenueCat → Products → import (or add manually) all three:
      `genesis_squad_499`, `genesis_squad_early_199`, `battle_pass_monthly`.

## 4. Entitlements

- [ ] Create entitlement **`genesis_squad`** → attach BOTH
      `genesis_squad_499` and `genesis_squad_early_199`.
- [ ] Create entitlement **`battle_pass`** → attach `battle_pass_monthly`.

(These ids are hardcoded in `mobile/src/lib/monetization.ts` and
`functions/src/lib/monetization.ts` — parity-tested; don't rename one side.)

## 5. Offering

- [ ] Create a **default** Offering containing the packages you want the
      store UI to show (Genesis Squad at the current price point + the
      battle pass). The client reads it via `getOfferings()`.

## 6. Client SDK key

- [ ] RevenueCat → Project settings → API keys → copy the **Public app
      specific API key** for the App Store app (starts with `appl_`).
- [ ] Paste it into `REVENUECAT_IOS_API_KEY` in
      `mobile/src/config/revenuecat.ts`. Public SDK keys are safe to
      commit; this alone does NOT enable purchases (the remote flag is
      still off).

## 7. Webhook (server fulfillment)

- [ ] Pick a long random value for the shared webhook secret, e.g.
      `openssl rand -hex 32`.
- [ ] Set it as a Firebase secret:
      `firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH`
- [ ] Deploy the function using the scoped command in `functions/README.md`
      (never a bare `firebase deploy --only functions`).
- [ ] RevenueCat → Project settings → Integrations → **Webhooks**: set the
      URL to the deployed function URL, e.g.
      `https://us-central1-holobots-24046.cloudfunctions.net/revenuecatWebhook`
      (copy the exact URL from the deploy output / Firebase console), and
      set the **Authorization header value** to the SAME secret value.
- [ ] Optional sanity check: RevenueCat's "send test event" should get a
      200; Cloud Functions logs show `revenuecatWebhook: event settled`
      or a logged skip.

## 8. iOS project

- [ ] Run `pod install` in `mobile/ios` (the `react-native-purchases` npm
      package is already in package.json; the pod is not installed yet).
- [ ] Xcode → target **HolobotsMobile** → Signing & Capabilities → add
      **In-App Purchase**.

## 9. Season 1 launch (the actual switch — do LAST)

- [ ] Firebase console → Firestore → create doc `config/monetization` with
      field `iapEnabled` (boolean) = `true`. This is the kill switch; the
      generic `config/{document}` rule already gives signed-in clients
      read-only access. To pull IAP back out, set it to `false`.
- [ ] App Store Connect: attach the 3 IAP products to a submitted app
      version and provide the IAP review screenshot (products go through
      review with that version).
- [ ] Update the privacy nutrition label: add **Purchases** (App
      Functionality, linked to identity).
- [ ] Verify the Restore Purchases row appears (Pilot Stats → Settings)
      and completes.

## Compliance notes

- **Gacha odds disclosure**: only required if randomized items (gacha
  tickets/packs, Holos that buy packs) become PURCHASABLE. The current
  products are fixed-content, so it does not apply — if that changes, add
  a drop-rates screen to the gacha UI and update the age-rating
  questionnaire's "Simulated Gambling" answer.
- **Privacy label**: "Purchases" must be declared from the first version
  that ships live IAP (step 9), not before.
- Apple requires the **Restore Purchases** button whenever IAP is live —
  it ships in this code, gated behind the same `iapEnabled` flag.
