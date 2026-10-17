import { lazy, Suspense } from "react";
import { isLiteEnabled } from "@/config/liteFeature";
export type * from "./EnabledHoloCityPreview";
const LazyHoloCityPreviewApp = lazy(() => import("./EnabledHoloCityPreview").then(m => ({ default: m.HoloCityPreviewApp })));
export function HoloCityPreviewApp() { return isLiteEnabled() ? <Suspense fallback={null}><LazyHoloCityPreviewApp /></Suspense> : null; }
