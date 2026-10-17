import { theme } from "@/theme";
import type { BattleRewards } from "@/types/arena";

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
  | { kind: "host"; rewards: BattleRewards }
  | { kind: "qa-standin" };

export type ArenaResultRowTone = "plain" | "rare" | "positive" | "negative";

export type ArenaResultRow = {
  key: string;
  icon: string;
  label: string;
  value: string;
  frameAccent: string;
  tone: ArenaResultRowTone;
};

export type ArenaResultPresentation = {
  subtitle: string;
  /** null when there are no reward rows: no empty REWARDS header. */
  rowsTitle: string | null;
  rows: ArenaResultRow[];
};

// PLACEHOLDER copy until Lex signs off the result-screen strings.
export const ARENA_RESULT_COPY = {
  qaStandIn: "QA / SIMULATED / NO REWARDS",
  hostReceipt: "HOST RECEIPT",
  hostNothingGranted: "HOST RECEIPT · NOTHING GRANTED",
  rewardsTitle: "REWARDS",
  consolationTitle: "CONSOLATION",
} as const;

const positive = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

function hostRows(rewards: BattleRewards): ArenaResultRow[] {
  const rows: ArenaResultRow[] = [];
  if (positive(rewards.exp)) rows.push({ key: "exp", icon: "EXP", label: "EXP", value: `+${rewards.exp}`, frameAccent: theme.colors.border, tone: "plain" });
  if (positive(rewards.syncPoints)) rows.push({ key: "sp", icon: "SP", label: "Sync Points", value: `+${rewards.syncPoints}`, frameAccent: theme.colors.accent, tone: "plain" });
  if (positive(rewards.holos)) rows.push({ key: "holos", icon: "H", label: "HOLOS", value: `+${rewards.holos}`, frameAccent: theme.colors.accent, tone: "rare" });
  for (const bp of rewards.blueprintRewards ?? []) {
    if (positive(bp.amount)) rows.push({ key: `bp:${bp.holobotKey}`, icon: "BP", label: `${bp.holobotKey.toUpperCase()} BLUEPRINT`, value: `+${bp.amount}`, frameAccent: theme.colors.accent, tone: "rare" });
  }
  return rows;
}

function ratingRow(eloChange: number | undefined): ArenaResultRow | null {
  if (typeof eloChange !== "number") return null;
  const up = eloChange >= 0;
  return { key: "rating", icon: "RT", label: "Rating", value: `${up ? "+" : ""}${eloChange}`, frameAccent: up ? theme.colors.accent : theme.colors.danger, tone: up ? "positive" : "negative" };
}

/** `context` is the caller's match line (e.g. "ACE LV 4 · HARE LV 12"). */
export function presentArenaResult(input: { didWin: boolean; receipt: ArenaResultReceipt; context?: string }): ArenaResultPresentation {
  const join = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(" · ");
  if (input.receipt.kind === "qa-standin") {
    return { subtitle: join(ARENA_RESULT_COPY.qaStandIn, input.context), rowsTitle: null, rows: [] };
  }
  const granted = hostRows(input.receipt.rewards);
  const rating = ratingRow(input.receipt.rewards.eloChange);
  const rows = rating ? [...granted, rating] : granted;
  return {
    subtitle: join(input.context, granted.length > 0 ? ARENA_RESULT_COPY.hostReceipt : ARENA_RESULT_COPY.hostNothingGranted),
    rowsTitle: rows.length > 0 ? (input.didWin ? ARENA_RESULT_COPY.rewardsTitle : ARENA_RESULT_COPY.consolationTitle) : null,
    rows,
  };
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
