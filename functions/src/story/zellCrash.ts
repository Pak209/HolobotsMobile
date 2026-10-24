import { randomBytes } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { buildPlayerCombatants, rivalScaledCombatant, rivalScaledCombatantStats } from '../lib/rivalLadder';
import { desktopPracticeCommands } from '../lib/desktopPracticeCommands';
import { meetZell, readZellStory, ZellPhase } from '../lib/zellStory';
import { FIGHT_INPUTS_SCHEMA, FightReceiptWire, FightReplayIssueWire } from '../shared/fightReplayContract';
import { FightReplayError, readIssue, verifyFightReplay } from '../sim/fight/replay';
import { buildFightReplayIssue } from '../rival/fightReplayIssue';
import { gatheringRoster } from './arenaGathering';
import { readStoryFlags, StoryError, StoryFlags } from './storyFlags';
import { CATCH_ESCAPE_CAUSES, CatchEscapeCause, CatchEscapeWire, catchEscapeHit, readCatchEscape, ZELL_CATCHES, zellRunnerProfile } from './zellCatch';

/**
 * zell-crash-1 (DECISIONS #72.74 / #72.75; HolobotsUnity Documentation/HANDOFFS/2026-10-23-zell-crash-beat-sheet.md §3):
 * the Act 1 -> Act 2 bridge, host side. Server-authoritative and idempotent:
 *  - `crash`: once per account, after the third tournament win (arenaArcBuilt), records the event (zellCrash.seen, the trophy
 *    `stolen`), flips storyFlags.holoZonesArcBuilt (the HoloZones portal gate; the missing setter, story review G4) and meets
 *    Zell (zell-story-1 unmet -> rival). A repeat writes nothing and replies the same state.
 *  - `issueCatch` / `settleCatch`: the two can't-lose catch-duels on the duel-rules-4 core. The issue pins the squad at FULL
 *    HP, JUSAN as the tagged runner and the escape condition; the settle replays the log on the host (the client's outcome is
 *    never read) and always rules `escaped`. Nothing is granted or charged: no Holos, XP, HP, pilot rank, cooldown,
 *    onboarding event or reward of any kind, so there is nothing to farm, and each catch settles once per account ever.
 * The arc record lives at storyProgress/{uid}/arcs/zellCrash (server-only rules; deleteUserData's recursive delete).
 * storyFlags keeps its four keys: Unity readers pin that key set (TournamentBracketReplies), so zellCrashSeen travels in
 * the `zellCrash` block, not in storyFlags. Default off: HOLOCITY_ZELL_CRASH=1.
 */
export const ZELL_CRASH_SCHEMA = 'zell-crash-1' as const;
export const ZELL_CRASH_FLAG = 'HOLOCITY_ZELL_CRASH' as const;
export const ZELL_CRASH_PATH = (uid: string) => `storyProgress/${uid}/arcs/zellCrash`;
export const ZELL_CATCH_ID = /^zc_[a-f0-9]{24}$/;
export const ZELL_CATCH_RECEIPT_SCHEMA = 'zell-catch-receipt-1' as const;

export type TrophyState = 'stolen' | 'recovered';
/** duel-receipt-2's fields as the replay computed them, with the catch-duel's own outcome: always `escaped`. */
export type ZellCatchReceipt = Omit<FightReceiptWire, 'schemaVersion' | 'reason'> & {
  schemaVersion: typeof ZELL_CATCH_RECEIPT_SCHEMA; reason: 'ko' | 'timeout' | 'escaped'; outcome: 'escaped'; cause: CatchEscapeCause;
};
export type ZellCatchRecord = {
  catchId: string; issuedAtMs: number; duel: FightReplayIssueWire; escape: CatchEscapeWire;
  settlement: null | { outcome: 'escaped'; cause: CatchEscapeCause; settledAtMs: number; receipt: ZellCatchReceipt };
};
export type ZellCrashRecord = {
  schemaVersion: typeof ZELL_CRASH_SCHEMA; seenAtMs: number;
  trophy: { state: TrophyState; stolenAtMs: number };
  catches: { '0'?: ZellCatchRecord; '1'?: ZellCatchRecord };
};
export type CatchState = 'locked' | 'ready' | 'open' | 'escaped';
export type ZellCrashView = {
  seen: boolean; trophy: TrophyState | null;
  catches: { catchIndex: 0 | 1; state: CatchState; cause: CatchEscapeCause | null }[];
};

const fail = (code = 'unavailable'): never => { throw new StoryError(code); };
const whole = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** Missing = unseen (null); malformed = unavailable, never reset. */
export function readZellCrash(raw: unknown): ZellCrashRecord | null {
  if (raw === undefined) return null;
  const r = raw as ZellCrashRecord;
  if (!r || typeof r !== 'object' || r.schemaVersion !== ZELL_CRASH_SCHEMA || !whole(r.seenAtMs)
    || !r.trophy || !['stolen', 'recovered'].includes(r.trophy.state) || !whole(r.trophy.stolenAtMs)
    || !r.catches || typeof r.catches !== 'object' || Object.keys(r.catches).some(k => k !== '0' && k !== '1')) return fail();
  for (const c of Object.values(r.catches)) {
    if (!c || !ZELL_CATCH_ID.test(c.catchId) || !whole(c.issuedAtMs)) return fail();
    try { readIssue(c.duel); readCatchEscape(c.escape); } catch { return fail(); }
    if (c.settlement !== null && (c.settlement?.outcome !== 'escaped' || !CATCH_ESCAPE_CAUSES.includes(c.settlement.cause) || !whole(c.settlement.settledAtMs))) return fail();
  }
  return r;
}

function catchState(r: ZellCrashRecord | null, i: 0 | 1): CatchState {
  if (!r) return 'locked';
  const c = r.catches[String(i) as '0' | '1'];
  if (c?.settlement) return 'escaped';
  if (c) return 'open';
  return i === 0 || r.catches['0']?.settlement ? 'ready' : 'locked';
}
export function zellCrashView(r: ZellCrashRecord | null): ZellCrashView {
  return {
    seen: r !== null, trophy: r ? r.trophy.state : null,
    catches: ([0, 1] as const).map(i => ({ catchIndex: i, state: catchState(r, i), cause: r?.catches[String(i) as '0' | '1']?.settlement?.cause ?? null })),
  };
}

type Op = 'status' | 'crash' | 'issueCatch' | 'settleCatch';
type Request = { operation: Op; catchIndex?: 0 | 1; catchId?: string; inputLog?: unknown };
const KEYS: Record<Op, string[]> = {
  status: ['schemaVersion', 'operation'], crash: ['schemaVersion', 'operation'],
  issueCatch: ['schemaVersion', 'operation', 'catchIndex', 'duelInputs'],
  settleCatch: ['schemaVersion', 'operation', 'catchIndex', 'catchId', 'inputLog'],
};
export function readZellCrashRequest(raw: unknown): Request {
  const c = raw as Record<string, unknown>;
  if (!c || typeof c !== 'object' || Array.isArray(c) || c.schemaVersion !== ZELL_CRASH_SCHEMA || typeof c.operation !== 'string'
    || !Object.prototype.hasOwnProperty.call(KEYS, c.operation)) return fail('invalid_request');
  const op = c.operation as Op, keys = KEYS[op];
  if (Object.keys(c).length !== keys.length || keys.some(k => !(k in c))) return fail('invalid_request');
  if (op === 'status' || op === 'crash') return { operation: op };
  if (c.catchIndex !== 0 && c.catchIndex !== 1) return fail('invalid_request');
  if (op === 'issueCatch') {
    // capability, not a mode: the client says it can record + upload duel-inputs-2
    if (c.duelInputs !== FIGHT_INPUTS_SCHEMA) return fail('invalid_request');
    return { operation: op, catchIndex: c.catchIndex };
  }
  if (typeof c.catchId !== 'string' || !ZELL_CATCH_ID.test(c.catchId)) return fail('invalid_request');
  return { operation: op, catchIndex: c.catchIndex, catchId: c.catchId, inputLog: c.inputLog };
}

/** The catch-duel issue block: the squad at full HP vs JUSAN (tier per catch) on duel-rules-4, the runner-biased profile. */
export function buildCatchIssue(profile: Record<string, unknown>, catchId: string, catchIndex: 0 | 1, seed: string): FightReplayIssueWire {
  let squad: string[];
  try { squad = readTravelSquad(profile).holobotIds; } catch { return fail(); }
  const player = buildPlayerCombatants(profile, squad).map(p => { const { currentHealth: _c, ...rest } = p as typeof p & { currentHealth?: number }; return rest; });
  if (player.length === 0) return fail('squad_required');
  const def = ZELL_CATCHES[catchIndex];
  const jusan = { ...rivalScaledCombatant('jusan', def.tier), ...rivalScaledCombatantStats(def.tier), commandRules: desktopPracticeCommands('jusan') };
  const issue = buildFightReplayIssue({ battleId: catchId, seed, tier: def.tier, mentor: false, player, opponent: [jusan], chase: true });
  if (!issue) return fail();
  issue.cpu = { ...issue.cpu, profile: zellRunnerProfile() };
  return issue;
}

export type ZellCrashOptions = { enabled?: boolean };
type Reply = Record<string, unknown>;
const envelope = (operation: Op, flags: StoryFlags, r: ZellCrashRecord | null, phase: ZellPhase, uid: string, extra: Reply = {}): Reply => ({
  schemaVersion: ZELL_CRASH_SCHEMA, operation, ...extra, storyFlags: flags, zellCrash: zellCrashView(r), zellPhase: phase, roster: gatheringRoster(uid),
});

/** Settle-time replay, run OUTSIDE the transaction (CPU work never repeats on a retry). Undefined = nothing to verify. */
async function preVerifyCatch(db: Firestore, uid: string, req: Request) {
  if (req.operation !== 'settleCatch') return undefined;
  const r = readZellCrash((await db.doc(ZELL_CRASH_PATH(uid)).get()).data());
  const c = r?.catches[String(req.catchIndex) as '0' | '1'];
  if (!c || c.catchId !== req.catchId || c.settlement) return undefined;
  const escape = readCatchEscape(c.escape);
  let hit: CatchEscapeCause | null = null;
  try {
    const verdict = verifyFightReplay(c.duel, req.inputLog, {
      battleId: c.catchId,
      stopWhen: core => (hit = catchEscapeHit(core, escape)) !== null,
    });
    const cause: CatchEscapeCause = verdict.stopped && hit ? hit : verdict.winner === 1 ? 'player_ko' : verdict.winner === 0 ? 'runner_ko' : 'time';
    return { catchId: c.catchId, rulesHash: c.duel.rulesHash, seed: c.duel.seed, verdict, cause };
  } catch (e) {
    if (!(e instanceof FightReplayError)) throw e;
    if (e.code === 'invalid_issue') return fail();
    return fail(e.code === 'invalid_log' ? 'invalid_log' : 'replay_mismatch');
  }
}

export async function transactZellCrash(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now(), options: ZellCrashOptions = {}): Promise<Reply> {
  const enabled = options.enabled ?? process.env[ZELL_CRASH_FLAG] === '1';
  if (!enabled) return fail();
  const req = readZellCrashRequest(raw);
  if (!whole(nowMs)) return fail();
  // pinned outside the transaction so a retry issues the same catch
  const catchId = `zc_${randomBytes(12).toString('hex')}`, seed = randomBytes(32).toString('hex');
  const pre = await preVerifyCatch(db, uid, req);
  const userRef = db.doc(`users/${uid}`), arcRef = db.doc(ZELL_CRASH_PATH(uid)), storyRef = db.doc(`storyProgress/${uid}`);
  return db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) return fail();
    const profile = user.data()!;
    const flags = readStoryFlags(profile.storyFlags);
    const arc = readZellCrash((await tx.get(arcRef)).data());
    let zell;
    try { zell = readZellStory((await tx.get(storyRef)).data()); } catch { return fail(); }
    // ---- all reads above, writes below ----
    if (req.operation === 'status') return envelope('status', flags, arc, zell.phase, uid);
    if (req.operation === 'crash') {
      if (arc) return envelope('crash', flags, arc, zell.phase, uid, { alreadySeen: true });
      if (!flags.arenaArcBuilt) return fail('arena_arc_required');
      const next: ZellCrashRecord = { schemaVersion: ZELL_CRASH_SCHEMA, seenAtMs: nowMs, trophy: { state: 'stolen', stolenAtMs: nowMs }, catches: {} };
      const storyFlags = { ...flags, holoZonesArcBuilt: true };
      const nextZell = meetZell(zell, nowMs);
      tx.set(arcRef, next);
      if (!flags.holoZonesArcBuilt) tx.update(userRef, { storyFlags });
      if (nextZell !== zell) tx.set(storyRef, nextZell);
      return envelope('crash', storyFlags, next, nextZell.phase, uid, { alreadySeen: false });
    }
    if (!arc) return fail('crash_required');
    const i = req.catchIndex!, key = String(i) as '0' | '1', existing = arc.catches[key];
    if (req.operation === 'issueCatch') {
      const state = catchState(arc, i);
      if (state === 'locked') return fail('catch_locked');
      if (state === 'escaped') return fail('catch_settled');
      if (existing) return envelope('issueCatch', flags, arc, zell.phase, uid, { catchIndex: i, catchId: existing.catchId, alreadyIssued: true, duel: existing.duel, escape: existing.escape });
      const c: ZellCatchRecord = { catchId, issuedAtMs: nowMs, duel: buildCatchIssue(profile, catchId, i, seed), escape: { ...ZELL_CATCHES[i].escape }, settlement: null };
      const next = { ...arc, catches: { ...arc.catches, [key]: c } };
      tx.set(arcRef, next);
      return envelope('issueCatch', flags, next, zell.phase, uid, { catchIndex: i, catchId, alreadyIssued: false, duel: c.duel, escape: c.escape });
    }
    // settleCatch
    if (!existing || existing.catchId !== req.catchId) return fail('unknown_catch');
    if (existing.settlement) {
      return envelope('settleCatch', flags, arc, zell.phase, uid, { catchIndex: i, catchId: existing.catchId, alreadyProcessed: true, outcome: 'escaped', cause: existing.settlement.cause, catchReceipt: existing.settlement.receipt });
    }
    // the replay ran before the transaction against this same immutable issue; a concurrent first settle never reuses it
    if (!pre || pre.catchId !== existing.catchId || pre.rulesHash !== existing.duel.rulesHash || pre.seed !== existing.duel.seed) return fail();
    const base = pre.verdict.receipt;
    const receipt: ZellCatchReceipt = { ...base, schemaVersion: ZELL_CATCH_RECEIPT_SCHEMA, reason: pre.verdict.stopped ? 'escaped' : base.reason, outcome: 'escaped', cause: pre.cause };
    const settled: ZellCatchRecord = { ...existing, settlement: { outcome: 'escaped', cause: pre.cause, settledAtMs: nowMs, receipt } };
    const next = { ...arc, catches: { ...arc.catches, [key]: settled } };
    tx.set(arcRef, next);
    return envelope('settleCatch', flags, next, zell.phase, uid, { catchIndex: i, catchId: existing.catchId, alreadyProcessed: false, outcome: 'escaped', cause: pre.cause, catchReceipt: receipt });
  });
}
