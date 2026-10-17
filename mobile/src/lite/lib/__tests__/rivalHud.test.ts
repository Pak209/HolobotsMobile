import { describe, expect, it } from "vitest";
import { formatRivalCountdown, nextRivalCooldown } from "../rivalHud";
import { hostTierLabel } from "../../components/dashboard/holobotPresentation";
import { slotAccent, theme } from "../../theme";

describe("HoloCity HUD observations", () => {
  it("selects the next observed rival, dropping expired or malformed observations", () => {
    expect(nextRivalCooldown([{ pilotId: 'expired', endsAtMs: 10 }, { pilotId: 'later', endsAtMs: 9000 }, { pilotId: 'next', endsAtMs: 3000 }, { pilotId: 'bad', endsAtMs: NaN }], 1000)?.pilotId).toBe('next');
    expect(nextRivalCooldown([{pilotId:'done',endsAtMs:1000}],1000)).toBeNull();
  });
  it("does not show ready early and never produces a negative countdown", () => {
    expect(formatRivalCountdown(300000, 0)).toBe('05:00');
    expect(formatRivalCountdown(300000, 299999)).toBe('00:01');
    expect(formatRivalCountdown(300000, 300001)).toBe('00:00');
  });
  it("renders only the verbatim host tier instead of deriving one from level", () => {
    expect(hostTierLabel("Champion")).toBe("TIER · Champion");
    expect(hostTierLabel("Custom host tier Ⅱ")).toBe("TIER · Custom host tier Ⅱ");
    expect(hostTierLabel(undefined)).toBeNull();
    expect(hostTierLabel("")).toBeNull();
  });
  it("matches Unity slot wrapping on both teams, independent of bot identity", () => {
    expect([0,1,2].map(slot => slotAccent(false,slot))).toEqual(['#2FE6FF','#7CFF4F','#B07CFF']);
    expect([0,1,2].map(slot => slotAccent(true,slot))).toEqual(['#FF7A1A','#FF3D8B','#FFD21A']);
    expect(slotAccent(false,-1)).toBe(theme.rings.player[2]);
    expect(slotAccent(true,4)).toBe(theme.rings.rival[1]);
  });
});
