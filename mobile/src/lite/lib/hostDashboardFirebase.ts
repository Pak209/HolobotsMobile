import { auth, functions, httpsCallable } from "@/config/firebase";
import { CALLABLE_TIMEOUT_MS } from "../../lib/async";
import { createHostDashboardStore, DASHBOARD_ACCOUNT_REQUEST, DASHBOARD_ITEMS_REQUEST } from "./hostDashboard";

/** Session matched on both sides of the await: a reply that lands after logout / an account switch is dropped. */
function readForUid(uid: string, name: string, request: Record<string, unknown>) {
  const call = httpsCallable<Record<string, unknown>, unknown>(functions, name);
  return async () => {
    if (!uid || auth.currentUser?.uid !== uid) throw new Error("unauthenticated");
    const reply = await call({ ...request });
    if (auth.currentUser?.uid !== uid) throw new Error("unauthenticated");
    return reply.data;
  };
}

/** Read-only: never sends a uid, balance or result; the host derives everything from the session. */
export function hostDashboardStoreForUid(uid: string) {
  return createHostDashboardStore(
    uid,
    readForUid(uid, "desktopAccountSnapshot", DASHBOARD_ACCOUNT_REQUEST),
    readForUid(uid, "desktopItemsHost", DASHBOARD_ITEMS_REQUEST),
    CALLABLE_TIMEOUT_MS,
  );
}
