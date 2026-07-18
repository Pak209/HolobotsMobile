import { doc, getDoc } from "firebase/firestore";

import { db } from "@/config/firebase";
import { withTimeout } from "@/lib/async";

/**
 * Remote monetization config: `config/monetization` in Firestore, editable
 * only from the console/Admin SDK (rules deny client writes).
 *
 * `iapEnabled` is the Season 1 kill switch for the whole purchases layer:
 * absent doc, offline, or anything but literal `true` means purchases stay
 * DORMANT — no SDK init, no offerings, no store UI. Flipping the ONE
 * console field turns IAP on for every installed build, no app update.
 */

const CONFIG_DOC_PATH = "config/monetization";
const FETCH_TIMEOUT_MS = 5_000;

export type MonetizationConfig = {
  iapEnabled: boolean;
};

const DISABLED: MonetizationConfig = { iapEnabled: false };

let cachedConfig: MonetizationConfig | undefined;

export async function getMonetizationConfig(): Promise<MonetizationConfig> {
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }

  try {
    const snapshot = await withTimeout(
      getDoc(doc(db, CONFIG_DOC_PATH)),
      FETCH_TIMEOUT_MS,
      "Config fetch timed out.",
    );
    cachedConfig = { iapEnabled: snapshot.exists() && snapshot.data()?.iapEnabled === true };
  } catch {
    // Offline or unreadable: stay dormant now, retry on the next call.
    return cachedConfig ?? DISABLED;
  }

  return cachedConfig;
}
