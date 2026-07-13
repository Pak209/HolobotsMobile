import { getAuth } from "firebase-admin/auth";
import { HttpsError, onCall } from "firebase-functions/v2/https";

/**
 * Mints a Firebase custom token for the CALLER so the app's embedded web
 * sections (holobots-fun in a WebView) can sign in as the same account.
 *
 * History: this callable used to be deployed from the holobots-fun repo,
 * but its source was lost and a past unscoped deploy removed it from
 * production entirely. The mobile app is its only caller
 * (mobile/src/lib/webAuthBridge.ts, injected by WebSectionScreen), so it
 * now lives here, in the caller's repo, inside the scoped deploy list.
 */
export const createWebviewBridgeToken = onCall(async (request): Promise<{ token: string }> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to open the web sections.");
  }

  const token = await getAuth().createCustomToken(uid);
  return { token };
});
