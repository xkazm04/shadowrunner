// History router: pathname -> PageDef from the manifest. No router dependency (m0-spine design).
import { useSyncExternalStore } from "react";
import type { PageDef } from "./pages";

/** Fired on window after navigate() pushes or replaces a history entry. */
const NAV_EVENT = "sr:navigate";

/** Pathname only, one leading slash, no empty segments, no trailing slash ("/" stays "/"). */
export function normalizePath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  return `/${pathname.split("/").filter(Boolean).join("/")}`;
}

export function matchPage(pages: readonly PageDef[], pathname: string): PageDef | undefined {
  const target = normalizePath(pathname);
  return pages.find((p) => normalizePath(p.path) === target);
}

/**
 * Push (or replace) a history entry and notify subscribers. The current query string is kept
 * when the target has none, so overrides such as `?plane=replay` survive navigation.
 */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const { location, history } = window;
  const url = new URL(to, location.href);
  if (url.search === "") url.search = location.search;
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next === `${location.pathname}${location.search}${location.hash}`) return;
  if (options.replace) history.replaceState(null, "", next);
  else history.pushState(null, "", next);
  window.dispatchEvent(new Event(NAV_EVENT));
}

export interface LinkClick {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

/** onClick for an `<a href>`: plain left clicks navigate in place; modified clicks stay native. */
export function handleLinkClick(event: LinkClick, to: string): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(to);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAV_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAV_EVENT, onChange);
  };
}

function currentPathname(): string {
  return window.location.pathname;
}

export interface Route {
  path: string;
  page: PageDef | undefined;
}

/** The active route. `serverPath` is what renders without a window (tests, prerender). */
export function useRoute(pages: readonly PageDef[], serverPath = "/"): Route {
  const path = normalizePath(useSyncExternalStore(subscribe, currentPathname, () => serverPath));
  return { path, page: matchPage(pages, path) };
}
