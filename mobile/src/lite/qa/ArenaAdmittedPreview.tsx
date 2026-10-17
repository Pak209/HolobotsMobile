import { lazy, Suspense } from "react";
import { isLiteEnabled } from "@/config/liteFeature";
export type * from "./EnabledArenaAdmittedPreview";
const LazyArenaAdmittedRoundPreview = lazy(() => import("./EnabledArenaAdmittedPreview").then(m => ({ default: m.ArenaAdmittedRoundPreview })));
export function ArenaAdmittedRoundPreview() { return isLiteEnabled() ? <Suspense fallback={null}><LazyArenaAdmittedRoundPreview /></Suspense> : null; }
const LazyArenaAdmittedResultPreview = lazy(() => import("./EnabledArenaAdmittedPreview").then(m => ({ default: m.ArenaAdmittedResultPreview })));
export function ArenaAdmittedResultPreview() { return isLiteEnabled() ? <Suspense fallback={null}><LazyArenaAdmittedResultPreview /></Suspense> : null; }
const LazyArenaAdmittedKnownBadPreview = lazy(() => import("./EnabledArenaAdmittedPreview").then(m => ({ default: m.ArenaAdmittedKnownBadPreview })));
export function ArenaAdmittedKnownBadPreview() { return isLiteEnabled() ? <Suspense fallback={null}><LazyArenaAdmittedKnownBadPreview /></Suspense> : null; }
