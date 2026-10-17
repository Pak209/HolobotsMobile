import { lazy, Suspense } from "react";
import { isLiteEnabled } from "@/config/liteFeature";
export type * from "./EnabledCityHubScreen";
const LazyCityHubScreen = lazy(() => import("./EnabledCityHubScreen").then(m => ({ default: m.CityHubScreen })));
export function CityHubScreen(props: Parameters<typeof import("./EnabledCityHubScreen").CityHubScreen>[0] = {}) { return isLiteEnabled() ? <Suspense fallback={null}><LazyCityHubScreen {...props} /></Suspense> : null; }
