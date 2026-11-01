// Theme and motion inputs for the shell (m0-spine requirement 3.5). The shell writes
// `data-theme`, `data-motion` and `data-scheme` on <html>; components read the attributes or the
// --sr-* custom properties the theme CSS defines under [data-theme].
//
// index.html carries an inline copy of resolveTheme so the first paint is already themed;
// theme.test.ts runs that script and checks it agrees with resolveTheme.
import { THEME_NAMES, type ThemeName } from "@sr/theme";
import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from "react";

export type { ThemeName };

export const THEME_STORAGE_KEY = "sr-theme";

/** Halloween is the default through 2026-12-31 (local time); baseline from 2027-01-01. */
export const BASELINE_FROM = { year: 2027, month: 0, day: 1 } as const;

export function defaultTheme(now: Date): ThemeName {
  const switchAt = new Date(BASELINE_FROM.year, BASELINE_FROM.month, BASELINE_FROM.day);
  return now.getTime() < switchAt.getTime() ? "halloween" : "baseline";
}

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEME_NAMES as readonly string[]).includes(value);
}

/** A stored explicit choice wins; anything else falls back to the date default. */
export function resolveTheme(stored: string | null, now: Date): ThemeName {
  return isThemeName(stored) ? stored : defaultTheme(now);
}

/** The toggle walks THEME_NAMES in order and wraps. */
export function nextTheme(theme: ThemeName): ThemeName {
  const at = THEME_NAMES.indexOf(theme);
  return THEME_NAMES[(at + 1) % THEME_NAMES.length] ?? theme;
}

export type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

/** Storage can be absent or throw (private mode, blocked cookies); both mean "no choice". */
export function readStoredTheme(storage: ThemeStorage | undefined): string | null {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeTheme(storage: ThemeStorage | undefined, theme: ThemeName): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The choice still applies for this visit.
  }
}

function browserStorage(): ThemeStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The active theme, applied as `data-theme` on <html>. Only an explicit toggle is persisted, so
 * a visitor who never chose follows the date default.
 */
export function useTheme(): readonly [ThemeName, () => void] {
  const [theme, setTheme] = useState<ThemeName>(() => resolveTheme(readStoredTheme(browserStorage()), new Date()));
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = useCallback(() => {
    const next = nextTheme(theme);
    storeTheme(browserStorage(), next);
    setTheme(next);
  }, [theme]);
  return [theme, toggle] as const;
}

function useMediaQuery(query: string, serverValue: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export type Motion = "full" | "reduced";
export type Scheme = "dark" | "light";

export interface Preferences {
  motion: Motion;
  scheme: Scheme;
}

/**
 * prefers-reduced-motion and prefers-color-scheme, mirrored to `data-motion` and `data-scheme`
 * on <html>. Without a window (tests, prerender) motion is reduced: the static twin is the safe one.
 */
export function usePreferences(): Preferences {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)", true);
  const light = useMediaQuery("(prefers-color-scheme: light)", false);
  const motion: Motion = reduced ? "reduced" : "full";
  const scheme: Scheme = light ? "light" : "dark";
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = motion;
    document.documentElement.dataset.scheme = scheme;
  }, [motion, scheme]);
  return { motion, scheme };
}
