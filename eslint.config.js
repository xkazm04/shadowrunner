// ESLint flat config. Gates from .kiro/steering/tech.md and structure.md:
// no `any`, no `as unknown as`, the package layering enforced by eslint-plugin-boundaries, and no
// relative imports into another member's src/ (members import each other as `@sr/<name>`).
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

/**
 * A relative specifier that climbs out of the current folder and then descends into some
 * `<member>/src`, e.g. `../../../rig/src/index.js` or `../../packages/rig/src/x`. Imports inside one
 * member (`./x`, `../driver/state.js`, `../src/index.js`) never name a folder followed by `src`.
 * Members import each other by package name (`@sr/rig`), so the edge is declared in package.json.
 */
const NO_REACH_INTO_SRC = {
  regex: "^(?:\\./)?(?:\\.\\./)+(?:[^./][^/]*/)+src(?:/|$)",
  message: "Import another workspace package by its name (e.g. `@sr/rig`) and declare it in package.json, not by a relative path into its src/.",
};

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
      ".vercel/**",
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
    // Every workspace member (packages, apps, api), plus the gate fixture that proves the rule red.
    files: [
      "{apps,packages}/*/**/*.{ts,tsx,mts,cts,js,mjs}",
      "api/**/*.{ts,tsx,mts,cts,js,mjs}",
      "scripts/gate-fixtures/src-reach/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_REACH_INTO_SRC] }],
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
