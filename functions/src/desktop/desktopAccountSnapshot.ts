import { acknowledgeTournamentUnlock, readTournamentAcknowledged, tournamentUnlocks } from '../story/tournamentUnlocks';
import { readStoryFlagsTolerant, StoryError } from '../story/storyFlags';
import { sanitizeEconomyFields } from '../lib/economyFieldSanitizer';
import { recordAccountRepair } from '../lib/accountRepairAudit';
import { readPilotRank, PilotRankError } from '../account/pilotRank';
import { acknowledgeOnboarding, OnboardingError, OnboardingIntent, readOnboarding, validateOnboardingIntent } from '../lib/onboarding';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { projectFirstTravelHolobot } from '../acquisition/captureOwnership';
import { readBuddyInventory } from '../lib/buddyUnits';
import { buildDesktopAccountReply, DESKTOP_ACCOUNT_V1, DESKTOP_ACCOUNT_V2, DESKTOP_ACCOUNT_V3, desktopAccountVersionOf } from './desktopAccountReply';

export { DESKTOP_ACCOUNT_V1, DESKTOP_ACCOUNT_V2, DESKTOP_ACCOUNT_V3 };

/** Request `{schemaVersion?}`: missing / v1 → the deployed v1 shape; v2 → tier object; v3 → + normalised holobots with battleStats / displayStats; anything else is invalid-argument. */
export function desktopAccountVersion(data: unknown) {
  const version = desktopAccountVersionOf(data);
  if (!version) throw new HttpsError('invalid-argument', 'invalid_request', { rejectionCode: 'invalid_request' });
  return version;
}

/**
 * View of the same account used by mobile. No secondary inventory or transfer ledger.
 * DECISIONS #43/#44: also reports buddyUnits; a pilot the server has never seen is granted the
 * starter Unit here exactly once, and a #43 integer is migrated to the tier map (alongside empty travel-squad initialisation). v1 reports the TOTAL across tiers as an int (the shipped Unity build
 * parses an int); v2 / v3 report the {light, medium, heavy} object. v3 (DECISIONS #53 amendment 1 + 2):
 * see desktopAccountReply.ts.
 */
export const desktopAccountSnapshot = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to view your Holobots.');
  const version = desktopAccountVersion(request.data);
  const data = request.data as Record<string, unknown> | undefined;
  const ack = data?.operation === 'ackTournamentUnlock';
  // onboarding-host-1 (DECISIONS #72.3–#72.5): {operation:'ackOnboarding', onboarding:{advance:n} | {skip:true}}.
  const ackOnboarding = data?.operation === 'ackOnboarding';
  if (data?.operation !== undefined && data.operation !== 'snapshot' && !ack && !ackOnboarding)
    throw new HttpsError('invalid-argument','invalid_request',{rejectionCode:'invalid_request'});
  if (ack && Object.keys(data!).some(k => !['schemaVersion','operation','tournamentId'].includes(k)))
    throw new HttpsError('invalid-argument','invalid_request',{rejectionCode:'invalid_request'});
  let onboardingIntent: OnboardingIntent | undefined;
  if (ackOnboarding) {
    if (Object.keys(data!).some(k => !['schemaVersion','operation','onboarding'].includes(k)))
      throw new HttpsError('invalid-argument','invalid_request',{rejectionCode:'invalid_request'});
    try { onboardingIntent = validateOnboardingIntent(data!.onboarding); }
    catch (e) { if (e instanceof OnboardingError) throw new HttpsError('invalid-argument','invalid_request',{rejectionCode:'invalid_request'}); throw e; }
  }
  const nowMs = Date.now();
  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(userRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Account profile not found.');
    const profile = snapshot.data()!;
    const inv = readBuddyInventory(profile);
    if (!inv) throw new HttpsError('unavailable', 'unavailable', { rejectionCode: 'unavailable' });
    const squad = projectFirstTravelHolobot(profile);
    // host-crawl-fixes-1: malformed legacy economy fields (firestore.rules economyFieldsSane) are clamped here too, so
    // Home load alone unblocks the account's client writes. Never raises a stored number; audited.
    const economy = sanitizeEconomyFields(profile, nowMs);
    // host-crawl-fixes-1: malformed / inconsistent story flags no longer refuse the whole snapshot (that blanked
    // HOLOS / SYNC / PILOT / ZONES and the squad LV on Home). A non-exact read is display-only: it is never persisted,
    // tournament unlocks are withheld, and every story writer / gate still reads the flags strictly and fails closed.
    const story = readStoryFlagsTolerant(profile.storyFlags), storyFlags = story.flags;
    let pilotRank;
    try { pilotRank = readPilotRank(profile.pilotRank); }
    catch (e) {
      if (e instanceof PilotRankError) throw new HttpsError('unavailable','unavailable',{rejectionCode:'unavailable'});
      throw e;
    }
    let tournamentUpdates = {};
    if (story.exact || ack) try {
      const tournamentUnlockAcknowledged = ack ? acknowledgeTournamentUnlock(profile,data?.tournamentId) : readTournamentAcknowledged(profile.tournamentUnlockAcknowledged);
      tournamentUpdates = {tournamentUnlockAcknowledged, tournamentUnlocks: tournamentUnlocks({...profile,tournamentUnlockAcknowledged})};
    } catch (e) {
      if (e instanceof StoryError) throw new HttpsError(e.code === 'invalid_request' ? 'invalid-argument' : e.code === 'not_eligible' ? 'failed-precondition' : 'unavailable',e.code,{rejectionCode:e.code});
      throw e;
    }
    let onboardingUpdates = {};
    try {
      const stored = readOnboarding(profile.onboarding);
      if (onboardingIntent) {
        const next = acknowledgeOnboarding(profile, onboardingIntent, nowMs);
        if (JSON.stringify(next) !== JSON.stringify(stored)) onboardingUpdates = {onboarding: next};
      }
    } catch (e) {
      if (e instanceof OnboardingError) throw new HttpsError(e.code === 'not_eligible' ? 'failed-precondition' : 'unavailable',e.code,{rejectionCode:e.code});
      throw e;
    }
    const changedTournamentUpdates = Object.fromEntries(Object.entries(tournamentUpdates).filter(([key,value]) => JSON.stringify(profile[key]) !== JSON.stringify(value)));
    const updates = { ...economy.updates, ...changedTournamentUpdates, ...onboardingUpdates, ...inv.updates, ...squad.updates,
      ...(profile.pilotRank === undefined ? {pilotRank} : {}),
      ...(story.exact && JSON.stringify(profile.storyFlags) !== JSON.stringify(storyFlags) ? {storyFlags} : {}) };
    if (Object.keys(updates).length) tx.update(userRef, updates);
    recordAccountRepair(db, tx, uid, 'desktopAccountSnapshot', economy.changes, nowMs);
    return buildDesktopAccountReply({ ...profile, ...updates }, uid, version, inv.units);
  });
});
