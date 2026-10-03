import { Firestore, Transaction } from 'firebase-admin/firestore';
import { claimIntroStep, INTRO_QUEST_STEPS, IntroQuestError, introStatusReply, readIntroQuestState, readRivalWinsForQuest, validateIntroCommand } from '../lib/introQuests';

/**
 * DECISIONS #46 intro quests. Chain state lives at introQuests/{uid}: top-level, server-only (rules
 * deny every client read/write), so a client can neither forge progress nor delete the doc to replay
 * rewards. The uid always comes from authentication.
 */

/**
 * Whether the pilot has captured `holobotId`, from server-only sources only:
 * 1. the wild session roster (wildEncounterSessions/{uid}.entries: availability "owned", source "capture"), or
 * 2. a captured receipt for that Holobot (covers a capture of a Holobot already owned from another source,
 *    which leaves the roster entry's source unchanged). Bounded: limit(1).
 * The client-writable users/{uid}.holobots array is never trusted.
 */
async function hasCaptured(db: Firestore, tx: Transaction, uid: string, holobotId: string): Promise<boolean> {
  const session = await tx.get(db.doc(`wildEncounterSessions/${uid}`));
  const entries = session.exists ? session.data()?.entries : undefined;
  if (Array.isArray(entries) && entries.some(e => e && e.holobotId === holobotId && e.availability === 'owned' && e.source === 'capture')) return true;
  if (!session.exists) return false;
  const receipts = await tx.get(db.collection(`wildEncounterSessions/${uid}/receipts`)
    .where('reply.captureResult.holobotId', '==', holobotId)
    .where('reply.captureResult.captured', '==', true)
    .limit(1));
  return !receipts.empty;
}

export async function transactIntroQuest(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now()) {
  const command = validateIntroCommand(raw);
  const userRef = db.doc(`users/${uid}`);
  const questRef = db.doc(`introQuests/${uid}`);
  return db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new IntroQuestError('unavailable');
    const profile = user.data()!;
    const questDoc = await tx.get(questRef);
    const { state } = readIntroQuestState(questDoc.exists ? questDoc.data() : undefined, nowMs, readRivalWinsForQuest(profile));
    if (command.operation === 'status') return introStatusReply(state, profile);
    // Gather verification facts before any write (Firestore transactions read first).
    const step = INTRO_QUEST_STEPS.find(s => s.stepId === command.stepId)!;
    const capturedHolobot = step.kind === 'capture' && step.stepId === INTRO_QUEST_STEPS[state.currentIndex]?.stepId && !state.claims[step.stepId]
      ? await hasCaptured(db, tx, uid, step.holobotId) : false;
    const r = claimIntroStep(state, profile, command, nowMs, { captured: id => id === step.holobotId && capturedHolobot });
    if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
    if (r.state) tx.set(questRef, r.state);
    return r.reply;
  });
}
