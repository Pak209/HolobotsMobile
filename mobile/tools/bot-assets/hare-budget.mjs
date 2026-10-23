/** Pak-approved strict HARE pose pack; every other bot retains the 2 MB cap. */
export const DEFAULT_BOT_MAX_BYTES = 2_000_000;
export const HARE_STRICT_MAX_BYTES = 2_210_316;

export function botMaxBytes(id) {
  return id === 'hare' ? HARE_STRICT_MAX_BYTES : DEFAULT_BOT_MAX_BYTES;
}
