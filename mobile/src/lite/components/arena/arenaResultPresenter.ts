import { theme } from "@/lite/theme";
import type { BattleRewards } from "@/lite/types/arena";
import type { ArenaClosure, ArenaPayoutWithheld } from "@/lite/lib/arenaMatchFlow";

/**
 * Arena RESULT presenter: the subtitle and the reward rows come from ONE
 * source so they can never disagree (lite-result-copy-1, 2026-10-17).
 *
 * Presentation only (hard rule 1): rows are a straight read of the host
 * receipt. The QA / fixture stand-in path carries no rewards at all — its
 * type has no `rewards` field — so a fixture's synthetic settlement can never
 * be printed under a "NO REWARDS" line again.
 */
export type ArenaResultReceipt =
  | { kind: "host"; rewards: BattleRewards; withheld?: ArenaPayoutWithheld | null }
  | { kind: "qa-standin" };

export type ArenaResultRowTone = "plain" | "rare" | "positive" | "negative";
/** L18: each row draws a real reward glyph (BattleResultsModal maps the key to the bundled art), not a repeat of its label. */
export type ArenaRewardGlyph = "exp" | "sync" | "holos" | "blueprint" | "rating";

export type ArenaResultRow = {
  key: string;
  glyph: ArenaRewardGlyph;
  label: string;
  value: string;
  frameAccent: string;
  tone: ArenaResultRowTone;
};

export type ArenaResultPresentation = {
  /** The big headline: VICTORY! / DEFEAT, or FORFEIT / ENTRY REFUNDED for a match closed without a settle (F7). */
  headline: string;
  /** "win" draws the accent frame; "loss" the danger frame; "neutral" (refund) the border frame. */
  tone: "win" | "loss" | "neutral";
  subtitle: string;
  /** One honest line under the subtitle: why nothing was paid, or what a forfeit/refund recorded. */
  notice: string | null;
  /** null when there are no reward rows: no empty REWARDS header. */
  rowsTitle: string | null;
  rows: ArenaResultRow[];
};

// DECISIONS #71: the authority is "the City". Lex packet 2 (DECISIONS #72.8) reviewed qaStandIn, cityReceipt,
// cityNothingGranted, rewardsTitle and consolationTitle; Lex packet 3 (group 8) reviewed cityNothingGranted, cityNoRewards
// and withheld. The other strings stay PLACEHOLDER until Lex signs them off.
export const ARENA_RESULT_COPY = {
  qaStandIn: "QA / SIMULATED / NO REWARDS",
  cityReceipt: "CITY RECEIPT",
  cityNothingGranted: "CITY RECEIPT · NOTHING GRANTED",
  cityNoRewards: "CITY RECEIPT · NO REWARDS THIS MATCH",
  rewardsTitle: "REWARDS",
  consolationTitle: "REWARDS",
  victory: "VICTORY!",
  defeat: "DEFEAT",
  forfeit: "FORFEIT",
  refunded: "ENTRY REFUNDED",
  withheld: {
    daily_cap: "Daily Arena reward cap reached · resets 00:00 UTC",
    under_floor: "Battle too brief for rewards",
  },
} as const;

const positive = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

function hostRows(rewards: BattleRewards): ArenaResultRow[] {
  const rows: ArenaResultRow[] = [];
  if (positive(rewards.exp)) rows.push({ key: "exp", glyph: "exp", label: "EXP", value: `+${rewards.exp}`, frameAccent: theme.colors.border, tone: "plain" });
  if (positive(rewards.syncPoints)) rows.push({ key: "sp", glyph: "sync", label: "Sync Points", value: `+${rewards.syncPoints}`, frameAccent: theme.colors.accent, tone: "plain" });
  if (positive(rewards.holos)) rows.push({ key: "holos", glyph: "holos", label: "HOLOS", value: `+${rewards.holos}`, frameAccent: theme.colors.accent, tone: "rare" });
  for (const bp of rewards.blueprintRewards ?? []) {
    if (positive(bp.amount)) rows.push({ key: `bp:${bp.holobotKey}`, glyph: "blueprint", label: `${bp.holobotKey.toUpperCase()} BLUEPRINT`, value: `+${bp.amount}`, frameAccent: theme.colors.accent, tone: "rare" });
  }
  return rows;
}

function ratingRow(eloChange: number | undefined): ArenaResultRow | null {
  if (typeof eloChange !== "number") return null;
  const up = eloChange >= 0;
  return { key: "rating", glyph: "rating", label: "Rating", value: `${up ? "+" : ""}${eloChange}`, frameAccent: up ? theme.colors.accent : theme.colors.danger, tone: up ? "positive" : "negative" };
}

const join = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(" · ");

/** `context` is the caller's match line (e.g. "ACE LV 4 · HARE LV 12"). */
export function presentArenaResult(input: { didWin: boolean; receipt: ArenaResultReceipt; context?: string }): ArenaResultPresentation {
  const base = { headline: input.didWin ? ARENA_RESULT_COPY.victory : ARENA_RESULT_COPY.defeat, tone: input.didWin ? "win" as const : "loss" as const };
  if (input.receipt.kind === "qa-standin") {
    return { ...base, subtitle: join(ARENA_RESULT_COPY.qaStandIn, input.context), notice: null, rowsTitle: null, rows: [] };
  }
  const withheld = input.receipt.withheld ?? null;
  // A withheld receipt is all-zero by contract (arenaReceiptResult); never print a row under its notice.
  const granted = withheld ? [] : hostRows(input.receipt.rewards);
  const rating = ratingRow(input.receipt.rewards.eloChange);
  const rows = rating ? [...granted, rating] : granted;
  return {
    ...base,
    subtitle: join(input.context, withheld ? ARENA_RESULT_COPY.cityNoRewards : granted.length > 0 ? ARENA_RESULT_COPY.cityReceipt : ARENA_RESULT_COPY.cityNothingGranted),
    notice: withheld ? ARENA_RESULT_COPY.withheld[withheld] : null,
    rowsTitle: rows.length > 0 ? (input.didWin ? ARENA_RESULT_COPY.rewardsTitle : ARENA_RESULT_COPY.consolationTitle) : null,
    rows,
  };
}

/** F7: a match the City closed without a settle. A refund names what came back; a forfeit names the HP it recorded. */
export function presentArenaClosure(input: { closure: ArenaClosure; fighter: string; context?: string }): ArenaResultPresentation {
  const { closure } = input;
  const late = closure.expired ? " · match timed out" : "";
  if (closure.kind === "refund") {
    const what = closure.method === "pass" ? `${closure.amount} Arena Pass${closure.amount === 1 ? "" : "es"}` : `${closure.amount} Holos`;
    return { headline: ARENA_RESULT_COPY.refunded, tone: "neutral", subtitle: join(input.context, ARENA_RESULT_COPY.cityReceipt), notice: `Cancelled before the fight${late} · ${what} returned`, rowsTitle: null, rows: [] };
  }
  const hp = closure.finalHealth !== null && closure.maxHealth !== null ? ` · ${input.fighter} HP ${Math.round(closure.finalHealth)} / ${Math.round(closure.maxHealth)}` : "";
  return { headline: ARENA_RESULT_COPY.forfeit, tone: "loss", subtitle: join(input.context, ARENA_RESULT_COPY.cityNoRewards), notice: `Forfeit${late} · entry not refunded${hp}`, rowsTitle: null, rows: [] };
}

/**
 * Result-screen buttons on a SELECTED ArenaControlFrame (plate
 * theme.plates.raised). Same label treatment as the HUD BACK buttons
 * (HolobotPickerModal / HomeScreen): accent HoloDisplay label. The old label
 * used theme.colors.carbon on the raised plate (~1.1:1, the near-invisible
 * EXIT ARENA in the 10-17 witness).
 */
export const ARENA_RESULT_BUTTON = {
  plate: { alignItems: "center", justifyContent: "center", minHeight: theme.touchTarget, position: "relative" },
  primaryLabel: { color: theme.colors.accent, fontFamily: "HoloDisplay", fontSize: theme.type.label.fontSize, fontWeight: "900", letterSpacing: 1 },
  secondaryLabel: { color: theme.colors.muted, fontFamily: "HoloBody", fontSize: theme.type.body.fontSize, fontWeight: "900", letterSpacing: 0.7 },
} as const;
