import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {
  IDLE_DASHBOARD_STATE,
  invalidateOnEconomyChange,
  UNAVAILABLE_DASHBOARD_STATE,
  type HostDashboardState,
  type HostDashboardStore,
} from "@/lite/lib/hostDashboard";
import { hostDashboardStoreForUid } from "@/lite/lib/hostDashboardFirebase";

/**
 * Signed-in dashboard host values. Reads on focus and on foreground; an Arena issue/settle/cancel re-reads
 * immediately (notifyHostEconomyChanged), so Holos / SYNC / levels update without a relaunch.
 * `preview` is the offline QA harness only: no store, no network.
 */
export function useHostDashboard(uid?: string, preview?: HostDashboardState) {
  const [store, setStore] = useState<HostDashboardStore | null>(null);
  // State is tagged with the uid it was read for, so an account switch never renders the previous pilot.
  const [snapshot, setSnapshot] = useState<{ uid?: string; state: HostDashboardState }>({ uid, state: IDLE_DASHBOARD_STATE });
  useEffect(() => {
    if (preview || !uid) { setStore(null); setSnapshot({ uid, state: UNAVAILABLE_DASHBOARD_STATE }); return; }
    const next = hostDashboardStoreForUid(uid);
    setStore(next); setSnapshot({ uid, state: next.getState() });
    const offState = next.subscribe(state => setSnapshot({ uid, state }));
    const offEconomy = invalidateOnEconomyChange(next, uid);
    const offApp = AppState.addEventListener("change", app => { if (app === "active") void next.refresh(); });
    return () => { offState(); offEconomy(); offApp.remove(); next.dispose(); };
  }, [uid, preview]);
  // Runs when Home gains focus and again when the per-uid store is created while focused.
  useFocusEffect(useCallback(() => { if (store) void store.refresh(); }, [store]));
  const retry = useCallback(() => { if (store) void store.invalidate(); }, [store]);
  const state = preview ?? (!uid ? UNAVAILABLE_DASHBOARD_STATE : snapshot.uid === uid ? snapshot.state : IDLE_DASHBOARD_STATE);
  return { state, retry };
}
