# iOS Next Steps

## Local setup

From `mobile/`:

```bash
npm install
npx expo start
npx expo run:ios
```

## Xcode capabilities needed

- HealthKit
- Background Modes
- Background fetch

## Immediate implementation order

1. Install the mobile dependencies.
2. Confirm the tab shell boots in the iOS simulator.
3. Add Firebase config for the iOS app.
4. Add HealthKit permission + step-reading service.
5. Connect the Fitness tab to `syncFitnessActivity`.
6. Add auth token/session handoff for the `holobots.fun` WebView tab.

## Review risk

Do not ship as a thin website wrapper.

The native value proposition should be:

- HealthKit step tracking
- native Sync/Fitness dashboard
- background sync to Holobots backend
- then web content inside the portal tab for non-native game surfaces
