/** Build-time opt-in; missing or malformed values fail closed. */
export function isLiteEnabled(): boolean { return process.env.EXPO_PUBLIC_HOLOCITY_LITE === "1"; }
export function isLitePreviewEnabled(): boolean { return isLiteEnabled() && typeof __DEV__ !== "undefined" && __DEV__ && process.env.EXPO_PUBLIC_HOLOCITY_PREVIEW === "1"; }
