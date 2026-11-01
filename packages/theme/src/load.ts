// Node-only loader shared by build.mjs and the tests: reads scales/, roles.json and themes/ from
// the package directory. Not exported from index.ts, so the web bundle never pulls in node:fs.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeScales, type Scales, type ThemeMap } from "./tokens.ts";
import { parseRoles, parseScale, parseTheme } from "./validate.ts";

export interface TokenSources {
  roles: readonly string[];
  scales: Scales;
  /** Theme name (file name without .json) -> role map, sorted by name. */
  themes: ReadonlyMap<string, ThemeMap>;
}

const THEME_NAME = /^[a-z][a-z0-9-]*$/;

function jsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

export function loadTokens(packageDir: string): TokenSources {
  const read = (rel: string): string => readFileSync(join(packageDir, rel), "utf8");

  const roles = parseRoles(read("roles.json"), "roles.json");

  const scaleFiles = jsonFiles(join(packageDir, "scales")).map((f) => {
    const source = `scales/${f}`;
    return { source, ramps: parseScale(read(source), source) };
  });
  if (scaleFiles.length === 0) throw new Error("scales/: no *.json files");
  const { scales, problems } = mergeScales(scaleFiles);
  if (problems.length > 0) throw new Error(problems.join("\n"));

  const themes = new Map<string, ThemeMap>();
  for (const f of jsonFiles(join(packageDir, "themes"))) {
    const name = f.slice(0, -".json".length);
    if (!THEME_NAME.test(name)) throw new Error(`themes/${f}: "${name}" is not a theme name`);
    themes.set(name, parseTheme(read(`themes/${f}`), `themes/${f}`));
  }
  if (themes.size === 0) throw new Error("themes/: no *.json files");

  return { roles, scales, themes };
}
