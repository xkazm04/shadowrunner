// @sr/theme: design tokens. Sources: scales/*.json (raw ramps), roles.json (the closed role
// vocabulary), themes/<name>.json (role -> ramp step). build.mjs writes dist/<name>.css, imported
// as "@sr/theme/<name>.css", defining --sr-<role> under [data-theme="<name>"].
export const PACKAGE = "@sr/theme";

/** Every theme shipped in themes/ (themes.test.ts keeps this list in step with the files). */
export const THEME_NAMES = ["baseline", "halloween"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
