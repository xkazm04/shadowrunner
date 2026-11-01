// ESLint flat config. Gates from .kiro/steering/tech.md and structure.md:
// no `any`, no `as unknown as`, and the package layering enforced by eslint-plugin-boundaries.
// scripts/gate-fixtures/ holds seeded violations; it is ignored here and linted only by
// `pnpm test:gates` (with --no-ignore), which asserts every fixture fails.
import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * One element per workspace member. `partialMatch: false` anchors each pattern at the root path,
 * so a folder such as apps/web/src/api/ is still `web`, not `api` (the default matches suffixes).
 */
const ELEMENTS = [
  ["web", "apps/web"],
  ["api", "api"],
  ["rig", "packages/rig"],
  ["avatar", "packages/avatar"],
  ["forge", "packages/forge"],
  ["engine", "packages/engine"],
  ["theme", "packages/theme"],
].map(([type, pattern]) => ({ type, pattern, partialMatch: false }));

const PACKAGES = ["rig", "avatar", "forge", "engine", "theme"];

/**
 * structure.md layering: apps/web -> packages/*; api/ -> packages/*; packages/rig -> nothing;
 * packages/avatar -> rig; packages/forge -> rig; no package imports apps/ (or api/).
 * Anything not listed is disallowed, so engine and theme may import no other member.
 */
const LAYERING = [
  { from: "web", to: PACKAGES },
  { from: "api", to: PACKAGES },
  { from: "avatar", to: ["rig"] },
  { from: "forge", to: ["rig"] },
];

const NO_UNKNOWN_AS = {
  selector: "TSAsExpression > TSAsExpression.expression > TSUnknownKeyword.typeAnnotation",
  message: "`as unknown as` launders a type. Validate the value (packages/*/src/validate.ts) or fix the type.",
};
const NO_UNKNOWN_ASSERTION = {
  selector: "TSTypeAssertion > TSTypeAssertion.expression > TSUnknownKeyword.typeAnnotation",
  message: "`<T><unknown>` launders a type, like `as unknown as`. Validate the value or fix the type.",
};

export default tseslint.config(
  {
    // assets/ is committed art (including reference prototypes), not workspace source.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "var/**",
      "assets/**",
      "scripts/gate-fixtures/**/*", // `/*` (not `/**`) so the runner below can be un-ignored
      "!scripts/gate-fixtures/run.mjs",
      ".claude/**",
      ".spark/**",
      ".contest/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [tseslint.configs.strict],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": ["error", NO_UNKNOWN_AS, NO_UNKNOWN_ASSERTION],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts,js,mjs}"],
    plugins: { boundaries },
    settings: {
      // Resolves relative imports, `exports` maps and workspace symlinks (`@sr/*` -> packages/*).
      "import/resolver": { typescript: { alwaysTryTypes: true } },
      "boundaries/elements": ELEMENTS,
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          // npm modules, node: builtins and imports inside one member stay allowed; every
          // member-to-member edge not granted by LAYERING is denied below.
          default: "allow",
          policies: [
            // Workspace members may only reach the members the layering grants them.
            ...ELEMENTS.map(({ type }) => {
              const granted = LAYERING.find((l) => l.from === type)?.to ?? [];
              const banned = ELEMENTS.map((e) => e.type).filter((t) => t !== type && !granted.includes(t));
              return {
                from: { element: { type } },
                disallow: { to: { element: { types: { anyOf: banned } } } },
              };
            }),
          ],
        },
      ],
    },
  },
);
