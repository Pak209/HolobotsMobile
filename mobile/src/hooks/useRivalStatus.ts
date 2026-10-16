import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { functions, httpsCallable } from "@/config/firebase";
import { withTimeout, CALLABLE_TIMEOUT_MS } from "@/lib/async";
import { formatRivalCountdown, nextRivalCooldown, type RivalCooldown, type RivalHudStatus } from "@/lib/rivalHud";

export type RivalHudPreview = { status: RivalHudStatus; cooldowns?: RivalCooldown[] };
const observations = new Map<string, Map<string, number>>();
const statuses = new Map<string, RivalHudStatus>();
const statusRevisions = new Map<string, number>();
const listeners = new Set<() => void>();
/** Only call after a host settle or a host cooldown refusal. Scope to the authenticated uid. */
export function publishRivalCooldown(uid: string, pilotId: string, endsAtMs: number) {
  if (!uid || !pilotId || !Number.isFinite(endsAtMs)) return;
  const entries = observations.get(uid) ?? new Map<string, number>();
  entries.set(pilotId, endsAtMs); observations.set(uid, entries);
  listeners.forEach(listener => listener());
}
/** Share the host's returned ladder status immediately after settlement. */
export function publishRivalStatus(uid: string, status: RivalHudStatus) {
  if (!uid || !status || !Number.isFinite(status.tier)) return;
  statusRevisions.set(uid, (statusRevisions.get(uid) ?? 0) + 1);
  statuses.set(uid, status); listeners.forEach(listener => listener());
}
const readStatus = httpsCallable<{ operation: "status"; schemaVersion: "rival-battle-3" }, { status: RivalHudStatus }>(functions, "rivalBattleHost");

export function useRivalStatus(uid?: string, preview?: RivalHudPreview) {
  const [status, setStatus] = useState<RivalHudStatus | null>(preview?.status ?? null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const lifecycle = useRef({ mounted: false, uid, request: 0 });
  lifecycle.current.uid = uid;
  useEffect(() => {
    lifecycle.current.mounted = true;
    return () => { lifecycle.current.mounted = false; lifecycle.current.request += 1; };
  }, []);
  const refresh = useCallback(async () => {
    const request = ++lifecycle.current.request;
    if (preview) { setStatus(preview.status); return; }
    if (!uid) { setStatus(null); return; }
    // A settlement can publish newer host state while this read is in flight.
    // Protect both success and failure so neither replaces that publication.
    const statusRevision = statusRevisions.get(uid) ?? 0;
    const current = () => lifecycle.current.mounted && lifecycle.current.uid === uid && lifecycle.current.request === request && (statusRevisions.get(uid) ?? 0) === statusRevision;
    try {
      const { data } = await withTimeout(readStatus({ operation: "status", schemaVersion: "rival-battle-3" }), CALLABLE_TIMEOUT_MS, "Rival status timed out");
      if (!current()) return;
      if (!data.status || !Number.isFinite(data.status.tier)) throw new Error("Rival status unavailable");
      publishRivalStatus(uid, data.status); setStatus(data.status); setError(null);
    } catch { if (current()) setError("Connect to refresh rival tier"); }
  }, [uid, preview]);
  useEffect(() => { setStatus(preview?.status ?? statuses.get(uid || "") ?? null); setError(null); }, [uid, preview]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    return () => subscription.remove();
  }, [refresh]);
  useEffect(() => {
    const update = () => { setNow(Date.now()); if (!preview) setStatus(statuses.get(uid || "") ?? null); };
    listeners.add(update); const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { listeners.delete(update); clearInterval(timer); };
  }, [uid, preview]);
  const observed = preview?.cooldowns ?? [...(observations.get(uid || "") ?? [])].map(([pilotId, endsAtMs]) => ({ pilotId, endsAtMs }));
  const cooldown = nextRivalCooldown(observed, now);
  return { status, error, refresh, cooldown, countdown: cooldown ? formatRivalCountdown(cooldown.endsAtMs, now) : null };
}

/** A read-only city subscription: no status call, no fabricated expiry, no fixture network. */
export function useCityRivalCooldowns(uid?: string, preview = false) {
  const [now, setNow] = useState(Date.now());
  const [, setRevision] = useState(0);
  useEffect(() => {
    const update = () => { setNow(Date.now()); setRevision(value => value + 1); };
    listeners.add(update);
    const timer = setInterval(update, 1000);
    return () => { listeners.delete(update); clearInterval(timer); };
  }, []);
  return Object.fromEntries(preview ? [] : [...(observations.get(uid || "") ?? [])]
    .filter(([, end]) => end > now)
    .map(([id, end]) => [id, formatRivalCountdown(end, now)]));
}
