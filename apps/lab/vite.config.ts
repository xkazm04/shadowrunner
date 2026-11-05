// Vitest only: the lab page is served by the director (src/director/stage/server.ts), which builds
// its own Vite config, so nothing here reaches a run.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "lab", environment: "node", include: ["src/**/*.test.ts"] },
});
