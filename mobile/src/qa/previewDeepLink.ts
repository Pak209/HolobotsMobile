/**
 * Dev-preview deep links only; no production navigation or host calls.
 * `holobotsmobile` is app.json's scheme; the cached w64 simulator build
 * (fun.holobots.mobile.w64, build 37) registers only `holobotsw64` and
 * `fun.holobots.mobile`, so the QA listener accepts all three rather than
 * requiring a native rebuild.
 */
export const PREVIEW_URL_SCHEMES = ["holobotsmobile", "holobotsw64", "fun.holobots.mobile"] as const;

const QA_URL = /^([a-z][a-z0-9+.-]*):\/\/qa\/([a-zA-Z0-9-]+)\/?$/;

/** Returns the registered preview screen a QA URL names, or null. Own keys only. */
export function previewScreenFromUrl(url: string | null | undefined, screens: Record<string, unknown>): string | null {
  const match = url?.match(QA_URL);
  if (!match || !(PREVIEW_URL_SCHEMES as readonly string[]).includes(match[1])) return null;
  return Object.prototype.hasOwnProperty.call(screens, match[2]) ? match[2] : null;
}
