import { functions, httpsCallable } from "@/config/firebase";

/**
 * energy-quest-server-1: the host's daily energy regen (functions/src/energy/refreshEnergy.ts). The client never
 * writes energy; it asks the host to apply whatever is due (local-midnight reset in the ACCOUNT's stored zone, the
 * 15-minute trickle, today's step bonus) and the profile listener shows the result. The device zone is only a
 * proposal: the host stores the first one and rate-limits changes, and every time is the host's.
 */
export type EnergyRefreshReply = {
  schemaVersion: "energy-regen-1";
  changed: boolean;
  dailyEnergy: number;
  maxDailyEnergy: number;
  energyDayKey: string;
  timeZone: string;
  timeZoneStatus: "set" | "unchanged" | "changed" | "cooldown" | "default" | "invalid";
  timeZoneChangeAvailableAt: string | null;
  nextResetAt: string;
};

const refreshEnergyCallable = httpsCallable<{ timeZone?: string }, EnergyRefreshReply>(functions, "refreshEnergy");

/** The device's IANA zone, or undefined when the runtime cannot say (the host then keeps / defaults the zone). */
export function deviceTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 && zone.length <= 64 ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** `timeZone` defaults to the device zone; pass null to send no proposal. */
export async function refreshEnergyOnHost(timeZone: string | null | undefined = deviceTimeZone()): Promise<EnergyRefreshReply> {
  const reply = await refreshEnergyCallable(timeZone ? { timeZone } : {});
  return reply.data;
}
