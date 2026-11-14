import { calculateExperience, getHolobotRank, legacyCalculateExperience } from "./progression";
import type { RepairChange } from "./accountRepairAudit";

/**
 * host-crawl-fixes-1 (crawl RC7): deterministic self-heal of a stored holobot's DERIVED progression fields before a
 * host progression loop (applyHolobotExperience) runs on it. Pure; no firebase imports.
 *
 * Authority: `level` and `experience` are the stored facts and are never changed here. Everything repaired is a
 * function of them under the server's own rules (lib/progression.ts), or a no-value coercion:
 *  - nextLevelExp  -> calculateExperience(level + 1) whenever present and different (web-era rows store 100 at LV1;
 *                     a stale LOWER threshold would otherwise let the XP loop level the bot early, which is why the
 *                     arena used to refuse it).
 *  - attributePoints: null -> 0; a whole-number string -> that number; a finite non-negative fraction -> floor.
 *  - boostedAttributes: null -> {}; a null/undefined entry -> dropped (it already reads as 0); a whole-number string
 *                     entry -> that number.
 * None of these can raise a level, XP, a point or a boost above what the record already holds, with ONE exception:
 *  - early-progression-1 catch-up: `experience` is kept, but a record that was canonical under the old floor(100 x L^2)
 *    curve and is at or past the new (cheaper, levels 2-5) threshold is raised to its new-curve level, with +1 attribute
 *    point per level gained, nextLevelExp and rank to match (at most one level for any old-canonical record).
 *
 * Refused (never guessed): malformed level / experience, experience at or past the next level's threshold under the OLD
 * curve too (healing that would be a level-up grant, clamping it would destroy XP), negative or non-finite points / boosts,
 * a non-object boostedAttributes. The caller reports these as a non-transient `holobot_record_invalid` + reason.
 */
type Data = Record<string, unknown>;
export type HolobotRepairRefusal =
  | "level_malformed"
  | "experience_malformed"
  | "experience_over_level"
  | "attribute_points_malformed"
  | "boosted_attributes_malformed";
export type HolobotRepair =
  | { ok: true; holobot: Data; changes: RepairChange[] }
  | { ok: false; reason: HolobotRepairRefusal };

const whole = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const wholeString = (x: unknown): number | undefined => {
  if (typeof x !== "string" || !/^\d{1,15}$/.test(x)) return undefined;
  const n = Number(x);
  return Number.isSafeInteger(n) ? n : undefined;
};

export function repairHolobotProgression(bot: Data, pathPrefix = "holobot"): HolobotRepair {
  const storedLevel = bot.level ?? 1, exp = bot.experience ?? 0;
  if (!whole(storedLevel) || storedLevel < 1) return { ok: false, reason: "level_malformed" };
  if (!whole(exp)) return { ok: false, reason: "experience_malformed" };
  // early-progression-1 (Pak 2026-11-12): the curve's levels 2-5 got cheaper. A record that was canonical under the OLD curve
  // (exp below floor(100 x (level+1)^2)) but is at or past the NEW threshold is the curve change, not a forgery: it catches up
  // to its new-curve level here (+1 attribute point per level gained, the ordinary level-up rule). Past the old threshold it is
  // still refused, exactly as before.
  let level = storedLevel;
  if (exp >= calculateExperience(level + 1) && exp < legacyCalculateExperience(level + 1)) {
    while (exp >= calculateExperience(level + 1)) level += 1;
  }
  const threshold = calculateExperience(level + 1);
  if (!whole(threshold) || exp >= threshold) return { ok: false, reason: "experience_over_level" };

  const out: Data = { ...bot };
  const changes: RepairChange[] = [];
  const set = (field: string, after: unknown) => { changes.push({ path: `${pathPrefix}.${field}`, before: bot[field], after }); out[field] = after; };

  if (level !== storedLevel) {
    set("level", level);
    if (bot.rank !== undefined) set("rank", getHolobotRank(level));
  }
  if ((bot.nextLevelExp !== undefined || level !== storedLevel) && bot.nextLevelExp !== threshold) set("nextLevelExp", threshold);

  const points = bot.attributePoints;
  // Levels gained by the early-progression-1 catch-up each grant +1 point. An absent attributePoints already reads as `level`
  // (normalizeUserHolobot), so it is left absent and follows the new level by itself.
  const gained = level - storedLevel;
  if (points !== undefined && !whole(points)) {
    let coerced: number;
    if (points === null) coerced = 0;
    else if (wholeString(points) !== undefined) coerced = wholeString(points)!;
    else if (typeof points === "number" && Number.isFinite(points) && points >= 0 && Number.isSafeInteger(Math.floor(points))) coerced = Math.floor(points);
    else return { ok: false, reason: "attribute_points_malformed" };
    set("attributePoints", coerced + gained);
  } else if (points !== undefined && gained > 0) set("attributePoints", (points as number) + gained);

  const boosts = bot.boostedAttributes;
  if (boosts === null) set("boostedAttributes", {});
  else if (boosts !== undefined) {
    if (typeof boosts !== "object" || Array.isArray(boosts)) return { ok: false, reason: "boosted_attributes_malformed" };
    const next: Data = {};
    let changed = false;
    for (const [key, value] of Object.entries(boosts as Data)) {
      if (whole(value)) next[key] = value;
      else if (value === null || value === undefined) changed = true;
      else if (wholeString(value) !== undefined) { next[key] = wholeString(value); changed = true; }
      else return { ok: false, reason: "boosted_attributes_malformed" };
    }
    if (changed) set("boostedAttributes", next);
  }
  return { ok: true, holobot: out, changes };
}

/**
 * exp-catch-up-on-read (2026-11-12): the early-progression-1 catch-up, applied to every stored Holobot when the account is read
 * (desktopAccountSnapshot), so a Holobot that already holds its new-curve EXP stops showing "EXP 335 / 200" at its old level
 * before its next award. Only records whose LEVEL the repair raises are replaced (with the repair's whole consistent record:
 * level, nextLevelExp, rank, +1 attribute point per level gained); every other record, including one the repair refuses, is left
 * byte for byte as stored. EXP is never changed. `holobots` is absent when nothing changed. Pure.
 */
export function catchUpHolobotLevels(stored: unknown): { holobots?: unknown[]; changes: RepairChange[] } {
  if (!Array.isArray(stored)) return { changes: [] };
  const changes: RepairChange[] = [];
  let changed = false;
  const holobots = stored.map((bot: unknown, index: number) => {
    if (!bot || typeof bot !== "object" || Array.isArray(bot)) return bot;
    const b = bot as Data;
    const key = typeof b.name === "string" ? b.name.trim().toLowerCase().replace(/\s+/g, "-") : String(index);
    const healed = repairHolobotProgression(b, `holobots.${key}`);
    if (!healed.ok || healed.holobot.level === (b.level ?? 1)) return bot;
    changed = true;
    changes.push(...healed.changes);
    return healed.holobot;
  });
  return changed ? { holobots, changes } : { changes: [] };
}
