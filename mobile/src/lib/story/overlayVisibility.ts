/**
 * Round G: pure visibility rule for the Overworld loading overlay.
 *
 * The overlay is an OPAQUE full-screen View above the WebView; a stuck
 * `pageLoading` (e.g. a missed react-native-webview onLoadEnd) would both
 * blank the screen and eat every touch. A received BRIDGE_HELLO proves the
 * page's JS is alive, so the overlay must be gone from that point regardless
 * of load-callback delivery — stuck-overlay-after-handshake is impossible by
 * construction.
 */
export type LoadingOverlayState = {
  /** Origin gate failed — the dedicated blocked overlay owns the screen. */
  blocked: boolean;
  storeReady: boolean;
  pageLoading: boolean;
  loadError: boolean;
  helloReceived: boolean;
};

export function shouldShowLoadingOverlay(state: LoadingOverlayState): boolean {
  if (state.blocked || state.loadError) {
    return false;
  }
  if (state.helloReceived) {
    return false;
  }
  return !state.storeReady || state.pageLoading;
}
