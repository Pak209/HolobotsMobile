import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        overworld: resolve(__dirname, "overworld.html"),
      },
    },
  },
  plugins: [react()],
  server: { host: true },
});
