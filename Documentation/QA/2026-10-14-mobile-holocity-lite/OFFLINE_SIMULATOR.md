# Simulator image assets — 2026-10-15

The installed Debug app had neither `main.jsbundle` nor bundled static assets, and the Metro asset server on port 8083 was stopped. That left image views blank even while already-loaded bot geometry remained visible. The source Sync PNG, park JPEG and headshots were present.

Repackaged the existing clone-local simulator binary with Expo `export:embed`, supplying **both** `--bundle-output` and `--assets-dest`. Installed it on iPhone 17 Pro / iOS 26.5 and launched it without Metro. Home now displays Sync; CityBattle displays the park/grass background and both portraits. Screenshots: [Home](screenshots/Home.png), [CityBattle](screenshots/CityBattle.png). Export copied 239 assets and succeeded. W15 screen/receipt files were not edited.

Reproduce from the repository root after building the simulator app:

```sh
node mobile/scripts/package-offline-preview.mjs
```

The default target is `.work/DerivedData/Build/Products/Debug-iphonesimulator/HolobotsMobile.app`; an alternative clone-local simulator `.app` path can be passed as the first argument. The script rejects device builds and paths outside the clone, exports the opt-in offline fixture, and verifies the bundle plus the two reported missing images. It only packages; use the simulator install/launch tools afterward.

The current native AppDelegate prefers a local `main.jsbundle` when present. Preserve that loader when rebuilding the native project. This is a Debug simulator preview, not a release artifact. To resume Metro development, remove the embedded `main.jsbundle` from the clone-local build product and reinstall the development app; otherwise the embedded snapshot intentionally wins over Metro. Re-run packaging and reinstall after JS changes when testing offline.
