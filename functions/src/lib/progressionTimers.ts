/**
 * Server-side quest / training start records (critic review 2026-10-17 S3, host-economy-hardening-2).
 *
 * Before: the main app and lite started quests and training by writing users/{uid}.rewardSystem.activeQuests /
 * activeTraining themselves (QuestsScreen / TrainingScreen; rewardSystem is owner-writable), and claimQuestRun /
 * claimTrainingSession trusted that record's endsAt, holobotPower and the client's own dailyEnergy debit. A forged
 * endsAt in the past claimed instantly, without limit.
 *
 * Now: startQuestRun / startTrainingSession (callables) validate the start, debit dailyEnergy and write a record into
 * the SERVER-ONLY users/{uid}.progressionTimers (firestore.rules protectedFieldsUntouched + absent on create) stamped
 * with the host clock; the claim validates elapsed time against startedAtMs + the table duration and uses the
 * recorded quest / holobot / power / boosts. The rewardSystem entries the callables also write are a DISPLAY copy.
 *
 * Grace path for in-flight legacy clients: a claim with no server record falls back to the client-written rewardSystem
 * record ONLY when the function environment has HOLOCITY_LEGACY_QUEST_TIMERS=1 (exactly "1"); default off.
 *
 * Not hardened here (owner-writable by design today): dailyEnergy itself (client-side regen) and the holobot's
 * level / boosts the power score is computed from (S4 census).
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import {
  getHolobotPowerScore,
  getQuestEconomy,
  getTrainingCourseEconomy,
  MAX_CLAIMED_HOLOBOT_POWER,
  type StoredQuestRecord,
  type StoredTrainingRecord,
} from "./progressionEconomy";

export const PROGRESSION_TIMERS_FIELD = "progressionTimers";
export const PROGRESSION_TIMERS_SCHEMA = "progression-timers-1";
/** Same slot count the clients enforce (QuestsScreen "Quest Slots Full"). */
export const MAX_ACTIVE_QUESTS = 3;
export const LEGACY_QUEST_TIMERS_FLAG = "HOLOCITY_LEGACY_QUEST_TIMERS";

export type TimerErrorCode =
  | "invalid_request"
  | "request_conflict"
  | "unknown_quest"
  | "unknown_course"
  | "unknown_holobot"
  | "holobot_busy"
  | "quest_slots_full"
  | "training_active"
  | "not_enough_energy"
  | "not_started_on_host"
  | "not_complete"
  | "not_active"
  | "unavailable";

export class TimerError extends Error {
  constructor(public code: TimerErrorCode) {
    super(code);
  }
}

const fail = (code: TimerErrorCode): never => {
  throw new TimerError(code);
};

export type QuestTimer = {
  runId: string;
  questId: string;
  holobotName: string;
  holobotPower: number;
  energyCost: number;
  startedAtMs: number;
  endsAtMs: number;
};

export type TrainingTimer = {
  runId: string;
  courseId: string;
  holobotName: string;
  statBoosts: Record<string, number>;
  expReward: number;
  energyCost: number;
  startedAtMs: number;
  endsAtMs: number;
};

export type ProgressionTimers = {
  schemaVersion: typeof PROGRESSION_TIMERS_SCHEMA;
  quests: Record<string, QuestTimer>;
  training: TrainingTimer | null;
};

type Data = Record<string, unknown>;
const object = (x: unknown): x is Data => !!x && typeof x === "object" && !Array.isArray(x);
const whole = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;
const RUN_ID = /^(qr|tr)_[A-Za-z0-9_-]{8,80}$/;

/** True only for exactly "1" (the HOLOCITY_* convention). */
export function legacyQuestTimersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[LEGACY_QUEST_TIMERS_FLAG] === "1";
}

function minutes(n: number) {
  return n * 60 * 1000;
}

function questTimer(raw: unknown, id: string): QuestTimer {
  if (!object(raw) || raw.runId !== id || !RUN_ID.test(id) || !id.startsWith("qr_")
    || typeof raw.questId !== "string" || !getQuestEconomy(raw.questId)
    || typeof raw.holobotName !== "string" || !raw.holobotName
    || !whole(raw.holobotPower) || raw.holobotPower > MAX_CLAIMED_HOLOBOT_POWER
    || !whole(raw.energyCost) || !whole(raw.startedAtMs) || !whole(raw.endsAtMs)
    || raw.endsAtMs !== raw.startedAtMs + minutes(getQuestEconomy(raw.questId)!.durationMinutes)) return fail("unavailable");
  return raw as QuestTimer;
}

function trainingTimer(raw: unknown): TrainingTimer {
  const course = object(raw) && typeof raw.courseId === "string" ? getTrainingCourseEconomy(raw.courseId) : null;
  if (!object(raw) || !course || typeof raw.runId !== "string" || !RUN_ID.test(raw.runId) || !raw.runId.startsWith("tr_")
    || typeof raw.holobotName !== "string" || !raw.holobotName
    || !object(raw.statBoosts) || Object.keys(raw.statBoosts).some((k) => !course.statKeys.includes(k))
    || course.statKeys.some((k) => !whole((raw.statBoosts as Data)[k]) || ((raw.statBoosts as Data)[k] as number) > course.maxBoost)
    || raw.expReward !== course.expReward || !whole(raw.energyCost)
    || !whole(raw.startedAtMs) || !whole(raw.endsAtMs) || raw.endsAtMs !== raw.startedAtMs + minutes(course.durationMinutes)) return fail("unavailable");
  return raw as TrainingTimer;
}

/** Validates the stored server-only record; absent = empty. Malformed fails closed (unavailable). */
export function readProgressionTimers(raw: unknown): ProgressionTimers {
  if (raw === undefined) return { schemaVersion: PROGRESSION_TIMERS_SCHEMA, quests: {}, training: null };
  if (!object(raw) || raw.schemaVersion !== PROGRESSION_TIMERS_SCHEMA || !object(raw.quests) || (raw.training !== null && !object(raw.training))) return fail("unavailable");
  const quests: Record<string, QuestTimer> = {};
  for (const [id, entry] of Object.entries(raw.quests)) quests[id] = questTimer(entry, id);
  if (Object.keys(quests).length > MAX_ACTIVE_QUESTS) return fail("unavailable");
  return { schemaVersion: PROGRESSION_TIMERS_SCHEMA, quests, training: raw.training === null ? null : trainingTimer(raw.training) };
}

function rewardSystemOf(profile: Data): Data {
  return object(profile.rewardSystem) ? profile.rewardSystem : {};
}

/** The one stored holobot with this name (case-insensitive). */
function ownedHolobot(profile: Data, holobotName: string): Data & { name: string } {
  const key = holobotName.trim().toUpperCase();
  const found = (Array.isArray(profile.holobots) ? profile.holobots : []).filter(
    (h: unknown) => object(h) && typeof h.name === "string" && h.name.trim().toUpperCase() === key,
  ) as Array<Data & { name: string }>;
  if (!key || found.length !== 1) return fail("unknown_holobot");
  return found[0];
}

function energy(profile: Data, cost: number): number {
  const stored = profile.dailyEnergy ?? 0;
  if (typeof stored !== "number" || !Number.isFinite(stored) || stored < 0) return fail("unavailable");
  if (stored < cost) return fail("not_enough_energy");
  return Math.max(0, stored - cost);
}

export type StartCommand = { requestId: string; holobotName: string; questId?: string; courseId?: string };

export function readStartCommand(raw: unknown, kind: "quest" | "training"): StartCommand {
  const idKey = kind === "quest" ? "questId" : "courseId";
  if (!object(raw) || Object.keys(raw).some((k) => !["requestId", "holobotName", idKey].includes(k))
    || typeof raw.requestId !== "string" || !REQUEST_ID.test(raw.requestId)
    || typeof raw.holobotName !== "string" || !raw.holobotName.trim() || raw.holobotName.length > 40
    || typeof raw[idKey] !== "string") return fail("invalid_request");
  return raw as StartCommand;
}

/** The questRun view returned by startQuestRun. */
export function questRunView(t: QuestTimer) {
  return { id: t.runId, questId: t.questId, holobotName: t.holobotName, holobotPower: t.holobotPower,
    startedAt: new Date(t.startedAtMs).toISOString(), endsAt: new Date(t.endsAtMs).toISOString(), startedAtMs: t.startedAtMs, endsAtMs: t.endsAtMs };
}

export function trainingView(t: TrainingTimer) {
  return { id: t.runId, courseId: t.courseId, holobotName: t.holobotName, statBoosts: t.statBoosts, expReward: t.expReward,
    startedAt: new Date(t.startedAtMs).toISOString(), endsAt: new Date(t.endsAtMs).toISOString(), startedAtMs: t.startedAtMs, endsAtMs: t.endsAtMs };
}

/**
 * startQuestRun. Idempotent per requestId (run id qr_<requestId>): a replay of a still-active run returns it and writes
 * nothing; a different quest / holobot under the same requestId is request_conflict.
 */
export function buildQuestStart(profile: Data, raw: unknown, nowMs: number) {
  const c = readStartCommand(raw, "quest");
  const timers = readProgressionTimers(profile[PROGRESSION_TIMERS_FIELD]);
  const runId = `qr_${c.requestId}`;
  const existing = timers.quests[runId];
  if (existing) {
    if (existing.questId !== c.questId || existing.holobotName.toUpperCase() !== c.holobotName.trim().toUpperCase()) return fail("request_conflict");
    return { alreadyProcessed: true, run: existing, updates: null };
  }
  const quest = getQuestEconomy(c.questId!) ?? fail("unknown_quest");
  const holobot = ownedHolobot(profile, c.holobotName);
  const runs = Object.values(timers.quests);
  if (runs.some((r) => r.holobotName.toUpperCase() === holobot.name.toUpperCase())) return fail("holobot_busy");
  if (runs.length >= MAX_ACTIVE_QUESTS) return fail("quest_slots_full");
  const dailyEnergy = energy(profile, quest.energyCost);
  const holobotPower = Math.min(MAX_CLAIMED_HOLOBOT_POWER, Math.max(0, getHolobotPowerScore(holobot as { name: string })));
  const run: QuestTimer = { runId, questId: quest.id, holobotName: holobot.name, holobotPower, energyCost: quest.energyCost, startedAtMs: nowMs, endsAtMs: nowMs + minutes(quest.durationMinutes) };
  questTimer(run, runId);
  const rewardSystem = rewardSystemOf(profile);
  const display = { id: runId, questId: quest.id, holobotName: holobot.name, holobotPower, rewards: quest.rewards,
    startedAt: new Date(run.startedAtMs).toISOString(), endsAt: new Date(run.endsAtMs).toISOString() };
  return {
    alreadyProcessed: false,
    run,
    updates: {
      dailyEnergy,
      [PROGRESSION_TIMERS_FIELD]: { ...timers, quests: { ...timers.quests, [runId]: run } },
      rewardSystem: { ...rewardSystem, activeQuests: [...(Array.isArray(rewardSystem.activeQuests) ? rewardSystem.activeQuests : []).filter((q) => !(object(q) && q.id === runId)), display] },
    },
  };
}

/**
 * startTrainingSession. One active session per account (as the clients enforce). The stat boost is rolled HERE
 * (roll in [0, 1)) and recorded; the client's own roll is never read. Idempotent per requestId (tr_<requestId>).
 */
export function buildTrainingStart(profile: Data, raw: unknown, nowMs: number, roll: number) {
  const c = readStartCommand(raw, "training");
  const timers = readProgressionTimers(profile[PROGRESSION_TIMERS_FIELD]);
  const runId = `tr_${c.requestId}`;
  if (timers.training?.runId === runId) {
    if (timers.training.courseId !== c.courseId || timers.training.holobotName.toUpperCase() !== c.holobotName.trim().toUpperCase()) return fail("request_conflict");
    return { alreadyProcessed: true, run: timers.training, updates: null };
  }
  const course = getTrainingCourseEconomy(c.courseId!) ?? fail("unknown_course");
  const holobot = ownedHolobot(profile, c.holobotName);
  if (timers.training) return fail("training_active");
  if (!(typeof roll === "number" && roll >= 0 && roll < 1)) return fail("unavailable");
  const dailyEnergy = energy(profile, course.energyCost);
  const boost = course.minBoost + Math.floor(roll * (course.maxBoost - course.minBoost + 1));
  const statBoosts = Object.fromEntries(course.statKeys.map((k) => [k, boost]));
  const run: TrainingTimer = { runId, courseId: course.id, holobotName: holobot.name, statBoosts, expReward: course.expReward, energyCost: course.energyCost, startedAtMs: nowMs, endsAtMs: nowMs + minutes(course.durationMinutes) };
  trainingTimer(run);
  const display = { courseId: course.id, holobotName: holobot.name, statBoosts, expReward: course.expReward,
    startedAt: new Date(run.startedAtMs).toISOString(), endsAt: new Date(run.endsAtMs).toISOString() };
  return {
    alreadyProcessed: false,
    run,
    updates: { dailyEnergy, [PROGRESSION_TIMERS_FIELD]: { ...timers, training: run }, rewardSystem: { ...rewardSystemOf(profile), activeTraining: display } },
  };
}

function legacyEndsAtOk(record: { endsAt?: unknown }, nowMs: number): boolean {
  const endsAtMs = new Date(String(record.endsAt || "")).getTime();
  return Number.isFinite(endsAtMs) && endsAtMs <= nowMs;
}

/**
 * The record a quest claim pays from. A server record wins; with none, the client-written rewardSystem record is used
 * only when `legacyTimers` (HOLOCITY_LEGACY_QUEST_TIMERS=1). `timerUpdates` removes the server record.
 */
export function resolveQuestClaim(profile: Data, questRunId: string, nowMs: number, legacyTimers: boolean):
  { record: StoredQuestRecord; source: "host" | "legacy"; timerUpdates: Data } {
  const timers = readProgressionTimers(profile[PROGRESSION_TIMERS_FIELD]);
  const run = Object.hasOwn(timers.quests, questRunId) ? timers.quests[questRunId] : undefined;
  if (run) {
    if (nowMs < run.endsAtMs) return fail("not_complete");
    const { [questRunId]: _claimed, ...rest } = timers.quests;
    return {
      record: { id: run.runId, questId: run.questId, holobotName: run.holobotName, holobotPower: run.holobotPower },
      source: "host",
      timerUpdates: { [PROGRESSION_TIMERS_FIELD]: { ...timers, quests: rest } },
    };
  }
  if (!legacyTimers) return fail("not_started_on_host");
  const rewardSystem = rewardSystemOf(profile);
  const activeQuests = Array.isArray(rewardSystem.activeQuests) ? rewardSystem.activeQuests : [];
  const record = activeQuests.find((entry) => (entry as { id?: unknown })?.id === questRunId) as StoredQuestRecord | undefined;
  if (!record) return fail("not_active");
  if (!legacyEndsAtOk(record, nowMs)) return fail("not_complete");
  return { record, source: "legacy", timerUpdates: {} };
}

/** The record a training claim pays from (same precedence and flag as resolveQuestClaim). */
export function resolveTrainingClaim(profile: Data, nowMs: number, legacyTimers: boolean):
  { record: StoredTrainingRecord; source: "host" | "legacy"; timerUpdates: Data } {
  const timers = readProgressionTimers(profile[PROGRESSION_TIMERS_FIELD]);
  if (timers.training) {
    const run = timers.training;
    if (nowMs < run.endsAtMs) return fail("not_complete");
    return {
      record: { courseId: run.courseId, holobotName: run.holobotName, statBoosts: run.statBoosts, expReward: run.expReward },
      source: "host",
      timerUpdates: { [PROGRESSION_TIMERS_FIELD]: { ...timers, training: null } },
    };
  }
  if (!legacyTimers) return fail("not_started_on_host");
  const record = rewardSystemOf(profile).activeTraining as StoredTrainingRecord | null | undefined;
  if (!record || typeof record !== "object") return fail("not_active");
  if (!legacyEndsAtOk(record, nowMs)) return fail("not_complete");
  return { record, source: "legacy", timerUpdates: {} };
}
