/**
 * Quests and training through the City (lite-progression-host-1). Presentation only: the host decides.
 *
 * Host #145 (host-economy-hardening-2, critic review S3): startQuestRun / startTrainingSession validate the start,
 * debit dailyEnergy and stamp the run with the HOST clock in the server-only users/{uid}.progressionTimers
 * (schema "progression-timers-1"); claimQuestRun / claimTrainingSession pay only against that record. So this client
 * never writes a run's endsAt, holobotPower, stat boosts or the energy debit. It shows the host's end time from that
 * record (read through the owner's user-doc listener; clients cannot write the field) and maps every refusal code to
 * City copy.
 *
 * Legacy runs: an older app wrote rewardSystem.activeQuests / activeTraining itself (client timers). The host claims
 * such a run only while its env has HOLOCITY_LEGACY_QUEST_TIMERS=1; after that it refuses `not_started_on_host`, and
 * the card says so honestly. A legacy run is never hidden and never re-timed here.
 *
 * Copy marked PLACEHOLDER is for Lex (DECISIONS #71: "the City", never "host" on screen).
 */
import { QUEST_DEFINITIONS, TRAINING_COURSES, type QuestId, type TrainingCourseId } from "@/lib/progressionSystems";

export const PROGRESSION_TIMERS_SCHEMA = "progression-timers-1";
/** Host MAX_ACTIVE_QUESTS: the slot count the host enforces over its own records. */
export const CITY_QUEST_SLOTS = 3;
const QUEST_RUN_ID = /^qr_[A-Za-z0-9_-]{8,80}$/;
const TRAINING_RUN_ID = /^tr_[A-Za-z0-9_-]{8,80}$/;
/** The host's readStartCommand rule for requestId. */
export const PROGRESSION_REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;

export type CityQuestRun = Readonly<{
  runId: string;
  questId: QuestId;
  holobotName: string;
  holobotPower: number;
  startedAtMs: number;
  endsAtMs: number;
}>;
export type CityTrainingRun = Readonly<{
  runId: string;
  courseId: TrainingCourseId;
  holobotName: string;
  statBoosts: Readonly<Record<string, number>>;
  expReward: number;
  startedAtMs: number;
  endsAtMs: number;
}>;
export type CityTimers =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "ready"; quests: readonly CityQuestRun[]; training: CityTrainingRun | null }>;

export const CITY_TIMERS_LOADING: CityTimers = Object.freeze({ status: "loading" });
export const CITY_TIMERS_UNAVAILABLE: CityTimers = Object.freeze({ status: "unavailable" });

type Data = Record<string, unknown>;
const object = (x: unknown): x is Data => !!x && typeof x === "object" && !Array.isArray(x);
const whole = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const name = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isQuestId = (x: unknown): x is QuestId => QUEST_DEFINITIONS.some((quest) => quest.id === x);
const isCourseId = (x: unknown): x is TrainingCourseId => TRAINING_COURSES.some((course) => course.id === x);

function questRun(raw: unknown, key: string): CityQuestRun | null {
  if (!object(raw) || raw.runId !== key || !QUEST_RUN_ID.test(key) || !isQuestId(raw.questId) || !name(raw.holobotName)
    || !whole(raw.holobotPower) || !whole(raw.startedAtMs) || !whole(raw.endsAtMs) || raw.endsAtMs <= raw.startedAtMs) return null;
  return Object.freeze({ runId: key, questId: raw.questId, holobotName: raw.holobotName, holobotPower: raw.holobotPower, startedAtMs: raw.startedAtMs, endsAtMs: raw.endsAtMs });
}

function trainingRun(raw: unknown): CityTrainingRun | null {
  if (!object(raw) || typeof raw.runId !== "string" || !TRAINING_RUN_ID.test(raw.runId) || !isCourseId(raw.courseId) || !name(raw.holobotName)
    || !object(raw.statBoosts) || Object.values(raw.statBoosts).some((value) => !whole(value)) || !whole(raw.expReward)
    || !whole(raw.startedAtMs) || !whole(raw.endsAtMs) || raw.endsAtMs <= raw.startedAtMs) return null;
  return Object.freeze({
    runId: raw.runId, courseId: raw.courseId, holobotName: raw.holobotName, statBoosts: Object.freeze({ ...(raw.statBoosts as Record<string, number>) }),
    expReward: raw.expReward, startedAtMs: raw.startedAtMs, endsAtMs: raw.endsAtMs,
  });
}

/**
 * users/{uid}.progressionTimers as the host wrote it. Absent = no City runs (ready, empty). Anything malformed makes the
 * whole record UNAVAILABLE (the host fails closed on it too), never a partial list or a guessed time.
 */
export function readCityTimers(raw: unknown): CityTimers {
  if (raw === undefined || raw === null) return Object.freeze({ status: "ready", quests: Object.freeze([]), training: null });
  if (!object(raw) || raw.schemaVersion !== PROGRESSION_TIMERS_SCHEMA || !object(raw.quests) || (raw.training !== null && !object(raw.training))) return CITY_TIMERS_UNAVAILABLE;
  const quests: CityQuestRun[] = [];
  for (const [key, entry] of Object.entries(raw.quests)) {
    const run = questRun(entry, key);
    if (!run) return CITY_TIMERS_UNAVAILABLE;
    quests.push(run);
  }
  if (quests.length > CITY_QUEST_SLOTS) return CITY_TIMERS_UNAVAILABLE;
  const training = raw.training === null ? null : trainingRun(raw.training);
  if (raw.training !== null && !training) return CITY_TIMERS_UNAVAILABLE;
  quests.sort((a, b) => a.startedAtMs - b.startedAtMs || a.runId.localeCompare(b.runId));
  return Object.freeze({ status: "ready", quests: Object.freeze(quests), training });
}

// ---------------------------------------------------------------------------------------------------------
// Cards: what the Quests / Training screens show.

export type RunState = "running" | "ready" | "legacy_running" | "legacy_ready" | "legacy_refused";
export type QuestCard = Readonly<{
  runId: string;
  source: "city" | "legacy";
  questId: QuestId;
  holobotName: string;
  /** City: the host's end time. Legacy: the end time the older app wrote (display only; the City decides). Null = unreadable. */
  endsAtMs: number | null;
  state: RunState;
}>;
export type TrainingCard = Readonly<{
  /** City run id, or the legacy record's identity key (for the refused set). */
  runId: string;
  source: "city" | "legacy";
  courseId: TrainingCourseId;
  holobotName: string;
  statBoosts: Readonly<Record<string, number>>;
  expReward: number;
  endsAtMs: number | null;
  state: RunState;
}>;

function endsAt(raw: unknown): number | null {
  const ms = typeof raw === "string" && raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : null;
}
function legacyState(id: string, endsAtMs: number | null, refused: ReadonlySet<string>, nowMs: number): RunState {
  if (refused.has(id)) return "legacy_refused";
  return endsAtMs !== null && nowMs >= endsAtMs ? "legacy_ready" : "legacy_running";
}
function rewardSystemOf(raw: unknown): Data {
  return object(raw) ? raw : {};
}

/**
 * City runs (host records, host clock) first, then legacy runs: rewardSystem.activeQuests entries the older app wrote
 * itself. The host's own display copies there carry the City run id (qr_…) and are never shown twice or as legacy.
 */
export function buildQuestCards(timers: CityTimers, rewardSystem: unknown, refused: ReadonlySet<string>, nowMs: number): QuestCard[] {
  const city: QuestCard[] = timers.status === "ready"
    ? timers.quests.map((run) => Object.freeze({ runId: run.runId, source: "city" as const, questId: run.questId, holobotName: run.holobotName, endsAtMs: run.endsAtMs, state: nowMs >= run.endsAtMs ? "ready" as const : "running" as const }))
    : [];
  const stored = rewardSystemOf(rewardSystem).activeQuests;
  const legacy: QuestCard[] = [];
  for (const entry of Array.isArray(stored) ? stored : []) {
    if (!object(entry) || typeof entry.id !== "string" || !entry.id || entry.id.startsWith("qr_") || !isQuestId(entry.questId) || !name(entry.holobotName)) continue;
    const ends = endsAt(entry.endsAt);
    legacy.push(Object.freeze({ runId: entry.id, source: "legacy", questId: entry.questId, holobotName: entry.holobotName, endsAtMs: ends, state: legacyState(entry.id, ends, refused, nowMs) }));
  }
  return [...city, ...legacy];
}

/** The refused-set key of a legacy training record (it carries no id). */
export function legacyTrainingKey(record: Data): string {
  return `legacy-training:${String(record.courseId)}:${String(record.holobotName).toUpperCase()}:${String(record.startedAt)}`;
}

/**
 * The City's training record when it has one. Otherwise rewardSystem.activeTraining is a LEGACY run: the host writes its
 * display copy there in the same transaction as its own record and clears both on claim, so a copy without a record is
 * the older app's. Until the City record is readable nothing is shown (a display copy cannot be told apart then).
 */
export function buildTrainingCard(timers: CityTimers, rewardSystem: unknown, refused: ReadonlySet<string>, nowMs: number): TrainingCard | null {
  if (timers.status !== "ready") return null;
  const run = timers.training;
  if (run) {
    return Object.freeze({ runId: run.runId, source: "city", courseId: run.courseId, holobotName: run.holobotName, statBoosts: run.statBoosts, expReward: run.expReward, endsAtMs: run.endsAtMs, state: nowMs >= run.endsAtMs ? "ready" : "running" });
  }
  const stored = rewardSystemOf(rewardSystem).activeTraining;
  if (!object(stored) || !isCourseId(stored.courseId) || !name(stored.holobotName)) return null;
  const key = legacyTrainingKey(stored);
  const ends = endsAt(stored.endsAt);
  const boosts = object(stored.statBoosts) ? Object.fromEntries(Object.entries(stored.statBoosts).filter(([, value]) => whole(value))) as Record<string, number> : {};
  return Object.freeze({ runId: key, source: "legacy", courseId: stored.courseId, holobotName: stored.holobotName, statBoosts: Object.freeze(boosts), expReward: whole(stored.expReward) ? stored.expReward : 0, endsAtMs: ends, state: legacyState(key, ends, refused, nowMs) });
}

/** Holobots on a City quest (the host's holobot_busy rule counts only its own records). */
export function cityBusyHolobots(timers: CityTimers): ReadonlySet<string> {
  return new Set(timers.status === "ready" ? timers.quests.map((run) => run.holobotName.toUpperCase()) : []);
}

export type StartBlock = "checking" | "unavailable" | "no_holobot" | "slots_full" | "holobot_busy" | "energy" | "training_active" | "legacy_training";

/** Why SEND is disabled, from what the City last recorded. A hint only: the City still decides every start. */
export function questStartBlock(timers: CityTimers, holobotName: string | null, energy: number, energyCost: number): StartBlock | null {
  if (timers.status === "loading") return "checking";
  if (timers.status === "unavailable") return "unavailable";
  if (!holobotName) return "no_holobot";
  if (timers.quests.length >= CITY_QUEST_SLOTS) return "slots_full";
  if (cityBusyHolobots(timers).has(holobotName.toUpperCase())) return "holobot_busy";
  if (energy < energyCost) return "energy";
  return null;
}

/**
 * Why SELECT is disabled. A City session blocks until claimed (the host refuses training_active even when it is done).
 * A legacy session that may still be claimable blocks too: a new start overwrites its display copy. Once the City has
 * refused it, it is dead and no longer blocks.
 */
export function trainingStartBlock(timers: CityTimers, card: TrainingCard | null, holobotName: string | null, energy: number, energyCost: number): StartBlock | null {
  if (timers.status === "loading") return "checking";
  if (timers.status === "unavailable") return "unavailable";
  if (!holobotName) return "no_holobot";
  if (card?.source === "city") return "training_active";
  if (card?.source === "legacy" && card.state !== "legacy_refused") return "legacy_training";
  if (energy < energyCost) return "energy";
  return null;
}

/** PLACEHOLDER copy (Lex). */
export const START_BLOCK_COPY: Record<StartBlock, string> = {
  checking: "Checking with the City…",
  unavailable: "The City can't show your runs right now.",
  no_holobot: "Choose a Holobot first.",
  slots_full: "All 3 quest slots are in use. Claim a quest first.",
  holobot_busy: "That Holobot is already on a quest.",
  energy: "Not enough energy.",
  training_active: "Claim your current training first.",
  legacy_training: "Claim your earlier training first.",
};

/** PLACEHOLDER copy (Lex): the line under a run card. A City run shows the City's end time (device clock for hh:mm). */
export function runStatusLine(card: { state: RunState; endsAtMs: number | null }, nowMs: number): string {
  switch (card.state) {
    case "ready": return "READY TO CLAIM";
    case "running": return `ENDS ${formatClock(card.endsAtMs!)} · ${formatRemaining(card.endsAtMs! - nowMs)} LEFT`;
    case "legacy_ready": return "STARTED ON AN OLDER APP · TRY CLAIM";
    case "legacy_running": return card.endsAtMs === null ? "STARTED ON AN OLDER APP" : `STARTED ON AN OLDER APP · ${formatRemaining(card.endsAtMs - nowMs)} LEFT`;
    case "legacy_refused": return "THE CITY CAN'T PAY THIS RUN · START A NEW ONE";
  }
}

/** hh:mm on the device's clock face (no Intl: Hermes). */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "1h 05m" / "11m 55s": never a second hh:mm beside the end time (the simulator witness read "ENDS 11:34 · 11:55"). */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** The claim button: enabled on a finished run (by the City's end time) or a legacy run the older app says is done. */
export function canTryClaim(card: { state: RunState }): boolean {
  return card.state === "ready" || card.state === "legacy_ready";
}

// ---------------------------------------------------------------------------------------------------------
// Replies.

/** startQuestRun reply: {schemaVersion, alreadyProcessed, questRun, dailyEnergy}. Throws on anything else. */
export function readQuestStartReply(raw: unknown): CityQuestRun {
  const r = object(raw) ? raw : {};
  const view = object(r.questRun) ? r.questRun : {};
  const run = r.schemaVersion === PROGRESSION_TIMERS_SCHEMA && typeof r.alreadyProcessed === "boolean" && typeof view.id === "string"
    ? questRun({ ...view, runId: view.id }, view.id) : null;
  if (!run) throw new Error("progression_reply_invalid");
  return run;
}

/** startTrainingSession reply: {schemaVersion, alreadyProcessed, training, dailyEnergy}. Throws on anything else. */
export function readTrainingStartReply(raw: unknown): CityTrainingRun {
  const r = object(raw) ? raw : {};
  const view = object(r.training) ? r.training : {};
  const run = r.schemaVersion === PROGRESSION_TIMERS_SCHEMA && typeof r.alreadyProcessed === "boolean" ? trainingRun({ ...view, runId: view.id }) : null;
  if (!run) throw new Error("progression_reply_invalid");
  return run;
}

// ---------------------------------------------------------------------------------------------------------
// Requests and refusals.

/** One id per start; reused for an identical retry after an unknown outcome (the host replays it as alreadyProcessed). */
export function makeProgressionRequestId(nowMs = Date.now(), random = Math.random): string {
  const id = `lp${nowMs.toString(36)}${random().toString(36).slice(2, 12).padEnd(10, "0")}`.replace(/[^A-Za-z0-9_-]/g, "0");
  return id.slice(0, 80);
}

/**
 * Remembers the request id of a start whose outcome is unknown (dropped reply, timeout), per start key
 * ("quest:<questId>:<HOLOBOT>" / "training:<courseId>:<HOLOBOT>"), so the retry is the identical request.
 */
export function createStartRequestMemo() {
  const pending = new Map<string, string>();
  return {
    requestIdFor(key: string, make: () => string = makeProgressionRequestId): string {
      const existing = pending.get(key);
      if (existing) return existing;
      const id = make();
      pending.set(key, id);
      return id;
    },
    settle(key: string) { pending.delete(key); },
  };
}

/** The host's rejection code (details.rejectionCode), else the HTTPS code without its "functions/" prefix. */
export function progressionRefusalCode(error: unknown): string | null {
  const e = object(error) ? error : {};
  const details = object(e.details) ? e.details : {};
  if (typeof details.rejectionCode === "string" && details.rejectionCode) return details.rejectionCode;
  return typeof e.code === "string" && e.code ? e.code.replace(/^functions\//, "") : null;
}

export type ProgressionAction = "quest_start" | "quest_claim" | "training_start" | "training_claim";
export type RefusalOutcome =
  /** The City refused and wrote nothing: a new request may differ. */
  | "refused"
  /** The run started on an older app and the City no longer pays it. */
  | "legacy_refused"
  /** Not known whether the City acted (no reply): retry the identical request. */
  | "unknown";
export type RefusalCopy = Readonly<{ title: string; body: string; outcome: RefusalOutcome }>;

const TITLES: Record<ProgressionAction, string> = {
  quest_start: "Quest not sent",
  quest_claim: "Quest not claimed",
  training_start: "Training not started",
  training_claim: "Training not claimed",
};

/** PLACEHOLDER copy (Lex). Every host TimerErrorCode (functions/src/lib/progressionTimers.ts, #145) has a line. */
export const PROGRESSION_REFUSAL_COPY: Record<string, string> = {
  invalid_request: "The City couldn't read that request. Try again.",
  request_conflict: "The City matched that request to a different run. Try again.",
  unknown_quest: "The City doesn't offer that quest.",
  unknown_course: "The City doesn't offer that course.",
  unknown_holobot: "The City can't find that Holobot on your account.",
  holobot_busy: "That Holobot is already on a quest.",
  quest_slots_full: "All 3 quest slots are in use. Claim a quest first.",
  training_active: "A training session is already running. Claim it first.",
  not_enough_energy: "Not enough energy.",
  not_started_on_host: "This run started on an older version of the app, before the City kept the clock. The City can't pay it. Start a new one.",
  not_complete: "Not finished yet by the City's clock.",
  not_active: "The City has no record of that run. It may already be claimed.",
  unavailable: "The City can't read your runs right now. Try again later.",
  unauthenticated: "Sign in to do that.",
  "not-found": "The City couldn't find that. It may not be open yet.",
};
const UNKNOWN_OUTCOME_CODES = new Set(["unavailable", "deadline-exceeded", "internal", "unknown", "cancelled", "resource-exhausted"]);
const REPLY_UNREADABLE = "progression_reply_invalid";

export function progressionRefusalCopy(error: unknown, action: ProgressionAction): RefusalCopy {
  const title = TITLES[action];
  const message = object(error) && typeof error.message === "string" ? error.message : "";
  // A reply this app can't read: the City may have acted. The listener shows what it recorded.
  if (message === REPLY_UNREADABLE) return Object.freeze({ title, body: "The City replied in a way this app can't read. Check your runs before trying again.", outcome: "unknown" });
  const code = progressionRefusalCode(error);
  const rejection = object(error) && object(error.details) && typeof error.details.rejectionCode === "string";
  if (code === "not_started_on_host") return Object.freeze({ title, body: PROGRESSION_REFUSAL_COPY.not_started_on_host, outcome: "legacy_refused" });
  // A host rejection code (including its own "unavailable") means the City answered and wrote nothing.
  if (rejection && code && PROGRESSION_REFUSAL_COPY[code]) return Object.freeze({ title, body: PROGRESSION_REFUSAL_COPY[code], outcome: "refused" });
  if (!code || UNKNOWN_OUTCOME_CODES.has(code)) return Object.freeze({ title, body: "Couldn't reach the City. Check your connection and try again.", outcome: "unknown" });
  if (PROGRESSION_REFUSAL_COPY[code]) return Object.freeze({ title, body: PROGRESSION_REFUSAL_COPY[code], outcome: "refused" });
  return Object.freeze({ title, body: "The City refused that. Try again later.", outcome: "refused" });
}

/** Legacy runs the City refused (not_started_on_host), per account, for this app session. */
const refusedLegacy = new Map<string, Set<string>>();
export function legacyRefusals(uid: string | null | undefined): ReadonlySet<string> {
  return refusedLegacy.get(uid ?? "") ?? new Set<string>();
}
export function markLegacyRefused(uid: string | null | undefined, runId: string): void {
  const key = uid ?? "";
  const set = new Set(refusedLegacy.get(key) ?? []);
  set.add(runId);
  refusedLegacy.set(key, set);
}

// ---------------------------------------------------------------------------------------------------------
// The quest-board / sync-boost preferences: the only rewardSystem keys this client still writes.

export const CLIENT_REWARD_SYSTEM_KEYS = ["availableQuestIds", "questRefreshesRemaining", "lastQuestRefreshDate", "syncBoostEnabled"] as const;
export type ClientRewardSystemKey = (typeof CLIENT_REWARD_SYSTEM_KEYS)[number];

/**
 * Dotted-path updates ("rewardSystem.<key>") so a preference write never replaces the map: the host's run display
 * copies (activeQuests / activeTraining) and the mission mirror (arenaBattlesToday, boosterPacksToday,
 * lastDailyMissionReset, missionClaims) are never re-sent from a stale client copy. Any other key throws.
 */
export function rewardSystemKeyUpdates(patch: Partial<Record<ClientRewardSystemKey, unknown>>): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(CLIENT_REWARD_SYSTEM_KEYS as readonly string[]).includes(key)) throw new Error(`rewardSystem.${key} is not a client key`);
    if (value !== undefined) updates[`rewardSystem.${key}`] = value;
  }
  return updates;
}
