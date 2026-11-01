// The landing's visual guard (spec landing task 10.1; requirement 10): `pnpm test:visual` builds
// the app, serves the production build with `vite preview` and compares screenshots with the
// committed baselines in e2e/__screenshots__ at a 2% pixel tolerance. Not part of `pnpm test`
// (vite.config.ts keeps e2e/ out of vitest). Refresh baselines with `pnpm test:visual:update`.
import { defineConfig, devices } from "@playwright/test";

const PORT = 4319;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.visual.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../var/test-visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled", caret: "hide", scale: "css" },
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  },
  webServer: {
    command: `pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
