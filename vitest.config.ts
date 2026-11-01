import { defineConfig } from "vitest/config";

// One vitest project per workspace member. scripts/ (gate fixtures) is deliberately outside.
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*", "api"],
  },
});
