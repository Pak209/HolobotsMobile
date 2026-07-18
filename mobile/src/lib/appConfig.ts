import { doc, getDoc } from "firebase/firestore";

import { db } from "@/config/firebase";
import { withTimeout } from "@/lib/async";

/**
 * Remote app-distribution config: `config/appDistribution` in Firestore,
 * editable only from the console/Admin SDK (rules deny client writes).
 *
 * `inviteUrl` is where SHARE INVITE points recruits — the TestFlight
 * public-beta link during beta, swapped to the App Store URL at launch by
 * editing ONE console field. No app update, and every installed build
 * (old and new) starts sharing the new link immediately.
 */

const CONFIG_DOC_PATH = "config/appDistribution";
const FETCH_TIMEOUT_MS = 5_000;

let cachedInviteUrl: string | null | undefined;

export async function getInviteUrl(): Promise<string | null> {
  if (cachedInviteUrl !== undefined) {
    return cachedInviteUrl;
  }

  try {
    const snapshot = await withTimeout(
      getDoc(doc(db, CONFIG_DOC_PATH)),
      FETCH_TIMEOUT_MS,
      "Config fetch timed out.",
    );
    const url = snapshot.exists() ? String(snapshot.data()?.inviteUrl || "") : "";
    cachedInviteUrl = url.startsWith("https://") ? url : null;
  } catch {
    // Offline or unset: share without a link rather than blocking the sheet.
    return cachedInviteUrl ?? null;
  }

  return cachedInviteUrl;
}
