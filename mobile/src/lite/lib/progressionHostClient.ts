import { doc, db, functions, httpsCallable, onSnapshot, updateDoc, type Unsubscribe } from "@/config/firebase";
import {
  CITY_TIMERS_UNAVAILABLE,
  readCityTimers,
  readQuestStartReply,
  readTrainingStartReply,
  rewardSystemKeyUpdates,
  type CityQuestRun,
  type CityTimers,
  type CityTrainingRun,
  type ClientRewardSystemKey,
} from "@/lite/lib/progressionHost";
import type { QuestId, TrainingCourseId } from "@/lib/progressionSystems";

/**
 * The City's quest / training callables (host #145) and the one listener that shows its run records. Every write here
 * is a request; the host stamps the clock, rolls the boost, debits the energy and pays. Refusals are thrown as the SDK
 * surfaced them: progressionRefusalCopy() turns them into City copy.
 */
const startQuestRunCallable = httpsCallable<{ questId: QuestId; holobotName: string; requestId: string }, unknown>(functions, "startQuestRun");
const startTrainingSessionCallable = httpsCallable<{ courseId: TrainingCourseId; holobotName: string; requestId: string }, unknown>(functions, "startTrainingSession");
const claimQuestRunCallable = httpsCallable<{ questRunId: string }, { rewards?: unknown; succeeded?: unknown }>(functions, "claimQuestRun");
const claimTrainingSessionCallable = httpsCallable<Record<string, never>, { claimed?: unknown }>(functions, "claimTrainingSession");

export async function startQuestRunInCity(request: { questId: QuestId; holobotName: string; requestId: string }): Promise<CityQuestRun> {
  const reply = await startQuestRunCallable({ questId: request.questId, holobotName: request.holobotName, requestId: request.requestId });
  return readQuestStartReply(reply.data);
}

export async function startTrainingInCity(request: { courseId: TrainingCourseId; holobotName: string; requestId: string }): Promise<CityTrainingRun> {
  const reply = await startTrainingSessionCallable({ courseId: request.courseId, holobotName: request.holobotName, requestId: request.requestId });
  return readTrainingStartReply(reply.data);
}

/** Claims the City run (or, while the City still honours them, a legacy run) by its id. The host rolls the outcome. */
export async function claimQuestRunInCity(runId: string): Promise<{ succeeded: boolean | null }> {
  const reply = await claimQuestRunCallable({ questRunId: runId });
  return { succeeded: typeof reply.data?.succeeded === "boolean" ? reply.data.succeeded : null };
}

export async function claimTrainingInCity(): Promise<void> {
  await claimTrainingSessionCallable({});
}

/** Quest-board / sync-boost preferences only, as dotted paths (never the whole rewardSystem map). */
export async function updateRewardSystemKeys(uid: string, patch: Partial<Record<ClientRewardSystemKey, unknown>>): Promise<void> {
  await updateDoc(doc(db, "users", uid), rewardSystemKeyUpdates(patch) as Record<string, any>);
}

/** The owner's users/{uid}.progressionTimers (server-only field; owner-readable). A listener error reads UNAVAILABLE. */
export function subscribeCityTimers(uid: string, onTimers: (timers: CityTimers) => void): Unsubscribe {
  return onSnapshot(
    doc(db, "users", uid),
    (snapshot) => onTimers(readCityTimers(snapshot.exists() ? snapshot.get("progressionTimers") : undefined)),
    () => onTimers(CITY_TIMERS_UNAVAILABLE),
  );
}
