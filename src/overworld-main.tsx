import React from "react";
import ReactDOM from "react-dom/client";

import { OverworldMap } from "../overworld";

const buildHash = import.meta.env.VITE_BUILD_HASH ?? "dev";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <main style={{ height: "100dvh", width: "100vw" }}>
      <OverworldMap buildHash={buildHash} />
    </main>
  </React.StrictMode>,
);
