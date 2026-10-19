/**
 * DECISIONS #72.3 (onboarding D1, Pak 2026-10-18): the mentor duel. While the account's host onboarding step is
 * <= 3 and not skipped (lib/onboarding.ts onboardingMentorActive), an ordinary rival issue — the one Unity sends
 * from Kaz's row rival_wolf_01; not an Arena-gathering citizen, not the Zell story rival — fields exactly ONE WOLF
 * on the softest tier's stats (tier 0: rival-battle-3 = WOLF L1 battle stats + the tier-0 CPU damage scale;
 * rival-battle-1 / -2 = the #43 tier-0 baseline row). The record carries `onboardingMentor: true`; the settle
 * reads that flag (never the current step) so a LOSS writes no HP change and no per-rival cooldown. A win pays
 * and records exactly as any rival win. The lineup draws are already consumed by issueRivalBattle, so the seed
 * and battle id are unchanged; only the opponent rows are replaced.
 *
 * Pure module: no firebase imports.
 */
import type { IssueReply, RivalBattleRecord, RivalLineupScale } from "../lib/rivalLadder";
import { getRivalTierRow, rivalCombatant, rivalScaledCombatant, rivalScaledCombatantStats, RIVAL_LINEUP_SCALE_WOLF } from "../lib/rivalLadder";
import { desktopPracticeCommands } from "../lib/desktopPracticeCommands";

export const ONBOARDING_MENTOR_HOLOBOT = "wolf";
export const ONBOARDING_MENTOR_TIER = 0;
export const ONBOARDING_MENTOR_FIELD = "onboardingMentor";

export type MentorRecord = RivalBattleRecord & { onboardingMentor?: boolean };

/** Rewrites an issued lineup (record + reply) in place to the D1 mentor lineup and flags the record. */
export function applyOnboardingMentor(r: { battle: RivalBattleRecord; reply: IssueReply }, scale: RivalLineupScale): void {
  const tier = ONBOARDING_MENTOR_TIER;
  const wolf = scale === RIVAL_LINEUP_SCALE_WOLF ? rivalScaledCombatant(ONBOARDING_MENTOR_HOLOBOT, tier) : rivalCombatant(ONBOARDING_MENTOR_HOLOBOT, getRivalTierRow(tier));
  r.battle.lineup = { ...r.battle.lineup, opponentSquad: [wolf] };
  (r.battle as MentorRecord).onboardingMentor = true;
  const replyRow = scale === RIVAL_LINEUP_SCALE_WOLF
    ? { ...wolf, ...rivalScaledCombatantStats(tier), commandRules: desktopPracticeCommands(ONBOARDING_MENTOR_HOLOBOT) }
    : { ...wolf };
  r.reply.encounter = { ...r.reply.encounter, opponentSquad: [replyRow] };
}

/** True only for a record issued under the mentor rule. */
export function isOnboardingMentorBattle(record: unknown): boolean {
  return !!record && typeof record === "object" && (record as MentorRecord).onboardingMentor === true;
}
