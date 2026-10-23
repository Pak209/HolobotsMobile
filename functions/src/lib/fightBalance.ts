/**
 * #72.80 roster balance pass (lane speed-special-p2-1): the FIGHT base-stat rows the duel-rules-5 issue uses. Pak: "the base
 * stats should ideally come from Holobots Mobile Base stats for each, Jusan would need his own".
 *
 * Same units and formula as HOLOBOT_BASE_STATS / getHolobotBattleStats (progression.ts): battle stat = floor(base x 10 x
 * levelBonus) (HP without the x10) + flat boosts. Rows were tuned with the cold field matrix (Holocity
 * Tools/BattleScalingCold/speed_special/balance_solver.py; README Documentation/QA/2026-10-23-speed-special-p2-1) with the
 * identity rules: SPEED and SPECIAL (intelligence) columns untouched, ATTACK / DEFENSE at most 1-2 steps, HP within the
 * archetype band. JUSAN gets his own row (twin blades / crosscut striker: fast, sharp, light) instead of the ACE fallback.
 *
 * NOT live progression: display stats, quests, training, battlefield movement and the legacy duel resolver keep reading
 * HOLOBOT_BASE_STATS. Only buildFightReplayIssue applies these rows, and only on a duel-rules-5 issue (host flags
 * HOLOCITY_FIGHT_ATTRS + HOLOCITY_FIGHT_CHASE, default off), as a per-bot delta on progression-sourced combatants. Promoting
 * them to HOLOBOT_BASE_STATS is a separate call (it would move displayed stats, quest power and rival tiers).
 */
import { getHolobotBattleStats, HOLOBOT_BASE_STATS } from './progression';

type Row = { attack: number; defense: number; hp: number; intelligence: number; speed: number };

export const HOLOBOT_FIGHT_BASE_STATS_72_80: Record<string, Row> = {
  ACE: { attack: 6, defense: 5, hp: 123, intelligence: 5, speed: 6 },
  WOLF: { attack: 5, defense: 5, hp: 173, intelligence: 4, speed: 5 },
  GAMA: { attack: 6, defense: 5, hp: 152, intelligence: 4, speed: 4 },
  HARE: { attack: 5, defense: 5, hp: 201, intelligence: 3, speed: 4 },
  KEN: { attack: 7, defense: 3, hp: 135, intelligence: 5, speed: 6 },
  KUMA: { attack: 5, defense: 5, hp: 188, intelligence: 4, speed: 4 },
  KURAI: { attack: 5, defense: 6, hp: 224, intelligence: 3, speed: 4 },
  ERA: { attack: 5, defense: 4, hp: 192, intelligence: 4, speed: 6 },
  SHADOW: { attack: 5, defense: 7, hp: 194, intelligence: 3, speed: 4 },
  TORA: { attack: 5, defense: 4, hp: 184, intelligence: 4, speed: 6 },
  TSUIN: { attack: 6, defense: 4, hp: 160, intelligence: 4, speed: 5 },
  WAKE: { attack: 7, defense: 3, hp: 196, intelligence: 4, speed: 4 },
  JUSAN: { attack: 6, defense: 4, hp: 137, intelligence: 5, speed: 6 },
};

export type FightStatDelta = { attack: number; defense: number; maxHP: number; intelligence: number; speed: number };

/** Unboosted fight-row battle stats minus unboosted progression battle stats at this level (0s for an unknown bot). Boosts are
 * flat on both sides, so adding this to a boosted progression combatant gives the fight-row stats with the same boosts. */
export function getHolobotFightStatDelta(name: string, level = 1): FightStatDelta {
  const key = String(name || '').trim().toUpperCase();
  const row = HOLOBOT_FIGHT_BASE_STATS_72_80[key];
  if (!row) return { attack: 0, defense: 0, maxHP: 0, intelligence: 0, speed: 0 };
  const levelBonus = 1 + (Math.max(1, level) - 1) * 0.05;
  const now = getHolobotBattleStats(key in HOLOBOT_BASE_STATS ? key : 'ACE', level);
  return {
    attack: Math.floor(row.attack * 10 * levelBonus) - now.attack,
    defense: Math.floor(row.defense * 10 * levelBonus) - now.defense,
    maxHP: Math.floor(row.hp * levelBonus) - now.maxHP,
    intelligence: Math.floor(row.intelligence * 10 * levelBonus) - now.intelligence,
    speed: Math.floor(row.speed * 10 * levelBonus) - now.speed,
  };
}
