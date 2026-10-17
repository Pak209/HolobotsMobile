import React, { lazy, Suspense } from "react";
import { isLiteEnabled } from "@/config/liteFeature";
export type * from "./EnabledArenaHostLevelsPreview";
const LazyArenaHostLevelsPreview = lazy(() => import("./EnabledArenaHostLevelsPreview").then(m => ({ default: m.ArenaHostLevelsPreview })));
export function ArenaHostLevelsPreview() { return isLiteEnabled() ? <Suspense fallback={null}><LazyArenaHostLevelsPreview /></Suspense> : null; }
const LazyArenaHostLevelsKnownBadPreview = lazy(() => import("./EnabledArenaHostLevelsPreview").then(m => ({ default: m.ArenaHostLevelsKnownBadPreview })));
export function ArenaHostLevelsKnownBadPreview() { return isLiteEnabled() ? <Suspense fallback={null}><LazyArenaHostLevelsKnownBadPreview /></Suspense> : null; }
