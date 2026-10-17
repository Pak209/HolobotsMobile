// Project-local entry. `expo/AppEntry` imports `../../App` relative to the
// expo package's real path, so a node_modules symlinked from another checkout
// resolved App outside this project (Metro: "Unable to resolve ../../App").
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
