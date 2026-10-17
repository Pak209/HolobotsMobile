import React, { lazy, Suspense } from "react";
import { isLiteEnabled } from "@/config/liteFeature";
export type * from "./EnabledDuelPlaybackScreen";
const LazyDuelPlaybackScreen = lazy(() => import("./EnabledDuelPlaybackScreen").then(m => ({ default: m.DuelPlaybackScreen })));
export function DuelPlaybackScreen(props: Parameters<typeof import("./EnabledDuelPlaybackScreen").DuelPlaybackScreen>[0]) { return isLiteEnabled() ? <Suspense fallback={null}><LazyDuelPlaybackScreen {...props} /></Suspense> : null; }
const LazyFighterHud = lazy(() => import("./EnabledDuelPlaybackScreen").then(m => ({ default: m.FighterHud })));
export function FighterHud(props: Parameters<typeof import("./EnabledDuelPlaybackScreen").FighterHud>[0]) { return isLiteEnabled() ? <Suspense fallback={null}><LazyFighterHud {...props} /></Suspense> : null; }
