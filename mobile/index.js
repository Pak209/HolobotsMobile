// Project-local entry. `expo/AppEntry` imports `../../App` relative to the
// expo package's real path, so a node_modules symlinked from another checkout
// resolved App outside this project (Metro: "Unable to resolve ../../App").
// On main, package.json "main" stays `expo/AppEntry`, so native Release builds
// (resolveAppEntry) do not use this file; scripts/package-offline-preview.mjs
// passes it as --entry-file.
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
