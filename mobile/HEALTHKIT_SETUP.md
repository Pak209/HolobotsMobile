# Holobots Fitness Tracking

## Current setup

The fitness screen now reads from a unified workout hook:

- `src/hooks/useWorkout.ts`
- live device data: `expo-location` + `expo-sensors` `Pedometer`

The screen uses that state for:

- speedometer needle
- speed text
- goal timer
- goal progress bar
- distance
- rewards
- sync points

## Why this is not pure HealthKit yet

HealthKit is best for:

- reading historical health data
- writing completed workouts/summaries
- syncing health records with the Health app

For live workout speed, the better source is location updates. For live steps, the better foreground source is the pedometer/Core Motion layer. This app is set up that way so the UI can update in real time during a workout.

## iOS configuration added

- `NSHealthShareUsageDescription`
- `NSHealthUpdateUsageDescription`
- `NSLocationWhenInUseUsageDescription`
- `NSMotionUsageDescription`
- `com.apple.developer.healthkit` entitlement

## Testing

### Real iPhone

Use a real iPhone to test:

- live speed from location
- step counting permissions
- real movement updates
- HealthKit availability and authorization

Expected flow:

1. Build and run the app on an iPhone.
2. Open the Fitness screen.
3. Tap `GO`.
4. Grant Location and Motion permissions.
5. Walk outside or simulate movement with test routes.

### Simulator

The simulator is now only for layout and basic app-flow verification.
It is no longer a source of workout mock data for pre-release builds.

## Next step for full HealthKit support

Add a native iOS HealthKit bridge that:

1. checks `HKHealthStore.isHealthDataAvailable()`
2. requests HealthKit authorization
3. reads historical workout/step summaries
4. writes completed workout results back to HealthKit
5. syncs completed sessions to Firebase / backend

The UI should continue to read from the workout hook. Only the data source behind the hook should change.
