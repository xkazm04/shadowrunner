// Live end-to-end checks of avatar packs and their reach (specs avatar-pack, avatar-reach):
// `pnpm test:e2e` builds the app, serves the production build with `vite preview` (replay plane:
// no /api) and drives a headless Chromium with a fake microphone through the overlay, the studio's
// recorder, the creator's export/import and a cross-origin page embedding <sr-avatar>.
// Not part of `pnpm test` (vite.config.ts keeps e2e/ out of vitest).
import { defineConfig, devices } from "@playwright/test";

const PORT = 4320;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  outputDir: "../../var/test-e2e",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 860 },
    acceptDownloads: true,
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: `pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
