import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Temporary, throwaway config for the Follow Mode verification harness --
// NOT part of the shipped app. Mounts the real, unmodified CityCanvasIso
// component under jsdom so its actual useEffect/useState/ref logic runs
// for real (real React scheduler, real event dispatch), not a
// hand-copied re-implementation.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "jsdom",
    // .test.ts included alongside .test.tsx starting Phase 0 (Living
    // City milestone) for the semantic-ontology-chain contract test,
    // which is pure data-layer logic with no React/DOM involved and so
    // has no reason to be a .tsx file like the Follow Mode harness tests.
    include: ["harness/**/*.test.tsx", "harness/**/*.test.ts"],
  },
});
