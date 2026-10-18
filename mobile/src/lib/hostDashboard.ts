/**
 * Lite dashboard host reads (lite-dashboard-live-1). Presentation only: the signed-in dashboard's pilot name,
 * SYNC, Holos, squad levels and zone rows come from two host reads and nothing else:
 *   desktopAccountSnapshot {schemaVersion: "desktop-account-3"}  -> username, syncPoints, zones, holobot levels
 *   desktopItemsHost {schemaVersion: "desktop-items-2", operation: "read"} -> holosTokens
 * A failed, malformed or pre-#124 read is UNAVAILABLE. Never a sample, a profile default, a zero the host did
 * not send, or a UID-derived name. Nothing here decides availability, rewards or balances.
 */

export const DASHBOARD_ACCOUNT_REQUEST = { schemaVersion: "desktop-account-3" } as const;
export const DASHBOARD_ITEMS_REQUEST = { schemaVersion: "desktop-items-2", operation: "read" } as const;
const ACCOUNT_VERSIONS = ["desktop-account-1", "desktop-account-2", "desktop-account-3"] as const;
const ZONE_STATUS_LABELS = ["OPEN", "NOT YET AVAILABLE"] as const;
const MAX_ZONES = 16;

export type DashboardAccountVersion = (typeof ACCOUNT_VERSIONS)[number];
export type DashboardZone = Readonly<{
  zoneId: string;
  displayName: string;
  statusLabel: (typeof ZONE_STATUS_LABELS)[number];
  isOpen: boolean;
  sceneName: string | null;
}>;
export type DashboardAccount = Readonly<{
  uid: string;
  schemaVersion: DashboardAccountVersion;
  /** Host copies a nonblank stored username verbatim, otherwise null (never a UID/email fallback). */
  username: string | null;
  /** Host copies a stored nonnegative safe integer (0 included), otherwise null. */
  syncPoints: number | null;
  /** Host destination rows in host order; null when absent (pre-#124 host) or malformed. */
  zones: readonly DashboardZone[] | null;
  /** Holobot id (lowercase) -> host level. Bots without a valid level are absent. */
  levels: Readonly<Record<string, number>>;
}>;

function record(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}
function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
/** Mirrors toHolobotKey (functions/src/lib/mintingEconomy.ts, mobile/src/lib/minting.ts). */
function holobotKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

function readZone(raw: unknown): DashboardZone | null {
  const r = record(raw);
  if (!r) return null;
  const { zoneId, displayName, statusLabel, isOpen, sceneName } = r;
  if (typeof zoneId !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(zoneId)) return null;
  if (typeof displayName !== "string" || !displayName.trim() || displayName.length > 64) return null;
  if (!ZONE_STATUS_LABELS.includes(statusLabel as DashboardZone["statusLabel"])) return null;
  // The label and the flag are one host fact; a disagreement is not shown as either.
  if (typeof isOpen !== "boolean" || isOpen !== (statusLabel === "OPEN")) return null;
  if (sceneName !== null && (typeof sceneName !== "string" || !sceneName)) return null;
  return Object.freeze({ zoneId, displayName, statusLabel: statusLabel as DashboardZone["statusLabel"], isOpen, sceneName });
}

/** Any malformed row makes the whole list unavailable rather than silently shorter. */
export function readDashboardZones(raw: unknown): readonly DashboardZone[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ZONES) return null;
  const zones = raw.map(readZone);
  if (zones.some(zone => zone === null)) return null;
  const rows = zones as DashboardZone[];
  if (new Set(rows.map(zone => zone.zoneId)).size !== rows.length) return null;
  return Object.freeze(rows);
}

function readLevels(raw: unknown): Readonly<Record<string, number>> {
  const levels: Record<string, number> = {};
  if (!Array.isArray(raw)) return Object.freeze(levels);
  for (const entry of raw) {
    const bot = record(entry);
    if (!bot || typeof bot.name !== "string" || !bot.name.trim()) continue;
    const level = safeCount(bot.level);
    if (level !== null && level >= 1) levels[holobotKey(bot.name)] = level;
  }
  return Object.freeze(levels);
}

/**
 * Throws only when the reply is not this session's account (wrong uid / unknown version / not an object).
 * Old replies without the #124 identity fields are accepted: those fields read as null (UNAVAILABLE).
 */
export function readDashboardAccount(raw: unknown, uid: string): DashboardAccount {
  const r = record(raw);
  if (!r || !uid || r.uid !== uid || !ACCOUNT_VERSIONS.includes(r.schemaVersion as DashboardAccountVersion)) {
    throw new Error("invalid_account_reply");
  }
  const username = typeof r.username === "string" && r.username.trim().length > 0 ? r.username : null;
  return Object.freeze({
    uid,
    schemaVersion: r.schemaVersion as DashboardAccountVersion,
    username,
    syncPoints: safeCount(r.syncPoints),
    zones: readDashboardZones(r.zones),
    levels: readLevels(r.holobots),
  });
}

/** The desktop-items-2 read's holosTokens; anything else throws (shown as UNAVAILABLE). */
export function readDashboardHolos(raw: unknown): number {
  const r = record(raw);
  const holos = safeCount(r?.holosTokens);
  if (!r || r.schemaVersion !== DASHBOARD_ITEMS_REQUEST.schemaVersion || holos === null) throw new Error("invalid_items_reply");
  return holos;
}

// ---------------------------------------------------------------------------------------------------------
// Store: one per authenticated uid. Each read is its own lane so one failure never blanks the other.

export type DashboardReadStatus = "idle" | "loading" | "ready" | "unavailable";
export type HostDashboardState = Readonly<{
  account: DashboardAccount | null;
  accountStatus: DashboardReadStatus;
  holos: number | null;
  holosStatus: DashboardReadStatus;
}>;
export const IDLE_DASHBOARD_STATE: HostDashboardState = Object.freeze({ account: null, accountStatus: "idle", holos: null, holosStatus: "idle" });
/** No session (or a session that cannot read): every host value is UNAVAILABLE. */
export const UNAVAILABLE_DASHBOARD_STATE: HostDashboardState = Object.freeze({ account: null, accountStatus: "unavailable", holos: null, holosStatus: "unavailable" });

export type HostDashboardStore = {
  getState(): HostDashboardState;
  subscribe(listener: (state: HostDashboardState) => void): () => void;
  /** Focus / foreground read. Joins a read already in flight. */
  refresh(): Promise<void>;
  /** Host economy changed (e.g. an Arena settle): an in-flight read may predate it, so its result is dropped and both lanes read again. */
  invalidate(): Promise<void>;
  dispose(): void;
};

type Timeout = <T>(promise: Promise<T>) => Promise<T>;
function timeoutAfter(ms: number): Timeout {
  return <T>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("unavailable")), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

export function createHostDashboardStore(
  uid: string,
  readAccount: () => Promise<unknown>,
  readItems: () => Promise<unknown>,
  timeoutMs = 15_000,
): HostDashboardStore {
  let state: HostDashboardState = IDLE_DASHBOARD_STATE;
  let disposed = false;
  const listeners = new Set<(next: HostDashboardState) => void>();
  const withDeadline = timeoutAfter(timeoutMs);
  const set = (patch: Partial<HostDashboardState>) => {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch });
    listeners.forEach(listener => listener(state));
  };

  function lane<T>(invoke: () => Promise<unknown>, parse: (raw: unknown) => T, ready: (value: T) => Partial<HostDashboardState>, status: "accountStatus" | "holosStatus", failed: Partial<HostDashboardState>) {
    let pending: Promise<void> | null = null;
    let again = false;
    return (force: boolean): Promise<void> => {
      if (disposed || !uid) return Promise.resolve();
      if (pending) { if (force) again = true; return pending; }
      set({ [status]: "loading" } as Partial<HostDashboardState>);
      pending = (async () => {
        try {
          do {
            again = false;
            let patch: Partial<HostDashboardState>;
            try { patch = { ...ready(parse(await withDeadline(Promise.resolve().then(invoke)))), [status]: "ready" }; }
            catch { patch = { ...failed, [status]: "unavailable" }; }
            // A result that raced an invalidation may predate the change: drop it and read again.
            if (!again) set(patch);
          } while (again && !disposed);
        } finally { pending = null; }
      })();
      return pending;
    };
  }

  const account = lane(readAccount, raw => readDashboardAccount(raw, uid), value => ({ account: value }), "accountStatus", { account: null });
  const holos = lane(readItems, readDashboardHolos, value => ({ holos: value }), "holosStatus", { holos: null });
  const both = (force: boolean) => Promise.all([account(force), holos(force)]).then(() => undefined);

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: () => both(false),
    invalidate: () => both(true),
    dispose() { disposed = true; listeners.clear(); },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Economy-change signal: published after a host reply that charged, paid out or refunded (Arena issue /
// settle / cancel / expiry). Carries no values; listeners re-read the host.

const economyListeners = new Set<(uid: string) => void>();
export function notifyHostEconomyChanged(uid: string | undefined) {
  if (uid) economyListeners.forEach(listener => listener(uid));
}
export function subscribeHostEconomyChanged(listener: (uid: string) => void): () => void {
  economyListeners.add(listener);
  return () => { economyListeners.delete(listener); };
}
/** The dashboard hook's wiring: an economy change for this session's uid invalidates its store. */
export function invalidateOnEconomyChange(store: Pick<HostDashboardStore, "invalidate">, uid: string): () => void {
  return subscribeHostEconomyChanged(changed => { if (changed === uid) void store.invalidate(); });
}
/** Arena match states whose host reply moved Holos / SYNC / EXP (#121: issue charges, settle pays, cancel/expiry refunds). */
export const ARENA_ECONOMY_STATES: readonly string[] = ["issued", "settled", "cancelled", "expired"];
/** "<matchId>:<state>" for an Arena reply in an economy state, else null. One notification per transition. */
export function arenaEconomyChange(reply: { matchId?: string | null; match?: { state?: string } | null } | null | undefined): string | null {
  const state = reply?.match?.state;
  return reply?.matchId && state && ARENA_ECONOMY_STATES.includes(state) ? `${reply.matchId}:${state}` : null;
}

// ---------------------------------------------------------------------------------------------------------
// Presenter. Copy marked PLACEHOLDER is for Lex; layout is the approved 10-16 header/footer.

export type DashboardZoneRow = Readonly<{ zoneId: string; name: string; status: string; open: boolean }>;
export type DashboardPresentation = Readonly<{
  /** PLACEHOLDER copy: "PILOT <username>". */
  pilot: string;
  holos: string;
  sync: string;
  /** True when any host read failed (offer a retry). */
  unavailable: boolean;
  zonesSummary: string;
  zones: readonly DashboardZoneRow[] | null;
  levels: Readonly<Record<string, number>> | null;
}>;

export function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function valueText(status: DashboardReadStatus, value: string | null, label: string): string {
  if (value !== null) return value;
  return status === "idle" || status === "loading" ? `${label} …` : `${label} UNAVAILABLE`;
}

export function presentHostDashboard(state: HostDashboardState): DashboardPresentation {
  const { account, accountStatus, holos, holosStatus } = state;
  const zones = account?.zones ?? null;
  const open = zones?.filter(zone => zone.isOpen).length ?? 0;
  const accountPending = !account && (accountStatus === "idle" || accountStatus === "loading");
  return Object.freeze({
    pilot: account?.username ? `PILOT ${account.username}` : valueText(account ? "unavailable" : accountStatus, null, "PILOT"),
    holos: valueText(holosStatus, holos === null ? null : `${formatCount(holos)} HOLOS`, "HOLOS"),
    sync: valueText(account ? "unavailable" : accountStatus, account?.syncPoints == null ? null : `${formatCount(account.syncPoints)} SYNC`, "SYNC"),
    unavailable: accountStatus === "unavailable" || holosStatus === "unavailable",
    // PLACEHOLDER copy.
    zonesSummary: zones ? `${open} OF ${zones.length} OPEN` : accountPending ? "ZONES …" : "ZONES UNAVAILABLE",
    zones: zones ? Object.freeze(zones.map(zone => Object.freeze({ zoneId: zone.zoneId, name: zone.displayName, status: zone.statusLabel, open: zone.isOpen }))) : null,
    levels: account ? account.levels : null,
  });
}

/**
 * Travel squad entry line: membership from the travel squad host (null = not read yet / failed),
 * LV from the account snapshot (null = snapshot unavailable).
 */
export function presentSquadTitle(holobotIds: readonly string[] | null, levels: Readonly<Record<string, number>> | null): string {
  if (!holobotIds) return "CONNECT TO VIEW SQUAD";
  if (!holobotIds.length) return "NO HOLOBOTS ASSIGNED";
  const names = holobotIds.map(id => id.toUpperCase());
  if (!levels) return `${names.join(" · ")} · LV UNAVAILABLE`;
  // A bot the account snapshot has no level for shows its name only: no bare placeholder (L22).
  return holobotIds.map((id, i) => (levels[id] === undefined ? names[i] : `${names[i]} LV ${levels[id]}`)).join(" · ");
}
