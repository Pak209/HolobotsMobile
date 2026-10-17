import React, { lazy, Suspense } from "react";
import { isLiteEnabled } from "./src/config/liteFeature";
export type { RootTabs } from "./MainApp";
const MainApp = lazy(() => import("./MainApp"));
const LiteApp = lazy(() => import("./LiteApp"));
/** Disabled builds never evaluate the lite application or its consumers. */
export default function App() {
  const Selected = isLiteEnabled() ? LiteApp : MainApp;
  return <Suspense fallback={null}><Selected /></Suspense>;
}
