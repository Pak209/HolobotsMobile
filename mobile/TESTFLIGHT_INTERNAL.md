# Internal TestFlight Runbook

This is the fastest path to a real internal TestFlight build for `Holobots Mobile`.

## Current build target

- Version: `0.1.1`
- Build: `2`
- Bundle ID: `fun.holobots.mobile`

## Happy path this build supports

- real iPhone workout session
- live location speed
- live pedometer steps
- workout timer and reward updates in the Fitness screen
- Firebase sync on workout pause/completion for signed-in users

## Important current limitation

- The live workout path uses device location plus pedometer in the foreground.
- Apple Health / HealthKit history writeback is still the next layer, not the current source of truth.
- Backend sync requires a Firebase-authenticated user in the app.

## Before uploading

1. Test on a real iPhone.
2. Confirm the app prompts for:
   - location
   - motion / step access
3. Start a workout and confirm:
   - speed changes while moving
   - timer counts down
   - Sync Points increase
   - pausing resets speed to `0 km/h`
4. Pause or complete the workout and confirm the dev status strip reports a successful sync.

## Xcode upload path

1. Open:
   - `/Users/danielpak/Desktop/New-project/mobile/ios/HolobotsMobile.xcworkspace`
2. Select:
   - target: `HolobotsMobile`
   - Any iOS Device (arm64)
3. In Signing & Capabilities:
   - confirm your Apple team is selected
   - confirm HealthKit entitlement remains enabled
4. Product -> Archive
5. In Organizer:
   - Validate App
   - Distribute App
   - App Store Connect
   - Upload

## App Store Connect

After upload:

1. Open the app record in App Store Connect.
2. Go to TestFlight.
3. Add the new build to Internal Testing.
4. Fill in export compliance if prompted.
5. Add internal testers immediately.

## If upload time gets tight

Prefer this order:

1. Internal TestFlight only
2. Real-device sanity pass
3. External testing later
