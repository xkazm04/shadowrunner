// Stylelint for CSS Modules (tech.md: tokens only). Two layers:
// 1. Anywhere in a *.module.css: no hex, no colour functions such as rgb(), no named colours,
//    no raw px.
// 2. Colour, spacing, font-size, radius and shadow properties take only var(--sr-*) tokens
//    (or a CSS-wide keyword), via stylelint-declaration-strict-value.
// Generated theme CSS (packages/theme/dist/*.css) is not a module and is never linted.

const SR_VAR = String.raw`var\(--sr-[a-z0-9-]+\)`;
const KEYWORD = "inherit|initial|unset|revert|revert-layer|currentcolor|transparent|none|auto|0";
/** One or more space-separated tokens, each a --sr-* variable or a keyword (e.g. `margin`). */
const TOKENS_ONLY = `/^(?:${SR_VAR}|${KEYWORD})(?:\\s+(?:${SR_VAR}|${KEYWORD}))*$/i`;

const TOKEN_PROPERTIES = [
  "/color$/", // color, background-color, border-*-color, outline-color, ...
  "background", // a colour shorthand here; textures go in background-image
  "fill",
  "stroke",
  "/^(margin|padding)(-|$)/",
  "gap",
  "row-gap",
  "column-gap",
  "font-size",
  "/radius$/",
  "box-shadow",
  "text-shadow",
];

/** @type {import("stylelint").Config} */
export default {
  plugins: ["stylelint-declaration-strict-value"],
  rules: {},
  overrides: [
    {
      files: ["**/*.module.css"],
      rules: {
        "color-no-hex": true,
        "color-named": "never",
        "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color"],
        "unit-disallowed-list": ["px"],
        "scale-unlimited/declaration-strict-value": [
          TOKEN_PROPERTIES,
          {
            ignoreVariables: false,
            ignoreFunctions: false,
            ignoreValues: [TOKENS_ONLY],
            message: 'Use a var(--sr-*) role token for "${property}" (got "${value}").',
          },
        ],
      },
    },
  ],
};
