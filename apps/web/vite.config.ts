import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // The Playwright visual test (e2e/, `pnpm test:visual`) is not part of `pnpm test`.
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
