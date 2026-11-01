import { defineConfig } from "vitest/config";

// One vitest project per workspace member, plus the deploy script's pure half. The rest of
// scripts/ (gate fixtures, seeded violations) is deliberately outside.
export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/*",
      "api",
      { test: { name: "scripts", include: ["scripts/vercel-config.test.mjs"], environment: "node" } },
    ],
  },
});
