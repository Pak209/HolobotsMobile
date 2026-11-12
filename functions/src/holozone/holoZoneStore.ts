import { ActivityError, expeditionOpen, leaseHolder } from '../lib/arenaActivity';
import {withRankHealingReward} from "../lib/rankHealingReward";
import { randomBytes, randomUUID } from 'node:crypto';
import { Firestore, Transaction } from 'firebase-admin/firestore';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { closeCourtRunNoPay, CourtLivePre, courtSettleCommand, isCityCourtZone, HOLOZONE_COOLDOWN_MS, HOLOZONE_LAST_SETTLED_FIELD, HOLOZONE_RECORD_SCHEMA, holoZoneLastSettledAfterExpiry, holoZoneLastSettledAfterSettle, HoloZoneRunRecord, readHoloZoneLastSettled, requireHoloZoneOffCooldown, HoloZoneError, holoZoneStatus, issueHoloZoneRun, readHoloZoneRuns, settleHoloZoneRun, validateHoloZoneCommand } from '../lib/holoZoneRuns';
import { readStoryFlags, StoryError } from '../story/storyFlags';
import { holoZoneIssueReplyForVersion, holoZoneSettleReplyForVersion, holoZoneStatusReplyForVersion } from '../lib/holoZoneWire';
import { FIGHT_ATTRS_FLAG, FIGHT_CHASE_FLAG, FIGHT_RECEIPT_FIELD, FIGHT_REPLAY_MODE, FightReplayIssueWire } from '../shared/fightReplayContract';
import { FightReplayError, verifyFightReplay } from '../sim/fight/replay';
import { courtFightReplayEnabled } from '../lib/holoZoneCourtLive';
import { LEFT_BEFORE_FIGHT_CLOSED_BY, leftBeforeFightInWindow } from '../lib/leftBeforeFight';
import { FIGHT_PLAUSIBILITY_COLLECTION } from '../rival/rivalBattleStore';

/**
 * DECISIONS #53 amendment 1 HoloZone run host (lib/holoZoneRuns.ts has the rules). Runs live at
 * holoZoneRuns/{uid} (server-only; default-denied and explicit in firestore.rules), outside the
 * client-writable users/{uid}. The uid always comes from authentication, so a foreign runId never
 * resolves. settle writes the Holobot XP (users/{uid}.holobots) and the ruling in one transaction.
 * Replies: holozone-run-2 (population on issue / status) when the request asks for it, else the deployed
 * holozone-run-1 shape, byte-identical (lib/holoZoneWire.ts). The stored record never changes with the wire version.
 * rival-health-1 (DECISIONS #54 amendment 2): a request carrying `healthSchema` uses the ONE host-owned health ledger
 * users/{uid}.holobotVitals the rival host writes (lib/rivalHealth.ts) — issue serves playerCombatants[] with
 * currentHealth and writes the ledger; settle{health[]} writes the reports (downward only) with the ruling. Without the
 * flag the ledger is read for KO admission but never written. Zone issue refuses ledger-zero travel-squad members
 * with holobot_ko before writing or closing any run (DECISIONS #56 amendment 5).
 */
/** Existing malformed Arena state fails closed; elapsed time alone never releases its lease. */
function requireArenaClosed(raw: unknown): void {
  let open: boolean;
  try {
    open = leaseHolder(raw, undefined) !== null;
  } catch (error) {
    if (error instanceof ActivityError) throw new HoloZoneError('unavailable');
    throw error;
  }
  if (open) throw new HoloZoneError('activity_conflict');
}
/** The single account-parent lease read (Arena match OR duel-healing run), inside the issue transaction. */
async function requireLeaseFree(tx: Transaction, db: Firestore, uid: string): Promise<void> {
  const arena = (await tx.get(db.doc(`arenaMatches/${uid}`))).data(), duel = (await tx.get(db.doc(`duelHealingRuns/${uid}`))).data();
  let holder: 'arena' | 'duel' | null;
  try {
    holder = leaseHolder(arena, duel);
  } catch (error) {
    if (error instanceof ActivityError) throw new HoloZoneError('unavailable');
    throw error;
  }
  if (holder === 'arena') throw new HoloZoneError('activity_conflict');
  if (holder === 'duel') throw new HoloZoneError('unavailable');
}
/** Malformed story flags fail closed as unavailable (the snapshot's rule); a well-formed false is zone_locked. */
export function requireHoloZonesArcBuilt(profile: Record<string, unknown>): void {
  let built: boolean;
  try {
    built = readStoryFlags(profile.storyFlags).holoZonesArcBuilt;
  } catch (error) {
    if (error instanceof StoryError) throw new HoloZoneError('unavailable');
    throw error;
  }
  if (!built) throw new HoloZoneError('zone_locked');
}
/** Guild Court plan-and-send receipts: holoZoneRuns/{uid}/receipts/{runId}, one per run still in the bounded history. */
export const COURT_RECEIPT_SCHEMA = 'holozone-court-receipt-1';
/** court-live-1 test seams (the callable never passes them): the flags read from env by default, and the input-log seed. */
export type HoloZoneRunOptions = { courtFightReplay?: boolean; fightChase?: boolean; fightAttrs?: boolean; fightSeed?: () => string };
/** Marks a transaction result whose error is thrown only after the transaction committed its writes. */
const THROW_AFTER_COMMIT = '__throwAfterCommit';
/** court-live-1: the settle-time replay, run OUTSIDE the transaction (the rival / Arena rule: the CPU work never repeats on a retry). */
async function preVerifyCourtFight(db: Firestore, uid: string, runId: string, log: unknown, nowMs: number): Promise<CourtLivePre | undefined> {
  let runs;
  try { runs = readHoloZoneRuns((await db.doc(`holoZoneRuns/${uid}`).get()).data()); } catch { return undefined; } // ruled in the transaction
  const run = runs.find(r => r.runId === runId);
  // Anything but an open live run is ruled inside the transaction (replay of a settled run, run_closed, unknown_run ...).
  if (!run || run.settlement || run.closedAtMs !== null || nowMs > run.expiresAtMs || run.duel?.mode !== FIGHT_REPLAY_MODE) return undefined;
  const issue = run.duel as FightReplayIssueWire;
  try {
    const verdict = verifyFightReplay(issue, log, { battleId: runId });
    console.info(JSON.stringify({ event: 'court_fight_replay_verified', runId, ticks: verdict.ticks, replayMs: Math.round(verdict.replayMs * 10) / 10, winner: verdict.receipt.winner }));
    return { issue, verdict };
  } catch (e) {
    if (!(e instanceof FightReplayError)) throw e;
    if (e.code === 'invalid_issue') throw new HoloZoneError('unavailable');
    console.warn(JSON.stringify({ event: 'court_fight_replay_rejected', runId, code: e.code, ...e.detail }));
    // An undecodable log is not a mismatch: nothing is written and the run stays open (the rival host's rule).
    if (e.code === 'invalid_log') throw new HoloZoneError('invalid_request', undefined, { reason: 'invalid_log', ...e.detail });
    return { issue, mismatch: { ...e.detail } };
  }
}
/** An unsettled, unclosed live (input-log) run: open while nowMs <= expiresAtMs, timed out after. */
const liveUnclosed = (r: HoloZoneRunRecord) => r.settlement === null && r.closedAtMs === null && r.duel?.mode === FIGHT_REPLAY_MODE;
/**
 * forfeit-is-loss (Pak 2026-11-11: timing out is a loss). On every court touch (status, issue, settle, forfeit) and before the
 * request's own transaction, each live run left unplayed past its 2 h TTL is closed as the forfeit's loss: closedBy 'expired',
 * closedAtMs = its expiry, the zone cooldown from the expiry (so already over), nothing paid, HP as issued. Counted once: a closed run
 * is never swept again. Plain and plan-and-send runs are never touched (their expiry stays silent). One read when nothing is stale.
 */
async function sweepExpiredLiveRuns(db: Firestore, uid: string, nowMs: number): Promise<void> {
  const runsRef = db.doc(`holoZoneRuns/${uid}`);
  const stale = (runs: HoloZoneRunRecord[]) => runs.filter(r => liveUnclosed(r) && nowMs > r.expiresAtMs);
  try { if (!stale(readHoloZoneRuns((await runsRef.get()).data())).length) return; } catch { return; } // malformed: ruled by the request
  await db.runTransaction(async tx => {
    const ledger = (await tx.get(runsRef)).data();
    const runs = readHoloZoneRuns(ledger), expired = stale(runs);
    if (!expired.length) return;
    let lastSettled = readHoloZoneLastSettled(ledger, runs);
    for (const r of expired) lastSettled = holoZoneLastSettledAfterExpiry(lastSettled, r.zoneId, r.expiresAtMs, nowMs);
    const ids = new Set(expired.map(r => r.runId));
    tx.set(runsRef, { ...ledger, schemaVersion: HOLOZONE_RECORD_SCHEMA, runs: runs.map(r => ids.has(r.runId) ? { ...r, closedAtMs: r.expiresAtMs, closedBy: 'expired' as const } : r), [HOLOZONE_LAST_SETTLED_FIELD]: lastSettled });
  });
}
export async function transactHoloZoneRun(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now(), newRunId: () => string = randomUUID, options: HoloZoneRunOptions = {}) {
  const command = validateHoloZoneCommand(raw);
  // Pin the run id outside the transaction so retries rule identically.
  const runId = command.operation === 'issue' ? newRunId() : '';
  const courtSeed = randomBytes(4).readUInt32LE(0); // Plan-and-send seed: pinned here, never disclosed before settle.
  // court-live-1: the input-log seed, pinned outside retries (disclosed at issue); the flags (default off) and the rules version.
  const fightSeed = options.fightSeed ? options.fightSeed() : randomBytes(32).toString('hex');
  const courtFightReplay = options.courtFightReplay ?? courtFightReplayEnabled();
  const fightChase = options.fightChase ?? process.env[FIGHT_CHASE_FLAG] === '1';
  const fightAttrs = options.fightAttrs ?? process.env[FIGHT_ATTRS_FLAG] === '1';
  const live = command.operation === 'issue' && command.live && courtFightReplay ? command.live : undefined;
  // court-live-only (the rival / Arena rule, Pak 2026-11-11): a live-only client that cannot get a live fight is refused before
  // anything is read or written (no run, no superseded run, no HP ledger write, no cooldown).
  if (command.operation === 'issue' && command.live?.liveOnly && !live) throw new HoloZoneError('live_unavailable', undefined, { reason: 'replay_off' });
  await sweepExpiredLiveRuns(db, uid, nowMs);
  const fightPre = command.operation === 'settle' && command.inputLog !== undefined ? await preVerifyCourtFight(db, uid, command.runId, command.inputLog, nowMs) : undefined;
  const userRef = db.doc(`users/${uid}`);
  const runsRef = db.doc(`holoZoneRuns/${uid}`);
  const out = await db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new HoloZoneError('unavailable');
    const profile = user.data()!;
    const ledger = (await tx.get(runsRef)).data();
    let runs = readHoloZoneRuns(ledger);
    if(command.operation!=='status'&&expeditionOpen(ledger))throw new HoloZoneError('activity_conflict');
    if (command.operation === 'status') return holoZoneStatusReplyForVersion(holoZoneStatus(runs, nowMs), command.schemaVersion);
    if (command.operation === 'issue') {
      // The HoloZones portal gate is host-owned: no run is issued (nothing written, no open run closed) until
      // storyFlags.holoZonesArcBuilt. QA accounts get the flag per-uid via scripts/admin/story-flags.mjs.
      // LITE CITY: the Guild Court is a city court, not a portal zone (lib/holoZoneRuns.ts).
      if (!isCityCourtZone(command.zoneId)) requireHoloZonesArcBuilt(profile);
      // Arena and every zone issue (including health flag-off clients) share this transaction read.
      await requireLeaseFree(tx, db, uid);
      let lastSettled = readHoloZoneLastSettled(ledger, runs);
      requireHoloZoneOffCooldown(lastSettled, command.zoneId, nowMs);
      // forfeit-is-loss (Pak 2026-11-11, court supersede): a new issue while a live run is open closes that run as the forfeit's loss
      // (closedBy 'superseded': no pay, HP as issued, the zone cooldown starts now). A new court request is then refused with the
      // ordinary zone_cooldown {retryAfterMs} after the closure commits; an issue for another zone goes on from the closed state.
      const openLive = [...runs].reverse().find(r => liveUnclosed(r) && nowMs <= r.expiresAtMs);
      if (openLive) {
        const closed = closeCourtRunNoPay(runs, openLive.runId, nowMs, 'superseded');
        const cooled = holoZoneLastSettledAfterSettle(lastSettled, openLive.zoneId, nowMs);
        if (openLive.zoneId === command.zoneId) {
          tx.set(runsRef, { ...ledger, ...closed, [HOLOZONE_LAST_SETTLED_FIELD]: cooled });
          return { [THROW_AFTER_COMMIT]: new HoloZoneError('zone_cooldown', HOLOZONE_COOLDOWN_MS) };
        }
        runs = closed.runs;
        lastSettled = cooled;
      }
      let squadIds: string[];
      try {
        squadIds = readTravelSquad(profile).holobotIds;
      } catch {
        throw new HoloZoneError('unavailable');
      }
      const r = issueHoloZoneRun(runs, command.zoneId, squadIds, runId, nowMs, { profile, includeHealth: command.healthSchema !== undefined || command.duelSchema !== undefined || live !== undefined,
        ...(command.duelSchema !== undefined ? { courtDuel: { holobotId: command.holobotId!, seed: courtSeed } } : {}),
        ...(live ? { courtLive: { holobotId: command.holobotId!, seed: fightSeed, chase: fightChase, attrs: fightAttrs, tempo: live.rules6 && fightChase && fightAttrs, liveOnly: live.liveOnly, ...(live.rules7 ? { guardHold: true } : {}), ...(live.rules8 ? { staminaWind: true } : {}) } } : {}) });
      if (Object.keys(r.userUpdates).length) tx.update(userRef, withRankHealingReward(profile,r.userUpdates));
      tx.set(runsRef, { ...r.doc, [HOLOZONE_LAST_SETTLED_FIELD]: lastSettled });
      // A receipt lives as long as its run stays in the bounded history.
      const kept = new Set(r.doc.runs.map(x => x.runId));
      for (const old of runs) if (old.duel && !kept.has(old.runId)) tx.delete(db.doc(`holoZoneRuns/${uid}/receipts/${old.runId}`));
      return holoZoneIssueReplyForVersion(r.reply, command.schemaVersion);
    }
    const receiptRef = db.doc(`holoZoneRuns/${uid}/receipts/${command.runId}`);
    /** A settled court run's stored receipt (plan-and-send duelReceipt, or the live fightReceipt) joins its replayed reply. */
    const withStoredReceipt = async <T extends object>(reply: T) => {
      if (!runs.find(x => x.runId === command.runId)?.duel) return reply;
      const doc = (await tx.get(receiptRef)).data();
      return { ...reply, ...(doc?.duelReceipt ? { duelReceipt: doc.duelReceipt } : {}), ...(doc?.fightReceipt ? { [FIGHT_RECEIPT_FIELD]: doc.fightReceipt } : {}) };
    };
    if (command.operation === 'forfeit') {
      // court-live-1 (Pak's Arena ruling, applied to the court): a live fight cut off after it started is a forfeit. The explicit
      // forfeit closes the open live run with no pay (closeCourtRunNoPay); a settled run replays its ruling, a closed one its closure.
      const run = runs.find(x => x.runId === command.runId);
      if (!run) throw new HoloZoneError('unknown_run');
      if (run.settlement) return holoZoneSettleReplyForVersion(await withStoredReceipt(settleHoloZoneRun(profile, runs, { runId: run.runId, kills: 0, bossDefeated: false, fielded: [] }, nowMs).reply), command.schemaVersion);
      // forfeit-is-loss: a run closed by its expiry (already recorded as a loss) answers run_expired, as an expired run did before.
      if (run.closedBy === 'expired') throw new HoloZoneError('run_expired', undefined, { closedBy: 'expired' });
      if (run.closedBy) return { schemaVersion: command.schemaVersion, runId: run.runId, alreadyProcessed: true, closedBy: run.closedBy };
      // no-loss-before-fight (Pak 2026-11-11): left during the countdown, claimed within the window of the run's issue: the run closes
      // with nothing paid (no 25 Holos), HP as issued, and NO loss: no zone cooldown is written. Later: the ordinary forfeit below.
      // (closeCourtRunNoPay refuses an expired run, so a timed-out fight stays the sweep's loss.)
      if (command.leftBeforeFight && leftBeforeFightInWindow(run.issuedAtMs, nowMs)) {
        const cancelled = closeCourtRunNoPay(runs, run.runId, nowMs, LEFT_BEFORE_FIGHT_CLOSED_BY);
        tx.set(runsRef, { ...ledger, ...cancelled, [HOLOZONE_LAST_SETTLED_FIELD]: readHoloZoneLastSettled(ledger, runs) });
        return { schemaVersion: command.schemaVersion, runId: run.runId, alreadyProcessed: false, closedBy: LEFT_BEFORE_FIGHT_CLOSED_BY };
      }
      // forfeit-is-loss (Pak 2026-11-11): the forfeit is the court's loss record (closedBy) and starts the normal zone cooldown.
      const closed = closeCourtRunNoPay(runs, run.runId, nowMs, 'forfeit');
      tx.set(runsRef, { ...closed, [HOLOZONE_LAST_SETTLED_FIELD]: holoZoneLastSettledAfterSettle(readHoloZoneLastSettled(ledger, runs), run.zoneId, nowMs) });
      return { schemaVersion: command.schemaVersion, runId: run.runId, alreadyProcessed: false, closedBy: 'forfeit' };
    }
    // Plan-and-send: the resolver's receipt becomes the report; settleHoloZoneRun stays the only payer.
    // court-live-1: likewise the verified replay of a live run (or its mismatch, which closes the run below).
    const resolved = courtSettleCommand(runs, command, nowMs, fightPre);
    if (resolved.mismatch) {
      // court-live-1: a log that failed replay closes the run as a no-pay forfeit (HP as issued), committed, then replay_mismatch is
      // reported with the verifier's detail. A resend reads run_closed {closedBy: 'replay_mismatch'}. forfeit-is-loss (Pak
      // 2026-11-11): counted as the forfeit's loss, so the zone cooldown starts.
      const closed = closeCourtRunNoPay(runs, command.runId, nowMs, 'replay_mismatch', resolved.mismatch);
      const zoneId = runs.find(x => x.runId === command.runId)!.zoneId;
      tx.set(runsRef, { ...closed, [HOLOZONE_LAST_SETTLED_FIELD]: holoZoneLastSettledAfterSettle(readHoloZoneLastSettled(ledger, runs), zoneId, nowMs) });
      return { [THROW_AFTER_COMMIT]: new HoloZoneError('replay_mismatch', undefined, resolved.mismatch) };
    }
    const r = settleHoloZoneRun(profile, runs, resolved.command, nowMs);
    if (r.reply.alreadyProcessed) return holoZoneSettleReplyForVersion(await withStoredReceipt(r.reply), command.schemaVersion);
    // Preserve receipt replay, but refuse all first-time reward/HP writes during an Arena match.
    requireArenaClosed((await tx.get(db.doc(`arenaMatches/${uid}`))).data());
    if (Object.keys(r.userUpdates).length) tx.update(userRef, withRankHealingReward(profile, r.userUpdates));
    if (r.doc) tx.set(runsRef, { ...r.doc, [HOLOZONE_LAST_SETTLED_FIELD]: holoZoneLastSettledAfterSettle(readHoloZoneLastSettled(ledger, runs), r.reply.settlement.zoneId, nowMs) });
    if (resolved.receipt) tx.set(receiptRef, { schemaVersion: COURT_RECEIPT_SCHEMA, runId: command.runId, duelReceipt: resolved.receipt });
    if (resolved.verdict) {
      const verdict = resolved.verdict, won = verdict.receipt.winner === 'player';
      // server-rulings-1 ruling 4, as on the rival / Arena hosts: a verified WIN keeps its plausibility read (host-only, in the
      // receipts doc); a flagged one is also listed for admins. Never refuses, never withholds.
      tx.set(receiptRef, { schemaVersion: COURT_RECEIPT_SCHEMA, runId: command.runId, fightReceipt: verdict.receipt, ...(won ? { fightPlausibility: verdict.plausibility } : {}) });
      if (won && verdict.plausibility.flagged) tx.set(db.doc(`${FIGHT_PLAUSIBILITY_COLLECTION}/${uid}_${command.runId}`), { uid, runId: command.runId, source: 'court', flaggedAtMs: nowMs,
        ...verdict.plausibility, inputsHash: verdict.receipt.inputsHash, rulesId: verdict.receipt.rulesId, endTick: verdict.receipt.endTick, reviewed: false });
      return holoZoneSettleReplyForVersion({ ...r.reply, [FIGHT_RECEIPT_FIELD]: verdict.receipt }, command.schemaVersion);
    }
    return holoZoneSettleReplyForVersion(resolved.receipt ? { ...r.reply, duelReceipt: resolved.receipt } : r.reply, command.schemaVersion);
  });
  const deferred = (out as Record<string, unknown>)[THROW_AFTER_COMMIT];
  if (deferred instanceof HoloZoneError) throw deferred;
  return out;
}
