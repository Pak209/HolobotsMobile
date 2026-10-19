# watch-visual-pass-1 (2026-10-18)

Pak ruled in DECISIONS #72.7 (D5) to keep the Watch app embedded and give it a visual pass so it matches the HoloCity phone app. This change covers colours, type and icons only. It has no new features, no behaviour change, and no HealthKit, entitlement or data-flow change.

- Base: `main` at `f6d77a2`, checked against GitHub `refs/heads/main`.
- Target: `HolobotsWatch Watch App` (`mobile/ios/HolobotsWatch Watch App/`).
- Evidence: `~/HolobotsVault/QA/2026-10-18-watch-visual-pass-1/GATE_SHEET.png`. Row 1 is BEFORE (main) and row 2 is AFTER.

## What changed

| Area | Before | After |
|---|---|---|
| Palette | Each view had its own `Color(red:…)` gold, cream and near-black constants | `HoloTheme.swift` (`Holo.*`) reads the colorsets in `Assets.xcassets`, mirrored from `mobile/src/lite/theme.ts` |
| Background | Gold-to-black diagonal gradient | raised → navy → carbon gradient, with cyan slashes at 6–8 % |
| Accent | Gold `#FACC1A` | HoloCity cyan `#62DDE8`. `AccentColor` was empty and is now cyan too |
| Type | SF Pro black/heavy, monospaced and rounded | HoloDisplay is Rajdhani Medium (labels, values). HoloBody is Saira Regular (sentences) |
| Change-holobot icon | SF Symbol `arrow.triangle.2.circlepath` | Phone `assets/figma/fitness/changeIconBack.png`, tinted cyan as a template |
| Reward row badges | Text badges "SP", "H", "EXP" | Phone `rewardSync` / `rewardHolos` / `rewardExp` PNGs, the same icons as the lite `BattleResultsModal` |
| Speedometer art | Gold PNGs | The same PNGs with `.hueRotation(136°)`, which moves the gold onto the cyan accent |
| Apple Health heart | `.red` | `Holo.danger` `#FF603D`. Still `heart.fill`, still beside the HealthKit text (App Review 2.5.1) |

Every on-screen string is unchanged. No string contains "host" (DECISIONS #71).

Kept as SF Symbols because no phone asset fits them: play/pause, checkmark, iPhone, and the heart. The settings, walk, treadmill and battery glyphs were already custom vector paths, so they only take the new colour.

Layout: the only spacing change is the Rewards top `Spacer(minLength:)`, from 30 to 22. Rajdhani's taller line box pushed "Workout saved to Apple Health" off the bottom of the 46 mm screen, and this brings it back.

## Palette and contrast (WCAG 2.x)

| Foreground | carbon `#101318` | navy `#081723` | raised `#102532` | Use |
|---|---|---|---|---|
| text `#F4F7FA` | 17.31 | 16.88 | 14.66 | primary text |
| muted `#A9BDC8` | 9.57 | 9.33 | 8.10 | secondary text (it replaced every `cream.opacity(…)` text) |
| accent `#62DDE8` | 11.55 | 11.26 | 9.77 | headings, values, icons |
| danger `#FF603D` | 6.20 | 6.04 | 5.25 | Health heart |
| carbon on accent | 11.55 | | | button labels on cyan fills |

All text pairs are ≥ 4.5:1. `border #304956` (1.9:1) appears only on strokes and empty session dots, never on text.

## Fonts and licences

- `Fonts/Rajdhani-Medium.ttf` and `Fonts/Saira-Regular.ttf` are byte-identical copies of `mobile/assets/fonts/`. Both use the **SIL Open Font License 1.1**, which allows bundling and redistribution inside an app as long as the font is not sold on its own. The licence texts ship next to them (`Fonts/*-OFL.txt`).
- The Saira file is a static weight-400 instance, but its name table gives the PostScript name `Saira-Thin`. `Holo.body` therefore asks for `"Saira-Thin"`, and that name renders Regular.
- **Registration:** the Watch `Info.plist` has no `UIAppFonts` entry, and lane lite-release-prep-1 owns that file. So `Holo.registerFonts()` calls `CTFontManagerRegisterFontsForURL(.process)` at the start of `HolobotsWatchApp.init` (watchOS 2.0+). If the fonts are ever missing, SwiftUI falls back to the system font. Xcode `#Preview`s skip `init` and show system type.

## Project file

**No `project.pbxproj` change.** The Watch target is a `PBXFileSystemSynchronizedRootGroup`, so the new Swift file, the colorsets, the imagesets and `Fonts/` join the target automatically. Version/build settings, `Info.plist`, entitlements and the privacy manifest are untouched.

## Build

One bounded unsigned build of the Watch App target on each arm. The scheme also builds the `HolobotsWatch` container, which fails on the simulator with "Watch-Only Application Stubs are not available", so the build names the target instead:

```
xcodebuild -project HolobotsMobile.xcodeproj -target "HolobotsWatch Watch App" \
  -configuration Debug -sdk watchsimulator -arch arm64 CODE_SIGNING_ALLOWED=NO build
```

- BEFORE (`f6d77a2`): **BUILD SUCCEEDED**, 6 warnings, all already on main (`WorkoutManager`/`WorkoutViewModel` Sendable, AppIntents metadata).
- AFTER: **BUILD SUCCEEDED** (13 s). No new warnings. The `.app` contains `Assets.car`, both `.ttf` files and both OFL texts.

## Capture

Simulator: Apple Watch Series 11 (46 mm), watchOS 26.5, Xcode 26.6. Load averages at capture were 18–101 and do not affect stills.

The simulator control tool had no device access, so taps were not possible. To reach screens other than launch, a **scratch-only harness** made a copy of the Watch sources. In that copy, `ContentView` picks a screen from `SIMCTL_CHILD_WATCH_QA_SCREEN`, and `WorkoutSettingsView` is made non-private. The harness never touched this branch. The same harness ran on both arms, so before and after match. AFTER 1 also matches the real committed build's launch screen (`after-real-pre.png` in the vault).

| Cell | Before | After |
|---|---|---|
| 1 Pre-workout (launch) | gold field, SF black type, SF "circlepath" arrows | carbon/navy field, Rajdhani type, cyan phone change icon |
| 2 Active workout (idle, 5:00) | gold field, gold gauge and needle | navy field, cyan gauge and needle, cyan play button |
| 3 Settings sheet | gold headings, yellow selection dot | cyan headings, cyan selection, Saira subtitles |
| 4 Sync result | gold frame, "SP/H/EXP" text badges | cyan frame, phone reward icons, cyan COLLECT |

Not captured: the holobot picker (the simulator has no owned holobots), the "ON IPHONE" presence state, and running/paused states. They use the same tokens.

## Not verified

- A physical Watch, and the 40/41/42 mm screen sizes, where the Rewards bottom line is the tightest.
- The always-on/dimmed rendering of the hue-rotated gauge.
