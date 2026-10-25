import { calculateExperience } from "./progression";
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
 * None of these can raise a level, XP, a point or a boost above what the record already holds.
 *
 * Refused (never guessed): malformed level / experience, experience already at or past the next level's threshold
 * (healing that would be a level-up grant, clamping it would destroy XP), negative or non-finite points / boosts,
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
  const level = bot.level ?? 1, exp = bot.experience ?? 0;
  if (!whole(level) || level < 1) return { ok: false, reason: "level_malformed" };
  if (!whole(exp)) return { ok: false, reason: "experience_malformed" };
  const threshold = calculateExperience(level + 1);
  if (!whole(threshold) || exp >= threshold) return { ok: false, reason: "experience_over_level" };

  const out: Data = { ...bot };
  const changes: RepairChange[] = [];
  const set = (field: string, after: unknown) => { changes.push({ path: `${pathPrefix}.${field}`, before: bot[field], after }); out[field] = after; };

  if (bot.nextLevelExp !== undefined && bot.nextLevelExp !== threshold) set("nextLevelExp", threshold);

  const points = bot.attributePoints;
  if (points !== undefined && !whole(points)) {
    if (points === null) set("attributePoints", 0);
    else if (wholeString(points) !== undefined) set("attributePoints", wholeString(points));
    else if (typeof points === "number" && Number.isFinite(points) && points >= 0 && Number.isSafeInteger(Math.floor(points))) set("attributePoints", Math.floor(points));
    else return { ok: false, reason: "attribute_points_malformed" };
  }

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
