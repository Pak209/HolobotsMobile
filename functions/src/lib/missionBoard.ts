/**
 * HoloCity Mission Board (Pak's rulings, 2026-11-07): the board's postings, shared by the Unity desktop app and the
 * Lite mobile app. ONE data module: the posting tables, the deterministic generator, the refill rule, completion
 * verification against facts the store reads from existing server-only records, and the reward ruling.
 * Contract: functions/src/missionBoard/README.md.
 *
 * - Four posting kinds: beast (defeat an Error Beast at a city spot), rival (beat a rival pilot), capture (link a wild
 *   Holobot), visit (go to a district landmark).
 * - Three slots per pilot are always filled. A claimed slot shows its claimed posting until MISSION_BOARD_REFILL_MS
 *   after the claim, then the next status / claim draws a new posting into it.
 * - Rewards reuse the existing payouts: beast / rival pay BATTLE_WIN_HOLOS (100, a Guild Court win) plus the
 *   one battle table's win EXP at the pilot's CURRENT rival tier (tierForWins(users.rivalWins); no performance bonus;
 *   EXP Booster honoured) to every travel-squad Holobot, and some postings add 1 blueprint_fragment (the zone clear
 *   drop). Visits pay the intro quests' 50 / 75 Holos.
 * - Capture postings (Pak, 2026-11-08) pay MISSION_BOARD_CAPTURE_REWARD instead: 50 Holos + 1 Light Buddy Unit, no EXP.
 * - Intro quests alongside (Pak, 2026-11-07 follow-up): status shows the intro chain while it is incomplete AND the 3
 *   postings from day one; intro step claims are forwarded to the intro quest store (nothing is duplicated here).
 * - District ids are the shared city plan's (lib/cityDistricts.ts, D01..D10), resolved from plan coordinates.
 *
 * Generation is deterministic: a posting is a pure function of (uid, the board's stored seed, the posting serial, the
 * kinds held by the other open slots, the target candidates). No Math.random; a retried transaction rules identically.
 *
 * Pure module: no firebase imports, safe to import from tests (functions/scripts/test-mission-board.mjs).
 */
import { createHash } from "node:crypto";
import { awardBattleExperienceRaw, HolobotProgressionEntry } from "./battleProgression";
import { BattleKind, computeBattleSettlement } from "./battleSettlement";
import { BLUEPRINT_FRAGMENT_STOCK, itemStocksAfterFragmentGrant } from "./holoZoneRuns";
import { BUDDY_UNITS_FIELD, BuddyInventory, readBuddyInventory, withTierDelta } from "./buddyUnits";
import { BATTLE_WIN_HOLOS, holosAfterGrant } from "./rivalLadder";
import { REQUEST_ID } from "./introQuests";
import { CITY_SITES, cityDistrictAt } from "./cityDistricts";
import { CITY_WILD_SPOTS, spotCycleOf } from "../city/cityWildSpots";

export const MISSION_BOARD_SCHEMA = "mission-board-1";
export const MISSION_BOARD_SLOTS = 3;
/** One constant (Pak's default): a cleared slot gets its new posting this long after the claim. */
export const MISSION_BOARD_REFILL_MS = 10 * 60 * 1000;
/** requestId ledger kept on the board doc (newest last); older claims fall out (then: unknown_posting, nothing paid). */
export const MISSION_BOARD_MAX_CLAIMS = 30;
/** Battle postings: the Guild Court run's win payout. */
export const MISSION_BOARD_BATTLE_HOLOS = BATTLE_WIN_HOLOS;
/** A battle posting's EXP per Holobot at rival tier `tier` (the one battle table, a win, no performance bonus). */
export function missionBoardExp(tier: number): number {
  return computeBattleSettlement({ kind: "beast", tier, didWin: true })!.exp;
}
/** Item id of a posting's Light Buddy Unit (the buddy tier id; granted through the Buddy Unit inventory, not itemStocks). */
export const BUDDY_LIGHT_ITEM = "buddy_light";
/** Capture postings (Pak, 2026-11-08): the attempt costs a Unit, so the posting pays one back. */
export const MISSION_BOARD_CAPTURE_REWARD: Readonly<PostingReward> = Object.freeze({ holos: 50, items: [{ itemId: BUDDY_LIGHT_ITEM, quantity: 1 }] });
/** A battle posting carries 1 blueprint_fragment when its hash byte % this === 0 (about one in three). */
export const MISSION_BOARD_FRAGMENT_ONE_IN = 3;
export const MISSION_BOARD_FRAGMENTS = 1;

export type PostingKind = "beast" | "rival" | "capture" | "visit";
export const POSTING_KINDS: readonly PostingKind[] = ["beast", "rival", "capture", "visit"];
export type PostingItem = { itemId: string; quantity: number };
export type PostingReward = { holos: number; exp?: number; items?: PostingItem[] };
export type PostingState = "open" | "complete" | "claimed";

// ---- Target tables (real targets that exist today) ----

/** Beast postings: city court zones (holoZoneRuns kind "beast"). Guild Court only for now. */
export const BEAST_TARGETS: readonly { zoneId: string; districtId: string; title: string; detail: string }[] = [
  { zoneId: "guild_court", districtId: cityDistrictAt(CITY_SITES.guildCourt.x, CITY_SITES.guildCourt.z), title: "Guild Court sweep", detail: "Defeat an Error Beast at the Guild Court." },
];
/** Rival target matching any settled rival win. */
export const RIVAL_ANY = "any";
/** Rival target matching the town rival ladder (rivalLadder.ts pilotId rival_tier_{tier}; Kaz's row). */
export const RIVAL_TOWN = "town_rival";
export const TOWN_RIVAL_PILOT = /^rival_tier_\d+$/;
/** Citizens (and "any rival") duel at the Arena Gate; the town rival at the Arena dome. */
export const RIVAL_DISTRICT = cityDistrictAt(CITY_SITES.arenaGate.x, CITY_SITES.arenaGate.z);
export const TOWN_RIVAL_DISTRICT = cityDistrictAt(CITY_SITES.arenaDome.x, CITY_SITES.arenaDome.z);
/** Capture postings target a wild SPOT: Unity's 11 repeatable spots (city/cityWildSpots.ts) or the once-only KURAI garden. */
export const CITY_KURAI_HOLOBOT = "kurai";
export const KURAI_GARDEN_SPOT = "kurai_garden";
export const KURAI_GARDEN_ENCOUNTER = "city_kurai_garden";
export type CaptureSpot = { spotId: string; holobotId: string; districtId: string; label: string };
export const CAPTURE_SPOTS: readonly CaptureSpot[] = [
  ...CITY_WILD_SPOTS.map((s) => ({ spotId: s.spotId, holobotId: s.holobotId, districtId: s.districtId, label: s.unityDistrict })),
  { spotId: KURAI_GARDEN_SPOT, holobotId: CITY_KURAI_HOLOBOT, districtId: cityDistrictAt(CITY_SITES.kuraiGarden.x, CITY_SITES.kuraiGarden.z), label: "Research Garden" },
];
/** Whether a capture receipt's encounter belongs to capture spot `spotId`. */
export function captureSpotMatches(spotId: string, encounterId: string): boolean {
  if (spotId === KURAI_GARDEN_SPOT) return encounterId === KURAI_GARDEN_ENCOUNTER;
  return spotCycleOf(spotId, encounterId) !== null;
}
/** Visit postings: intro quest destination ids (+ harbor); Holos as the intro visits pay; district from the landmark. */
const site = (p: { x: number; z: number }) => cityDistrictAt(p.x, p.z);
export const VISIT_TARGETS: readonly { destinationId: string; districtId: string; holos: number; label: string }[] = [
  { destinationId: "mission_board", districtId: site(CITY_SITES.missionBoard), holos: 50, label: "Mission Board" },
  { destinationId: "marketplace", districtId: site(CITY_SITES.marketRow), holos: 50, label: "Marketplace" },
  { destinationId: "workshop", districtId: site(CITY_SITES.workshopHall), holos: 75, label: "Workshop" },
  { destinationId: "harbor", districtId: site(CITY_SITES.ferryTerminal), holos: 75, label: "Harbor" },
  { destinationId: "portal_terminal", districtId: site(CITY_SITES.portalTerminal), holos: 75, label: "Portal Terminal" },
];

/** What the generator may draw from, gathered by the store. */
export type BoardCandidates = {
  /** Arena-gathering citizens (story/arenaGathering.ts gatheringRoster), only once the gathering was seen; else []. */
  citizens: readonly { citizenId: string; pilotName: string }[];
  /** Capture spot ids a posting may name (the 11 repeatable spots; kurai_garden is no longer issued but stays a valid stored target). */
  captureTargets: readonly string[];
};

// ---- Errors ----

export type MissionBoardErrorCode = "invalid_request" | "unknown_posting" | "not_complete" | "already_claimed" | "refill_pending" | "out_of_order" | "unavailable";
export class MissionBoardError extends Error {
  constructor(public code: MissionBoardErrorCode, public detail?: Record<string, unknown>) {
    super(code);
  }
}

// ---- Stored state: missionBoards/{uid} (server-only; rules deny every client read/write) ----

/** expTier: the rival tier the EXP was ruled at (battle postings; visits record the tier too, with 0 EXP). */
export type PostingGrant = { holos: number; expPerHolobot: number; expTier: number; items: PostingItem[] };
export type PostingClaim = { requestId: string; claimedAtMs: number; granted: PostingGrant; progression: HolobotProgressionEntry[] };
export type Posting = {
  postingId: string;
  serial: number;
  kind: PostingKind;
  title: string;
  detail: string;
  target: string;
  /** capture: the spot's Holobot; "" for other kinds. */
  holobotId: string;
  districtId: string;
  /** Stored without `exp`: the view adds it at the pilot's current tier. */
  reward: PostingReward;
  issuedAtMs: number;
  claim: PostingClaim | null;
};
export type BoardSlot = { posting: Posting; refillAtMs: number | null };
export type ClaimLedgerRow = { requestId: string; postingId: string; kind: PostingKind; claimedAtMs: number; granted: PostingGrant; progression: HolobotProgressionEntry[] };
export type MissionBoardDoc = {
  schemaVersion: typeof MISSION_BOARD_SCHEMA;
  seed: string;
  nextSerial: number;
  slots: BoardSlot[];
  claims: ClaimLedgerRow[];
  /** The latest status reply's time: postings issued after it raise hostFlags.new_posting. */
  seenThroughMs: number;
};

export const BOARD_SEED = /^[0-9a-f]{16,128}$/;
export const POSTING_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const nonNegInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ---- Generation ----

function digest(uid: string, seed: string, serial: number): Buffer {
  return createHash("sha256").update(JSON.stringify([MISSION_BOARD_SCHEMA, uid, seed, serial])).digest();
}
const titleCase = (id: string) => id.toUpperCase();

/** Kinds that have at least one target right now. beast / rival / visit always do. */
export function availableKinds(c: BoardCandidates): PostingKind[] {
  return POSTING_KINDS.filter((k) => k !== "capture" || c.captureTargets.length > 0);
}

/**
 * The posting with `serial`, issued at nowMs. Its kind avoids `heldKinds` (the other OPEN slots' kinds) where any
 * kind is left; then the target, the visit amount and the fragment come from the same digest.
 */
export function generatePosting(uid: string, seed: string, serial: number, heldKinds: readonly PostingKind[], c: BoardCandidates, nowMs: number): Posting {
  const h = digest(uid, seed, serial);
  const avail = availableKinds(c);
  const fresh = avail.filter((k) => !heldKinds.includes(k));
  const pool = fresh.length ? fresh : avail;
  const kind = pool[h.readUInt32BE(0) % pool.length];
  const pick = h.readUInt32BE(4);
  const fragment = h[8] % MISSION_BOARD_FRAGMENT_ONE_IN === 0;
  const postingId = `mbp_${serial}_${h.toString("hex").slice(0, 12)}`;
  const battleReward = (): PostingReward => ({
    holos: MISSION_BOARD_BATTLE_HOLOS,
    ...(fragment ? { items: [{ itemId: BLUEPRINT_FRAGMENT_STOCK, quantity: MISSION_BOARD_FRAGMENTS }] } : {}),
  });
  const base = { postingId, serial, kind, holobotId: "", issuedAtMs: nowMs, claim: null };
  if (kind === "beast") {
    const t = BEAST_TARGETS[pick % BEAST_TARGETS.length];
    return { ...base, title: t.title, detail: t.detail, target: t.zoneId, districtId: t.districtId, reward: battleReward() };
  }
  if (kind === "rival") {
    const targets = [RIVAL_TOWN, RIVAL_ANY, ...c.citizens.map((x) => x.citizenId)];
    const target = targets[pick % targets.length];
    const citizen = c.citizens.find((x) => x.citizenId === target);
    const text = target === RIVAL_TOWN ? { title: "Beat the town rival", detail: "Win a rival battle against the town rival.", districtId: TOWN_RIVAL_DISTRICT }
      : target === RIVAL_ANY ? { title: "Beat a rival pilot", detail: "Win a rival battle against any pilot.", districtId: RIVAL_DISTRICT }
      : { title: `Beat ${citizen!.pilotName}`, detail: `Win a duel against citizen pilot ${citizen!.pilotName}.`, districtId: RIVAL_DISTRICT };
    return { ...base, ...text, target, reward: battleReward() };
  }
  if (kind === "capture") {
    const target = c.captureTargets[pick % c.captureTargets.length];
    const spot = CAPTURE_SPOTS.find((x) => x.spotId === target);
    if (!spot) throw new MissionBoardError("unavailable");
    const bot = titleCase(spot.holobotId);
    return { ...base, title: `Link ${bot}`, detail: `Link the wild ${bot} at the ${spot.label}.`, target, holobotId: spot.holobotId, districtId: spot.districtId, reward: captureReward() };
  }
  const v = VISIT_TARGETS[pick % VISIT_TARGETS.length];
  return { ...base, title: `Visit the ${v.label}`, detail: `Check in at the ${v.label}.`, target: v.destinationId, districtId: v.districtId, reward: { holos: v.holos } };
}

const openKinds = (slots: readonly BoardSlot[], except: number) => slots.filter((s, i) => i !== except && !s.posting.claim).map((s) => s.posting.kind);

/** A brand-new board: three postings (serials 0..2), each avoiding the kinds drawn before it. */
export function freshBoard(uid: string, seed: string, c: BoardCandidates, nowMs: number): MissionBoardDoc {
  if (!BOARD_SEED.test(seed)) throw new MissionBoardError("unavailable");
  const slots: BoardSlot[] = [];
  for (let i = 0; i < MISSION_BOARD_SLOTS; i++) slots.push({ posting: generatePosting(uid, seed, i, slots.map((s) => s.posting.kind), c, nowMs), refillAtMs: null });
  return { schemaVersion: MISSION_BOARD_SCHEMA, seed, nextSerial: MISSION_BOARD_SLOTS, slots, claims: [], seenThroughMs: 0 };
}

/** Every claimed slot whose refillAtMs has passed gets the next serial's posting (slot order). */
export function refillBoard(board: MissionBoardDoc, uid: string, c: BoardCandidates, nowMs: number): { board: MissionBoardDoc; changed: boolean } {
  let changed = false;
  const next: MissionBoardDoc = structuredClone(board);
  next.slots.forEach((slot, i) => {
    if (!slot.posting.claim || slot.refillAtMs === null || nowMs < slot.refillAtMs) return;
    next.slots[i] = { posting: generatePosting(uid, next.seed, next.nextSerial, openKinds(next.slots, i), c, nowMs), refillAtMs: null };
    next.nextSerial += 1;
    changed = true;
  });
  return { board: changed ? next : board, changed };
}

// ---- Reading the stored doc (fail closed) ----

function validReward(r: unknown): boolean {
  if (!isObj(r) || !nonNegInt(r.holos)) return false;
  if (r.exp !== undefined && !nonNegInt(r.exp)) return false;
  if (r.items !== undefined && !(Array.isArray(r.items) && r.items.every((x) => isObj(x) && typeof x.itemId === "string" && nonNegInt(x.quantity)))) return false;
  return true;
}
function validGrant(g: unknown): boolean {
  return isObj(g) && nonNegInt(g.holos) && nonNegInt(g.expPerHolobot) && nonNegInt(g.expTier) && Array.isArray(g.items) && g.items.every((x) => isObj(x) && typeof x.itemId === "string" && nonNegInt(x.quantity));
}
function validPosting(p: unknown): boolean {
  if (!isObj(p)) return false;
  if (typeof p.postingId !== "string" || !POSTING_ID.test(p.postingId) || !nonNegInt(p.serial) || !POSTING_KINDS.includes(p.kind as PostingKind)) return false;
  if (typeof p.title !== "string" || typeof p.detail !== "string" || typeof p.target !== "string" || typeof p.holobotId !== "string" || typeof p.districtId !== "string" || !nonNegInt(p.issuedAtMs) || !validReward(p.reward)) return false;
  if (p.claim !== null) {
    const c = p.claim;
    if (!isObj(c) || typeof c.requestId !== "string" || !REQUEST_ID.test(c.requestId) || !nonNegInt(c.claimedAtMs) || !validGrant(c.granted) || !Array.isArray(c.progression)) return false;
  }
  return true;
}

/** undefined = no board yet (null). Anything present must be consistent, or `unavailable`: never reset, never re-paid. */
export function readBoard(raw: unknown): MissionBoardDoc | null {
  if (raw === undefined) return null;
  const fail = (): never => { throw new MissionBoardError("unavailable"); };
  if (!isObj(raw) || raw.schemaVersion !== MISSION_BOARD_SCHEMA || typeof raw.seed !== "string" || !BOARD_SEED.test(raw.seed) || !nonNegInt(raw.nextSerial) || !nonNegInt(raw.seenThroughMs)) fail();
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.slots) || r.slots.length !== MISSION_BOARD_SLOTS) fail();
  for (const s of r.slots as unknown[]) {
    if (!isObj(s) || !validPosting(s.posting)) fail();
    const slot = s as unknown as BoardSlot;
    if (slot.posting.claim ? !nonNegInt(slot.refillAtMs) : slot.refillAtMs !== null) fail();
    if (slot.posting.serial >= (r.nextSerial as number)) fail();
  }
  const ids = (r.slots as BoardSlot[]).map((s) => s.posting.postingId);
  if (new Set(ids).size !== ids.length) fail();
  if (!Array.isArray(r.claims) || r.claims.length > MISSION_BOARD_MAX_CLAIMS) fail();
  const seen = new Set<string>();
  for (const c of r.claims as unknown[]) {
    if (!isObj(c) || typeof c.requestId !== "string" || !REQUEST_ID.test(c.requestId) || seen.has(c.requestId) || typeof c.postingId !== "string"
      || !POSTING_KINDS.includes(c.kind as PostingKind) || !nonNegInt(c.claimedAtMs) || !validGrant(c.granted) || !Array.isArray(c.progression)) fail();
    seen.add((c as { requestId: string }).requestId);
  }
  return structuredClone(raw) as unknown as MissionBoardDoc;
}

// ---- Commands ----

export type MissionBoardCommand = { operation: "status" } | { operation: "claim"; postingId: string; requestId: string; destinationId: string };

export function validateMissionBoardCommand(raw: unknown): MissionBoardCommand {
  if (!isObj(raw)) throw new MissionBoardError("invalid_request");
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== MISSION_BOARD_SCHEMA) throw new MissionBoardError("invalid_request");
  if (raw.operation === "status") return { operation: "status" };
  if (raw.operation !== "claim") throw new MissionBoardError("invalid_request");
  if (typeof raw.postingId !== "string" || !POSTING_ID.test(raw.postingId)) throw new MissionBoardError("invalid_request");
  if (typeof raw.requestId !== "string" || !REQUEST_ID.test(raw.requestId)) throw new MissionBoardError("invalid_request");
  if (raw.destinationId !== undefined && (typeof raw.destinationId !== "string" || raw.destinationId.length > 128)) throw new MissionBoardError("invalid_request");
  return { operation: "claim", postingId: raw.postingId, requestId: raw.requestId, destinationId: (raw.destinationId as string | undefined) ?? "" };
}

// ---- Verification facts (gathered by the store from existing server-only records) ----

export type BoardFacts = {
  /** holoZoneRuns/{uid}.runs with a settlement. */
  zoneSettles: readonly { zoneId: string; didWin: boolean; expWithheld: boolean; settledAtMs: number }[];
  /** rivalBattles/{uid}/battles settled after the oldest open battle-posting's issuedAtMs. */
  rivalSettles: readonly { pilotId: string; didWin: boolean; settledAtMs: number }[];
  /** wildEncounterSessions/{uid}/receipts with a successful capture of a capture-posting spot's encounters; capturedAtMs = the receipt's create time. */
  captures: readonly { encounterId: string; capturedAtMs: number }[];
};
export const NO_FACTS: BoardFacts = { zoneSettles: [], rivalSettles: [], captures: [] };

/** Which fact sources the given postings need (the store skips the reads it doesn't need). */
export function factsNeeded(postings: readonly Posting[]): { zone: boolean; rival: boolean; capture: boolean; sinceMs: number } {
  const open = postings.filter((p) => !p.claim);
  const sinceMs = open.length ? Math.min(...open.map((p) => p.issuedAtMs)) : 0;
  return { zone: open.some((p) => p.kind === "beast"), rival: open.some((p) => p.kind === "rival"), capture: open.some((p) => p.kind === "capture"), sinceMs };
}

export function rivalTargetMatches(target: string, pilotId: string): boolean {
  if (target === RIVAL_ANY) return true;
  if (target === RIVAL_TOWN) return TOWN_RIVAL_PILOT.test(pilotId);
  return pilotId === target;
}

/**
 * Server-verified completion; only records written strictly after the posting's issuedAtMs count.
 * beast: a settled WIN of that zone (not a < 20 s withheld run). rival: a settled WIN against the target.
 * capture: a successful capture at the target spot (any of its encounter cycles). visit: the client's destinationId equals the target.
 */
export function postingComplete(p: Posting, facts: BoardFacts, destinationId = ""): boolean {
  const after = (ms: number) => ms > p.issuedAtMs;
  if (p.kind === "beast") return facts.zoneSettles.some((s) => s.zoneId === p.target && s.didWin && !s.expWithheld && after(s.settledAtMs));
  if (p.kind === "rival") return facts.rivalSettles.some((s) => s.didWin && after(s.settledAtMs) && rivalTargetMatches(p.target, s.pilotId));
  if (p.kind === "capture") return facts.captures.some((s) => captureSpotMatches(p.target, s.encounterId) && after(s.capturedAtMs));
  return destinationId !== "" && destinationId === p.target;
}

// ---- Replies ----

export type PostingView = {
  postingId: string; slot: number; kind: PostingKind; title: string; detail: string; target: string; holobotId: string; districtId: string;
  reward: PostingReward; issuedAtMs: number; state: PostingState;
  /** Claimed slots only: when the new posting goes up. null while the posting is open / complete. */
  refillAtMs: number | null;
  claimedAtMs: number | null;
};
export type HostFlags = { new_posting: boolean; posting_cleared: boolean };
export type BoardView = { postings: PostingView[]; refillAtMs: number | null; hostFlags: HostFlags };

const captureReward = (): PostingReward => structuredClone(MISSION_BOARD_CAPTURE_REWARD) as PostingReward;
/** What a posting pays. A capture posting issued before the 2026-11-08 ruling still carries 100 Holos; it pays the ruling. */
const payableReward = (p: Posting): PostingReward => (p.kind === "capture" ? captureReward() : p.reward);

/** The reward as shown: beast / rival add `exp` at `tier`; a claimed posting shows what it paid. */
function rewardView(p: Posting, tier: number): PostingReward {
  const paid = p.claim?.granted;
  const { exp: _stale, ...reward } = structuredClone(paid ? { holos: paid.holos, ...(paid.items.length ? { items: paid.items } : {}) } as PostingReward : payableReward(p));
  if (p.kind === "visit" || p.kind === "capture") return reward;
  return { holos: reward.holos, exp: missionBoardExp(paid ? paid.expTier : tier), ...(reward.items ? { items: reward.items } : {}) };
}

export function postingView(slot: BoardSlot, index: number, facts: BoardFacts, tier: number): PostingView {
  const p = slot.posting;
  const state: PostingState = p.claim ? "claimed" : postingComplete(p, facts) ? "complete" : "open";
  return {
    postingId: p.postingId, slot: index, kind: p.kind, title: p.title, detail: p.detail, target: p.target, holobotId: p.holobotId, districtId: p.districtId,
    reward: rewardView(p, tier), issuedAtMs: p.issuedAtMs, state, refillAtMs: p.claim ? slot.refillAtMs : null, claimedAtMs: p.claim?.claimedAtMs ?? null,
  };
}

/** `seenThroughMs`: postings issued after it raise new_posting; a verified-but-unclaimed posting raises posting_cleared. */
export function boardView(board: MissionBoardDoc, facts: BoardFacts, seenThroughMs: number, tier: number): BoardView {
  const postings = board.slots.map((s, i) => postingView(s, i, facts, tier));
  const pending = board.slots.map((s) => s.refillAtMs).filter((x): x is number => x !== null);
  return {
    postings,
    refillAtMs: pending.length ? Math.min(...pending) : null,
    hostFlags: {
      new_posting: postings.some((p) => p.state !== "claimed" && p.issuedAtMs > seenThroughMs),
      posting_cleared: postings.some((p) => p.state === "complete"),
    },
  };
}

export type BoardBalances = { holosTokens: number; blueprintFragments: number; buddyUnits: BuddyInventory };
export type ClaimReply = {
  schemaVersion: typeof MISSION_BOARD_SCHEMA; source: "posting"; postingId: string; requestId: string; kind: PostingKind; alreadyProcessed: boolean;
  granted: PostingGrant; progression: HolobotProgressionEntry[]; balances: BoardBalances; board: BoardView;
};

function balancesOf(profile: Record<string, unknown>): BoardBalances {
  const h = profile.holosTokens ?? 0;
  if (typeof h !== "number" || !Number.isFinite(h) || h < 0) throw new MissionBoardError("unavailable");
  const stocks = itemStocksAfterFragmentGrant(profile, 0);
  if (stocks === null) throw new MissionBoardError("unavailable");
  const inv = readBuddyInventory(profile);
  if (!inv) throw new MissionBoardError("unavailable");
  return { holosTokens: h, blueprintFragments: stocks[BLUEPRINT_FRAGMENT_STOCK] as number, buddyUnits: inv.units };
}

// ---- Claim ----

/**
 * Rules, in order: a replayed requestId returns its original grant (writes nothing); a requestId used for another
 * posting is invalid_request; an unknown postingId is unknown_posting (a ledger posting already refilled away is
 * already_claimed); a claimed posting is already_claimed (detail.refillAtMs); an unverified posting is not_complete.
 * A grant pays the posting's server-owned reward once, stamps the claim and schedules the slot's refill.
 * `squadIds`: the travel squad at claim time (EXP rows); [] pays Holos / items only. `tier`: the pilot's current rival
 * tier (tierForWins(users.rivalWins)); battle postings' EXP is the battle table's win at that tier.
 */
export function claimPosting(
  board: MissionBoardDoc,
  profile: Record<string, unknown>,
  cmd: Extract<MissionBoardCommand, { operation: "claim" }>,
  facts: BoardFacts,
  squadIds: readonly string[],
  nowMs: number,
  tier: number,
): { board: MissionBoardDoc | null; userUpdates: Record<string, unknown>; reply: ClaimReply } {
  if (!nonNegInt(tier)) throw new MissionBoardError("unavailable");
  const balances = balancesOf(profile);
  const replay = board.claims.find((c) => c.requestId === cmd.requestId);
  if (replay) {
    if (replay.postingId !== cmd.postingId) throw new MissionBoardError("invalid_request");
    return {
      board: null, userUpdates: {},
      reply: { schemaVersion: MISSION_BOARD_SCHEMA, source: "posting", postingId: replay.postingId, requestId: replay.requestId, kind: replay.kind, alreadyProcessed: true,
        granted: structuredClone(replay.granted), progression: structuredClone(replay.progression), balances, board: boardView(board, facts, board.seenThroughMs, tier) },
    };
  }
  const index = board.slots.findIndex((s) => s.posting.postingId === cmd.postingId);
  if (index < 0) {
    if (board.claims.some((c) => c.postingId === cmd.postingId)) throw new MissionBoardError("already_claimed");
    throw new MissionBoardError("unknown_posting");
  }
  const slot = board.slots[index];
  const p = slot.posting;
  if (p.claim) throw new MissionBoardError("already_claimed", { refillAtMs: slot.refillAtMs });
  if (!postingComplete(p, facts, cmd.destinationId)) throw new MissionBoardError("not_complete");

  const userUpdates: Record<string, unknown> = {};
  let progression: HolobotProgressionEntry[] = [];
  let expPerHolobot = 0;
  if (p.kind === "beast" || p.kind === "rival") {
    const input = { kind: (p.kind === "rival" ? "rival" : "beast") as BattleKind, tier, didWin: true };
    const award = awardBattleExperienceRaw(profile, squadIds, input, nowMs);
    if (!award) throw new MissionBoardError("unavailable");
    progression = award.progression;
    expPerHolobot = squadIds.length ? award.expPerHolobot : 0;
    if (award.expPerHolobot > 0 && award.progression.length) userUpdates.holobots = award.holobots;
  }
  const reward = payableReward(p);
  const holos = reward.holos;
  const nextHolos = holosAfterGrant(profile, holos);
  if (nextHolos === null) throw new MissionBoardError("unavailable");
  if (holos > 0) userUpdates.holosTokens = nextHolos;
  const items = (reward.items ?? []).map((x) => ({ ...x }));
  const fragments = items.filter((x) => x.itemId === BLUEPRINT_FRAGMENT_STOCK).reduce((n, x) => n + x.quantity, 0);
  const lightUnits = items.filter((x) => x.itemId === BUDDY_LIGHT_ITEM).reduce((n, x) => n + x.quantity, 0);
  if (items.some((x) => x.itemId !== BLUEPRINT_FRAGMENT_STOCK && x.itemId !== BUDDY_LIGHT_ITEM)) throw new MissionBoardError("unavailable");
  // The existing Buddy Unit inventory rule (a never-seen / legacy inventory is persisted by this same write).
  const buddyAfter = lightUnits > 0 ? withTierDelta(balances.buddyUnits, "light", lightUnits) : balances.buddyUnits;
  if (lightUnits > 0) userUpdates[BUDDY_UNITS_FIELD] = { ...buddyAfter };
  if (fragments > 0) {
    const itemStocks = itemStocksAfterFragmentGrant(profile, fragments);
    if (itemStocks === null) throw new MissionBoardError("unavailable");
    userUpdates.itemStocks = itemStocks;
  }
  const granted: PostingGrant = { holos, expPerHolobot, expTier: tier, items };
  const next: MissionBoardDoc = structuredClone(board);
  next.slots[index] = { posting: { ...p, claim: { requestId: cmd.requestId, claimedAtMs: nowMs, granted, progression } }, refillAtMs: nowMs + MISSION_BOARD_REFILL_MS };
  next.claims = [...next.claims, { requestId: cmd.requestId, postingId: p.postingId, kind: p.kind, claimedAtMs: nowMs, granted, progression }].slice(-MISSION_BOARD_MAX_CLAIMS);
  const after: BoardBalances = { holosTokens: nextHolos, blueprintFragments: balances.blueprintFragments + fragments, buddyUnits: buddyAfter };
  return {
    board: next, userUpdates,
    reply: { schemaVersion: MISSION_BOARD_SCHEMA, source: "posting", postingId: p.postingId, requestId: cmd.requestId, kind: p.kind, alreadyProcessed: false,
      granted: structuredClone(granted), progression: structuredClone(progression), balances: after, board: boardView(next, facts, next.seenThroughMs, tier) },
  };
}

export { balancesOf as missionBoardBalances };
